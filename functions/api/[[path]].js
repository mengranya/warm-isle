/**
 * Cloudflare Pages Functions API。
 *
 * 与本地 server.mjs 保持同一套协议：
 * - /api/health
 * - /api/check
 * - /api/chat（OpenAI / DeepSeek 兼容格式与 Anthropic 流式转换）
 *
 * 纯 Web API 实现，不依赖 Node http 服务器。
 */

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

const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 180_000;
const REQUEST_TIMEOUT_MS = 120_000;

class ApiError extends Error {
  constructor(status, code, message, detail = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function json(data, status = 200, requestId = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (requestId) headers['X-Request-Id'] = requestId;
  return new Response(JSON.stringify(data), { status, headers });
}

function sendError(error, requestId) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  const message =
    error instanceof ApiError
      ? error.message
      : '服务端处理请求时发生异常，请稍后重试。';
  return json(
    {
      ok: false,
      error: {
        code,
        message,
        type: error?.name || 'Error',
        detail: error?.detail || null,
        requestId,
      },
      requestId,
    },
    status,
    requestId,
  );
}

function trimTo(value, max, fallback = '') {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeBaseUrl(raw) {
  if (!raw) throw new ApiError(400, 'INVALID_BASE_URL', '缺少 API Base URL。');
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new ApiError(400, 'INVALID_BASE_URL', 'API Base URL 格式不正确。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ApiError(400, 'INVALID_BASE_URL', 'API Base URL 只允许 http/https。');
  }
  if (url.username || url.password) {
    throw new ApiError(400, 'INVALID_BASE_URL', 'API Base URL 不允许包含用户名或密码。');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal') ||
    host === '0.0.0.0'
  ) {
    throw new ApiError(400, 'BLOCKED_HOST', '出于安全考虑，不允许访问该地址。');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function resolveProvider(input, env) {
  const providerId = trimTo(input.provider, 40, 'deepseek');
  const preset = PROVIDERS[providerId];
  if (!preset) throw new ApiError(400, 'UNKNOWN_PROVIDER', '未知的模型提供商。');
  const rawKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const apiKey = rawKey || String(env?.[preset.keyEnv] || '').trim();
  if (!apiKey) {
    throw new ApiError(
      400,
      'MISSING_API_KEY',
      `尚未配置 ${preset.label} API Key。请在设置中填写，或在 Cloudflare 环境变量中设置 ${preset.keyEnv}。`,
    );
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl || preset.baseUrl);
  const model = trimTo(input.model, 160);
  if (!model) throw new ApiError(400, 'MISSING_MODEL', '请提供模型名称。');
  return { providerId, preset, apiKey, baseUrl, model };
}

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApiError(400, 'INVALID_MESSAGES', 'messages 必须是非空数组。');
  }
  if (input.length > 100) throw new ApiError(400, 'TOO_MANY_MESSAGES', '消息数量过多。');
  let totalChars = 0;
  const messages = input.map((message, index) => {
    const role = message?.role;
    if (!['system', 'user', 'assistant'].includes(role)) {
      throw new ApiError(400, 'INVALID_MESSAGE_ROLE', `第 ${index + 1} 条消息的 role 不合法。`);
    }
    const content = typeof message.content === 'string' ? message.content : '';
    if (!content.trim()) {
      throw new ApiError(400, 'EMPTY_MESSAGE', `第 ${index + 1} 条消息内容为空。`);
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new ApiError(400, 'MESSAGE_TOO_LONG', `第 ${index + 1} 条消息超过长度限制。`);
    }
    totalChars += content.length;
    return { role, content };
  });
  if (totalChars > MAX_TOTAL_CHARS) {
    throw new ApiError(400, 'CONTEXT_TOO_LONG', '上下文过长，请先生成日记压缩记忆。');
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
  return message || `上游接口返回 HTTP ${response.status}。`;
}

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
      throw new ApiError(499, 'REQUEST_ABORTED', '请求已取消。', { requestId });
    }
    throw new ApiError(
      502,
      'NETWORK_ERROR',
      `无法连接 ${provider.preset.label} 接口，请检查网络或 Base URL。`,
      { requestId, cause: error?.name || 'Error' },
    );
  }
  if (!response.ok) {
    const upstreamMessage = await readUpstreamError(response);
    throw new ApiError(
      response.status === 401 || response.status === 403 ? 401 : response.status,
      'UPSTREAM_ERROR',
      `${provider.preset.label} 返回错误：${upstreamMessage}`,
      { requestId, upstreamStatus: response.status },
    );
  }
  return response;
}

function extractOpenAiText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

async function completeUpstream(provider, response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, 'INVALID_UPSTREAM_RESPONSE', '模型接口返回了无法解析的数据。');
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
    };
  }
  return {
    text: extractOpenAiText(payload),
    usage: normalizeUsage(payload.usage),
    model: payload.model || provider.model,
  };
}

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createSseResponse(provider, upstream, requestId) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let closed = false;
      const write = (event, data) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseFrame(event, data)));
      };
      write('meta', {
        requestId,
        provider: provider.providerId,
        model: provider.model,
        at: new Date().toISOString(),
      });

      const reader = upstream.body?.getReader();
      if (!reader) {
        write('error', {
          code: 'EMPTY_STREAM',
          type: 'StreamError',
          message: '模型接口没有返回流式数据。',
          requestId,
        });
        closed = true;
        controller.close();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let usage = null;
      let receivedText = false;
      let streamDone = false;

      const handleData = (data) => {
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
            usage = normalizeUsage(event.message?.usage) || usage;
          } else if (event.type === 'content_block_delta') {
            const text = event.delta?.type === 'text_delta' ? event.delta.text : '';
            if (text) {
              receivedText = true;
              write('delta', { text });
            }
          } else if (event.type === 'message_delta') {
            usage = normalizeUsage({ ...(usage || {}), output_tokens: event.usage?.output_tokens }) || usage;
            if (event.delta?.stop_reason) streamDone = true;
          } else if (event.type === 'message_stop') {
            streamDone = true;
          } else if (event.type === 'error') {
            throw new ApiError(
              502,
              'UPSTREAM_STREAM_ERROR',
              event.error?.message || '模型流式返回中断。',
              { requestId },
            );
          }
          return;
        }

        const delta = event?.choices?.[0]?.delta;
        const text =
          typeof delta?.content === 'string'
            ? delta.content
            : Array.isArray(delta?.content)
              ? delta.content.map((part) => part?.text || '').join('')
              : '';
        if (text) {
          receivedText = true;
          write('delta', { text });
        }
        if (event.usage) usage = normalizeUsage(event.usage) || usage;
        if (event?.choices?.[0]?.finish_reason) streamDone = true;
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data:')) handleData(line.slice(5).trim());
          }
        }
        if (buffer.startsWith('data:')) handleData(buffer.slice(5).trim());
        if (!receivedText) {
          write('error', {
            code: 'EMPTY_RESPONSE',
            type: 'EmptyResponseError',
            message: '模型没有返回任何文本，请检查模型名称或接口配置。',
            requestId,
          });
        } else {
          write('done', {
            requestId,
            usage,
            model: provider.model,
            finished: streamDone,
          });
        }
      } catch (error) {
        write('error', {
          code: error?.code || 'STREAM_ERROR',
          type: error?.name || 'Error',
          message: error?.message || '流式响应中断。',
          requestId,
        });
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });
}

async function handleChat(request, env) {
  const requestId = crypto.randomUUID();
  const body = await readJson(request);
  const provider = resolveProvider(body, env);
  const messages = normalizeMessages(body.messages);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const stream = body.stream !== false;

  try {
    const upstream = await fetchUpstream(
      provider,
      messages,
      {
        stream,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      },
      controller.signal,
      requestId,
    );

    if (stream) {
      return new Response(createSseResponse(provider, upstream, requestId), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          'X-Request-Id': requestId,
        },
      });
    }

    const result = await completeUpstream(provider, upstream);
    return json(
      {
        ok: true,
        text: result.text,
        usage: result.usage,
        model: result.model,
        provider: provider.providerId,
        requestId,
      },
      200,
      requestId,
    );
  } catch (error) {
    return sendError(error, requestId);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleCheck(request, env) {
  const requestId = crypto.randomUUID();
  try {
    const body = await readJson(request);
    const provider = resolveProvider(body, env);
    const startedAt = Date.now();
    const headers =
      provider.preset.kind === 'anthropic'
        ? {
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
          }
        : { Authorization: `Bearer ${provider.apiKey}` };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
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
        return json(
          {
            ok: true,
            online: true,
            status: response.status,
            latency,
            modelCount: count,
            message: `连接正常，响应 ${latency}ms。`,
            requestId,
          },
          200,
          requestId,
        );
      }
      if ([404, 405].includes(response.status)) {
        return json(
          {
            ok: true,
            online: true,
            status: response.status,
            latency,
            message: '接口可达，但该服务不支持模型列表预检。',
            warning: 'MODELS_NOT_SUPPORTED',
            requestId,
          },
          200,
          requestId,
        );
      }
      const upstreamMessage = await readUpstreamError(response);
      return json(
        {
          ok: false,
          online: false,
          status: response.status,
          latency,
          message: `连接失败：${upstreamMessage}`,
          requestId,
        },
        200,
        requestId,
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return json(
      {
        ok: false,
        online: false,
        status: 0,
        message: error?.message || '无法连接模型接口。',
        requestId,
      },
      200,
      requestId,
    );
  }
}

async function readJson(request) {
  const text = await request.text();
  if (!text) throw new ApiError(400, 'EMPTY_BODY', '请求体不能为空。');
  if (text.length > 2 * 1024 * 1024) {
    throw new ApiError(413, 'BODY_TOO_LARGE', '请求体过大。');
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('not object');
    }
    return body;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '请求体必须是 JSON 对象。');
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (pathname === '/api/health') {
    if (request.method !== 'GET') return sendError(new ApiError(405, 'METHOD_NOT_ALLOWED', '只支持 GET。'), crypto.randomUUID());
    return json({
      ok: true,
      service: 'warm-isle',
      version: '1.0.0',
      node: 'cloudflare',
      uptimeSeconds: 0,
      at: new Date().toISOString(),
      serverKeys: {
        deepseek: Boolean(env?.DEEPSEEK_API_KEY),
        openai: Boolean(env?.OPENAI_API_KEY),
        anthropic: Boolean(env?.ANTHROPIC_API_KEY),
        custom: Boolean(env?.CUSTOM_API_KEY),
      },
    });
  }

  if (pathname === '/api/check') {
    if (request.method !== 'POST') return sendError(new ApiError(405, 'METHOD_NOT_ALLOWED', '只支持 POST。'), crypto.randomUUID());
    return handleCheck(request, env);
  }

  if (pathname === '/api/chat') {
    if (request.method !== 'POST') return sendError(new ApiError(405, 'METHOD_NOT_ALLOWED', '只支持 POST。'), crypto.randomUUID());
    return handleChat(request, env);
  }

  return sendError(new ApiError(404, 'NOT_FOUND', 'API 路径不存在。'), crypto.randomUUID());
}
