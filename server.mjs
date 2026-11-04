/**
 * 暖屿 · 本地服务端
 *
 * 职责：
 * 1. 托管 public/ 下的纯静态前端（无构建步骤、无第三方依赖）。
 * 2. 作为 AI 请求的安全代理，避免在浏览器里直接跨域请求模型接口。
 * 3. 统一 OpenAI 兼容接口与 Anthropic Claude 接口的流式返回格式。
 *
 * 设计原则：
 * - API Key 只存在于请求内存 / 服务端环境变量，不写日志、不落盘。
 * - 默认只监听 127.0.0.1，适合本地个人使用。
 * - 无 npm 依赖，Node.js >= 20 即可运行。
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* 环境变量                                                            */
/* ------------------------------------------------------------------ */

/** 极简 .env 读取：只支持 KEY=VALUE / export KEY=VALUE / 注释。 */
async function loadDotEnv(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

await loadDotEnv(path.join(__dirname, '.env'));

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

const PROVIDERS = Object.freeze({
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    streamUsage: true,
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    streamUsage: true,
  },
  anthropic: {
    label: 'Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    streamUsage: true,
  },
  custom: {
    label: '自定义接口',
    kind: 'openai',
    baseUrl: '',
    keyEnv: 'CUSTOM_API_KEY',
    streamUsage: false,
  },
});

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120_000);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 180_000;

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, code, message, detail = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function sendJson(res, status, payload, requestId = null) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(requestId ? { 'X-Request-Id': requestId } : {}),
  });
  res.end(body);
}

function sendApiError(res, error, requestId) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message =
    error instanceof HttpError
      ? error.message
      : '服务端处理请求时发生异常，请稍后在运行日记中查看详情。';
  if (!(error instanceof HttpError)) {
    console.error(`[${requestId}]`, error);
  }
  sendJson(
    res,
    status,
    {
      ok: false,
      error: {
        code,
        type: error.name || 'Error',
        message,
        detail: error.detail || null,
        requestId,
        at: new Date().toISOString(),
      },
    },
    requestId,
  );
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求体必须是 application/json。');
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大。');
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    throw new HttpError(400, 'EMPTY_BODY', '请求体为空。');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体不是合法的 JSON。');
  }
}

/** 极简内存限流，防止本地端口被误用或循环请求。 */
const rateBuckets = new Map();
function checkRateLimit(req, route, max, windowMs) {
  const ip = req.socket.remoteAddress || 'unknown';
  const key = `${route}:${ip}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    throw new HttpError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试。');
  }
  if (rateBuckets.size > 500) {
    for (const [bucketKey, value] of rateBuckets) {
      if (now - value.startedAt >= windowMs) rateBuckets.delete(bucketKey);
    }
  }
}

function trimTo(value, max, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, max);
}

function normalizeBaseUrl(raw) {
  if (!raw) throw new HttpError(400, 'INVALID_BASE_URL', '缺少 API Base URL。');
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new HttpError(400, 'INVALID_BASE_URL', 'API Base URL 格式不正确。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, 'INVALID_BASE_URL', 'API Base URL 只允许 http/https。');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'INVALID_BASE_URL', 'API Base URL 不允许包含用户名或密码。');
  }
  const host = url.hostname.toLowerCase();
  // 阻断常见云元数据地址。私有网络地址保留，方便连接本地 Ollama / vLLM 等服务。
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal') ||
    host === '0.0.0.0'
  ) {
    throw new HttpError(400, 'BLOCKED_HOST', '出于安全考虑，不允许访问该地址。');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function resolveProviderConfig(input) {
  const providerId = trimTo(input.provider, 40, 'deepseek');
  const preset = PROVIDERS[providerId];
  if (!preset) {
    throw new HttpError(400, 'UNKNOWN_PROVIDER', '未知的模型提供商。');
  }

  const rawKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const apiKey = rawKey || process.env[preset.keyEnv] || '';
  if (!apiKey) {
    throw new HttpError(
      400,
      'MISSING_API_KEY',
      `尚未配置 ${preset.label} API Key。请在「设置」中填写，或在 .env 中设置 ${preset.keyEnv}。`,
    );
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl || preset.baseUrl);
  const model = trimTo(input.model, 160);
  if (!model) {
    throw new HttpError(400, 'MISSING_MODEL', '请提供模型名称。');
  }

  return { providerId, preset, apiKey, baseUrl, model };
}

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new HttpError(400, 'INVALID_MESSAGES', 'messages 必须是非空数组。');
  }
  if (input.length > 100) {
    throw new HttpError(400, 'TOO_MANY_MESSAGES', '消息数量过多。');
  }

  let totalChars = 0;
  const messages = input.map((message, index) => {
    const role = message?.role;
    if (!['system', 'user', 'assistant'].includes(role)) {
      throw new HttpError(400, 'INVALID_MESSAGE_ROLE', `第 ${index + 1} 条消息的 role 不合法。`);
    }
    const content = typeof message.content === 'string' ? message.content : '';
    if (!content.trim()) {
      throw new HttpError(400, 'EMPTY_MESSAGE', `第 ${index + 1} 条消息内容为空。`);
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(400, 'MESSAGE_TOO_LONG', `第 ${index + 1} 条消息超过长度限制。`);
    }
    totalChars += content.length;
    return { role, content };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw new HttpError(400, 'CONTEXT_TOO_LONG', '上下文过长，请先生成本章日记以压缩记忆。');
  }
  return messages;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0,
  );
  const completion = Number(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.completionTokens ??
      usage.outputTokens ??
      0,
  );
  const total = Number(usage.total_tokens ?? prompt + completion);
  if (![prompt, completion, total].some((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  return {
    promptTokens: Number.isFinite(prompt) ? Math.max(0, Math.round(prompt)) : 0,
    completionTokens: Number.isFinite(completion) ? Math.max(0, Math.round(completion)) : 0,
    totalTokens: Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 请求模型接口                                                        */
/* ------------------------------------------------------------------ */

function buildUpstreamRequest(provider, messages, options) {
  const stream = Boolean(options.stream);
  const temperature = Math.min(Math.max(Number(options.temperature) || 0.9, 0), 2);
  const maxTokens = Math.min(Math.max(Number(options.maxTokens) || 800, 16), 8192);

  if (provider.preset.kind === 'anthropic') {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const systemMessages = messages.filter((message) => message.role !== 'system');

    // Anthropic 要求消息尽量交替，且对话从 user 开始。
    const normalized = [];
    for (const message of systemMessages) {
      const last = normalized[normalized.length - 1];
      if (last && last.role === message.role) {
        last.content += `\n\n${message.content}`;
      } else {
        normalized.push({ role: message.role, content: message.content });
      }
    }
    if (!normalized.length || normalized[0].role !== 'user') {
      normalized.unshift({ role: 'user', content: '（场景开始。请自然地继续角色扮演。）' });
    }

    return {
      url: `${provider.baseUrl}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: provider.model,
        system: system || undefined,
        messages: normalized,
        temperature: Math.min(temperature, 1),
        max_tokens: maxTokens,
        stream,
      },
    };
  }

  const body = {
    model: provider.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };
  // 只有明确支持的 OpenAI 兼容端点才请求流式 usage，避免部分第三方网关报错。
  if (stream && provider.preset.streamUsage && provider.providerId !== 'custom') {
    body.stream_options = { include_usage: true };
  }

  return {
    url: `${provider.baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body,
  };
}

async function readUpstreamError(response) {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    /* ignore */
  }
  raw = raw.slice(0, 8_000);
  let message = '';
  try {
    const parsed = JSON.parse(raw);
    message =
      parsed?.error?.message ||
      parsed?.message ||
      (typeof parsed?.error === 'string' ? parsed.error : '') ||
      '';
  } catch {
    message = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  if (!message) message = `上游接口返回 HTTP ${response.status}。`;
  return message;
}

function upstreamErrorType(status) {
  if (status === 401 || status === 403) return 'AuthenticationError';
  if (status === 404) return 'ModelOrEndpointError';
  if (status === 429) return 'RateLimitError';
  if (status >= 500) return 'UpstreamServerError';
  return 'UpstreamRequestError';
}

/**
 * 创建上游请求，并处理网络/鉴权错误。返回 Response。
 */
async function fetchUpstream(provider, messages, options, signal, requestId) {
  const request = buildUpstreamRequest(provider, messages, options);
  let response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new HttpError(499, 'REQUEST_ABORTED', '请求已取消。', { requestId });
    }
    throw new HttpError(
      502,
      'NETWORK_ERROR',
      `无法连接 ${provider.preset.label} 接口，请检查网络或 Base URL。`,
      { requestId, cause: error.name },
    );
  }

  if (!response.ok) {
    const upstreamMessage = await readUpstreamError(response);
    throw new HttpError(
      response.status === 401 || response.status === 403 ? 401 : response.status,
      'UPSTREAM_ERROR',
      `${provider.preset.label} 返回错误：${upstreamMessage}`,
      {
        requestId,
        upstreamStatus: response.status,
        upstreamType: upstreamErrorType(response.status),
      },
    );
  }

  return response;
}

async function extractOpenAiText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }
  return '';
}

async function completeUpstream(provider, response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, 'INVALID_UPSTREAM_RESPONSE', '模型接口返回了无法解析的数据。');
  }

  if (provider.preset.kind === 'anthropic') {
    const text = Array.isArray(payload.content)
      ? payload.content
          .filter((block) => block?.type === 'text')
          .map((block) => block.text || '')
          .join('')
      : '';
    return {
      text,
      usage: normalizeUsage(payload.usage),
      model: payload.model || provider.model,
      finishReason: payload.stop_reason || '',
    };
  }

  return {
    text: await extractOpenAiText(payload),
    usage: normalizeUsage(payload.usage),
    model: payload.model || provider.model,
    finishReason: payload.choices?.[0]?.finish_reason || '',
  };
}

function sseWrite(res, event, data) {
  if (res.writableEnded || res.destroyed) return false;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return true;
}

/** 逐行解析上游 SSE。 */
async function proxyStream(provider, response, res, requestId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Request-Id': requestId,
  });
  res.flushHeaders?.();

  sseWrite(res, 'meta', {
    requestId,
    provider: provider.providerId,
    model: provider.model,
    at: new Date().toISOString(),
  });

  const reader = response.body?.getReader();
  if (!reader) {
    sseWrite(res, 'error', {
      code: 'EMPTY_STREAM',
      type: 'StreamError',
      message: '模型接口没有返回流式数据。',
      requestId,
    });
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let receivedText = false;
  let streamDone = false;
  let finishReason = '';

  const handleEventData = (data) => {
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') streamDone = true;
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    if (provider.preset.kind === 'anthropic') {
      if (event.type === 'message_start') {
        const normalized = normalizeUsage(event.message?.usage);
        if (normalized) usage = normalized;
      } else if (event.type === 'content_block_delta') {
        const text = event.delta?.type === 'text_delta' ? event.delta.text : '';
        if (text) {
          receivedText = true;
          sseWrite(res, 'delta', { text });
        }
      } else if (event.type === 'message_delta') {
        const normalized = normalizeUsage({
          ...(usage || {}),
          output_tokens: event.usage?.output_tokens,
        });
        if (normalized) usage = normalized;
        if (event.delta?.stop_reason) {
          finishReason = event.delta.stop_reason;
          streamDone = true;
        }
      } else if (event.type === 'message_stop') {
        streamDone = true;
      } else if (event.type === 'error') {
        throw new HttpError(
          502,
          'UPSTREAM_STREAM_ERROR',
          event.error?.message || '模型流式返回中断。',
          { requestId },
        );
      }
      return;
    }

    // OpenAI / DeepSeek 兼容格式
    const delta = event?.choices?.[0]?.delta;
    const text =
      typeof delta?.content === 'string'
        ? delta.content
        : Array.isArray(delta?.content)
          ? delta.content.map((part) => part?.text || '').join('')
          : '';
    if (text) {
      receivedText = true;
      sseWrite(res, 'delta', { text });
    }
    if (event.usage) usage = normalizeUsage(event.usage) || usage;
    if (event?.choices?.[0]?.finish_reason) {
      finishReason = event.choices[0].finish_reason;
      streamDone = true;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        handleEventData(line.slice(5).trim());
      }
    }
    if (buffer.startsWith('data:')) handleEventData(buffer.slice(5).trim());

    if (!receivedText) {
      sseWrite(res, 'error', {
        code: 'EMPTY_RESPONSE',
        type: 'EmptyResponseError',
        message: '模型没有返回任何文本，请检查模型名称或接口配置。',
        requestId,
      });
    } else {
      sseWrite(res, 'done', {
        requestId,
        usage,
        model: provider.model,
        finished: streamDone,
        finishReason,
      });
    }
  } catch (error) {
    if (res.destroyed) return;
    sseWrite(res, 'error', {
      code: error.code || 'STREAM_ERROR',
      type: error.name || 'Error',
      message: error.message || '流式响应中断。',
      requestId,
    });
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    if (!res.writableEnded) res.end();
  }
}

/* ------------------------------------------------------------------ */
/* API 处理                                                            */
/* ------------------------------------------------------------------ */

async function handleChat(req, res) {
  checkRateLimit(req, 'chat', 30, 60_000);
  const requestId = crypto.randomUUID();
  const body = await readJsonBody(req);
  const provider = resolveProviderConfig(body);
  const messages = normalizeMessages(body.messages);
  const options = {
    stream: body.stream !== false,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  try {
    const upstream = await fetchUpstream(provider, messages, options, controller.signal, requestId);

    if (options.stream) {
      await proxyStream(provider, upstream, res, requestId);
    } else {
      const result = await completeUpstream(provider, upstream);
      sendJson(
        res,
        200,
        {
          ok: true,
          text: result.text,
          usage: result.usage,
          model: result.model,
          provider: provider.providerId,
          finishReason: result.finishReason || '',
          requestId,
        },
        requestId,
      );
    }
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) {
        sseWrite(res, 'error', {
          code: error.code || 'STREAM_ERROR',
          type: error.name || 'Error',
          message: error.message || '流式请求失败。',
          detail: error.detail || null,
          requestId,
        });
        res.end();
      }
    } else {
      sendApiError(res, error, requestId);
    }
  } finally {
    clearTimeout(timeout);
    res.off('close', onClose);
  }
}

async function handleCheck(req, res) {
  checkRateLimit(req, 'check', 20, 60_000);
  const requestId = crypto.randomUUID();
  const body = await readJsonBody(req);
  const provider = resolveProviderConfig(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const startedAt = Date.now();

  try {
    const headers =
      provider.preset.kind === 'anthropic'
        ? {
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
          }
        : { Authorization: `Bearer ${provider.apiKey}` };

    const response = await fetch(`${provider.baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const latency = Date.now() - startedAt;

    if (response.ok) {
      let count = null;
      try {
        const payload = await response.json();
        count = Array.isArray(payload?.data) ? payload.data.length : null;
      } catch {
        /* ignore */
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          online: true,
          status: response.status,
          latency,
          modelCount: count,
          message: `连接正常，响应 ${latency}ms。`,
          requestId,
        },
        requestId,
      );
    } else if ([404, 405].includes(response.status)) {
      sendJson(
        res,
        200,
        {
          ok: true,
          online: true,
          status: response.status,
          latency,
          message: '接口可达，但该服务不支持模型列表预检。',
          warning: 'MODELS_NOT_SUPPORTED',
          requestId,
        },
        requestId,
      );
    } else {
      const upstreamMessage = await readUpstreamError(response);
      sendJson(
        res,
        200,
        {
          ok: false,
          online: false,
          status: response.status,
          latency,
          message: `连接失败：${upstreamMessage}`,
          requestId,
        },
        requestId,
      );
    }
  } catch (error) {
    const aborted = controller.signal.aborted;
    sendJson(
      res,
      200,
      {
        ok: false,
        online: false,
        status: 0,
        latency: Date.now() - startedAt,
        message: aborted
          ? '连接超时，请检查网络或 Base URL。'
          : '无法连接到该接口，请检查网络、Base URL 或代理设置。',
        code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        requestId,
      },
      requestId,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function handleHealth(req, res) {
  sendJson(res, 200, {
    ok: true,
    service: 'warm-isle',
    version: APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    at: new Date().toISOString(),
    serverKeys: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, provider]) => [
        id,
        Boolean(process.env[provider.keyEnv]),
      ]),
    ),
  });
}

/* ------------------------------------------------------------------ */
/* 静态文件                                                            */
/* ------------------------------------------------------------------ */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
}

async function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', '只支持 GET / HEAD。');
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', '路径编码不合法。');
  }

  if (relativePath === '/' || relativePath === '') relativePath = '/index.html';
  const resolved = path.resolve(PUBLIC_DIR, `.${relativePath}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    throw new HttpError(403, 'FORBIDDEN', '禁止访问该路径。');
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    // SPA 没有 history 路由（使用 hash），但为未知的无扩展名路径返回首页更友好。
    if (!path.extname(relativePath)) {
      return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'), true);
    }
    throw new HttpError(404, 'NOT_FOUND', '文件不存在。');
  }

  if (stat.isDirectory()) {
    return serveFile(req, res, path.join(resolved, 'index.html'), true);
  }
  return serveFile(req, res, resolved, resolved.endsWith('index.html'));
}

async function serveFile(req, res, filePath, isHtml) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', '文件不存在。');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  // 本地应用更新频繁，代码/样式不做强缓存，避免刷新后仍执行旧版本前端。
  const textAsset = ['.html', '.js', '.mjs', '.css', '.json', '.webmanifest'].includes(ext);
  const cacheControl = isHtml || textAsset ? 'no-cache' : 'public, max-age=3600';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'Last-Modified': stat.mtime.toUTCString(),
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.writableEnded) res.destroy();
  });
  stream.pipe(res);
}

/* ------------------------------------------------------------------ */
/* HTTP Server                                                         */
/* ------------------------------------------------------------------ */

const ACCESS_PASSWORD =
  process.env.WARM_ISLE_PASSWORD || process.env.APP_PASSWORD || '';

function hasPageAccess(req, pathname) {
  if (!ACCESS_PASSWORD) return true;
  // 平台健康检查保持公开，其余页面与 API 使用 Basic Auth。
  if (pathname === '/api/health') return true;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    return password === ACCESS_PASSWORD;
  } catch {
    return false;
  }
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    setSecurityHeaders(res);
    if (!hasPageAccess(req, pathname)) {
      res.writeHead(401, {
        'Content-Type': 'text/plain; charset=utf-8',
        'WWW-Authenticate': 'Basic realm="Warm Isle", charset="UTF-8"',
      });
      res.end('需要访问密码。');
      return;
    }
    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      // 只记录路径和状态，绝不记录请求体、API Key 或对话内容。
      console.log(`${req.method} ${pathname} ${res.statusCode} ${duration}ms`);
    });

    try {
      if (pathname === '/api/health') {
        if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '只支持 GET。');
        return await handleHealth(req, res);
      }
      if (pathname === '/api/check') {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '只支持 POST。');
        return await handleCheck(req, res);
      }
      if (pathname === '/api/chat') {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '只支持 POST。');
        return await handleChat(req, res);
      }
      if (pathname.startsWith('/api/')) {
        throw new HttpError(404, 'NOT_FOUND', 'API 路径不存在。');
      }
      return await serveStatic(req, res, pathname);
    } catch (error) {
      sendApiError(res, error, crypto.randomUUID());
    }
  });
}

export async function startServer({ port = PORT, host = HOST } = {}) {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  console.log(`\n  暖屿 Warm Isle v${APP_VERSION}`);
  console.log(`  ➜  http://${host}:${resolvedPort}`);
  console.log(`  ➜  模型密钥：${Object.entries(PROVIDERS)
    .map(([id, provider]) => `${id}=${process.env[provider.keyEnv] ? '已配置' : '未配置'}`)
    .join('  ')}`);
  console.log('  按 Ctrl+C 停止服务\n');
  return server;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const server = await startServer();
  const shutdown = () => {
    console.log('\n正在关闭暖屿服务…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
