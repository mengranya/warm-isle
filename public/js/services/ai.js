/**
 * 前端 AI 网关客户端。
 *
 * 浏览器只与本机 /api 通信；真正的上游请求由 server.mjs 发起，
 * 因而 API Key 不会暴露在 URL、Referrer 或跨域请求中。
 */

import { getProvider } from '../core/constants.js';

export class AIError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = options.name || 'AIError';
    this.code = options.code || 'AI_ERROR';
    this.type = options.type || this.name;
    this.status = options.status || 0;
    this.requestId = options.requestId || '';
    this.detail = options.detail || null;
    this.hint = options.hint || '';
  }
}

const completionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 24;

function cleanupCache() {
  const now = Date.now();
  for (const [key, entry] of completionCache) {
    if (now - entry.createdAt > CACHE_TTL_MS) completionCache.delete(key);
  }
  while (completionCache.size > CACHE_MAX_ENTRIES) {
    completionCache.delete(completionCache.keys().next().value);
  }
}

function buildPayload({ settings, messages, stream, apiKey }) {
  const provider = getProvider(settings.provider);
  return {
    provider: provider.id,
    model: settings.model,
    baseUrl: settings.baseUrl || undefined,
    // 调用方已经通过 app.getEffectiveApiKey() 处理了“服务端优先、本地回退”；
    // 这里不再因为 useServerKey=true 就丢弃本地 Key。
    apiKey: String(apiKey || '').trim() || undefined,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    stream,
    messages,
  };
}

function parseUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const promptTokens = Math.max(0, Math.round(Number(raw.promptTokens ?? raw.prompt_tokens) || 0));
  const completionTokens = Math.max(
    0,
    Math.round(Number(raw.completionTokens ?? raw.completion_tokens) || 0),
  );
  const totalTokens = Math.max(
    0,
    Math.round(Number(raw.totalTokens ?? raw.total_tokens) || promptTokens + completionTokens),
  );
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return { promptTokens, completionTokens, totalTokens, estimated: Boolean(raw.estimated) };
}

async function errorFromResponse(response) {
  const requestId = response.headers.get('x-request-id') || '';
  let payload = null;
  let rawText = '';
  try {
    rawText = await response.text();
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* keep raw */
  }

  const apiError = payload?.error;
  const message =
    apiError?.message ||
    payload?.message ||
    (rawText ? rawText.slice(0, 300) : '') ||
    `请求失败（HTTP ${response.status}）。`;

  return new AIError(message, {
    code: apiError?.code || `HTTP_${response.status}`,
    type: apiError?.type || 'APIError',
    status: response.status,
    requestId: apiError?.requestId || requestId,
    detail: apiError?.detail || null,
    hint:
      apiError?.code === 'MISSING_API_KEY'
        ? '打开设置，填写对应提供商的 API Key；或在 .env 中配置服务端密钥。'
        : '',
  });
}

function parseFrame(frame) {
  let event = 'message';
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  return { event, data: dataLines.join('\n') };
}

/**
 * 流式请求。返回完整文本与 usage。
 * 调用方负责把 onDelta 增量渲染到气泡。
 */
export async function streamChat({ settings, messages, apiKey, signal, onMeta, onDelta }) {
  if (!settings?.useServerKey && !String(apiKey || '').trim()) {
    throw new AIError('尚未配置 API Key。', {
      code: 'MISSING_LOCAL_KEY',
      type: 'SetupError',
      hint: '在设置中填写 API Key，或开启「使用服务端环境变量密钥」。',
    });
  }

  const payload = buildPayload({ settings, messages, stream: true, apiKey });
  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AIError('已停止生成。', { code: 'ABORTED', name: 'AbortError', type: 'AbortError' });
    }
    throw new AIError('无法连接暖屿本地服务，请确认 node server.mjs 正在运行。', {
      code: 'LOCAL_SERVER_UNREACHABLE',
      type: 'NetworkError',
      detail: error?.message || '',
    });
  }

  if (!response.ok) throw await errorFromResponse(response);

  const requestId = response.headers.get('x-request-id') || '';
  const reader = response.body?.getReader();
  if (!reader) {
    throw new AIError('响应没有可读取的流。', { code: 'EMPTY_STREAM', type: 'StreamError' });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage = null;
  let model = settings.model;
  let finished = false;
  let finishReason = '';
  let streamError = null;

  const consumeFrame = (frame) => {
    if (!frame.trim()) return;
    const { event, data } = parseFrame(frame);
    if (!data) return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'meta') {
      model = parsed.model || model;
      try {
        onMeta?.(parsed);
      } catch (error) {
        console.warn('onMeta 回调异常：', error);
      }
      return;
    }
    if (event === 'delta') {
      if (typeof parsed.text === 'string' && parsed.text) {
        content += parsed.text;
        try {
          onDelta?.(parsed.text, content);
        } catch (error) {
          console.warn('onDelta 回调异常：', error);
        }
      }
      return;
    }
    if (event === 'done') {
      usage = parseUsage(parsed.usage);
      model = parsed.model || model;
      finishReason = parsed.finishReason || '';
      finished = true;
      return;
    }
    if (event === 'error') {
      streamError = new AIError(parsed.message || '模型流式返回中断。', {
        code: parsed.code || 'STREAM_ERROR',
        type: parsed.type || 'StreamError',
        requestId: parsed.requestId || requestId,
        detail: parsed.detail || null,
      });
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consumeFrame(frame);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeFrame(buffer);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      throw new AIError('已停止生成。', { code: 'ABORTED', name: 'AbortError', type: 'AbortError' });
    }
    throw new AIError('读取模型流式响应时中断。', {
      code: 'STREAM_READ_ERROR',
      type: 'StreamError',
      requestId,
      detail: error?.message || '',
    });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  if (streamError) throw streamError;
  if (!content.trim()) {
    throw new AIError('模型没有返回任何文本，请稍后重试或更换模型。', {
      code: 'EMPTY_RESPONSE',
      type: 'EmptyResponseError',
      requestId,
    });
  }

  return { text: content, usage, model, requestId, finished, finishReason };
}

/** 非流式请求，用于生成日记、NPC 等短任务。 */
export async function completeChat({
  settings,
  messages,
  apiKey,
  signal,
  useCache = true,
  cacheScope = 'default',
}) {
  if (!settings?.useServerKey && !String(apiKey || '').trim()) {
    throw new AIError('尚未配置 API Key。', {
      code: 'MISSING_LOCAL_KEY',
      type: 'SetupError',
      hint: '在设置中填写 API Key，或开启「使用服务端环境变量密钥」。',
    });
  }

  const payload = buildPayload({ settings, messages, stream: false, apiKey });
  const cacheKey = JSON.stringify({
    scope: cacheScope,
    provider: payload.provider,
    model: payload.model,
    baseUrl: payload.baseUrl,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens,
    messages: payload.messages,
  });

  if (useCache) {
    cleanupCache();
    const cached = completionCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return { ...cached.value, cached: true };
    }
  }

  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AIError('请求已取消。', { code: 'ABORTED', name: 'AbortError', type: 'AbortError' });
    }
    throw new AIError('无法连接暖屿本地服务，请确认服务正在运行。', {
      code: 'LOCAL_SERVER_UNREACHABLE',
      type: 'NetworkError',
      detail: error?.message || '',
    });
  }

  if (!response.ok) throw await errorFromResponse(response);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AIError('模型返回了无法解析的数据。', {
      code: 'INVALID_RESPONSE',
      type: 'ParseError',
    });
  }
  // 非流式短任务也可能因为 max_tokens 过小在句中断开；自动用硬上限补一次。
  const finishReason = body?.finishReason || '';
  if (
    !signal?.aborted &&
    (finishReason === 'length' || finishReason === 'max_tokens') &&
    Number(payload.maxTokens) < 8_192
  ) {
    try {
      const retryPayload = buildPayload({
        settings: { ...settings, maxTokens: 8_192 },
        messages,
        stream: false,
        apiKey,
      });
      const retryResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(retryPayload),
        signal,
      });
      if (retryResponse.ok) {
        const retried = await retryResponse.json();
        if (retried?.text?.trim()) body = retried;
      }
    } catch {
      // 保留第一次的完整前缀，不因为补全失败而丢掉已有内容。
    }
  }

  if (!body?.text?.trim()) {
    throw new AIError('模型没有返回任何文本。', {
      code: 'EMPTY_RESPONSE',
      type: 'EmptyResponseError',
      requestId: body?.requestId || '',
    });
  }

  const result = {
    text: body.text,
    usage: parseUsage(body.usage),
    model: body.model || settings.model,
    provider: body.provider || settings.provider,
    finishReason: body.finishReason || '',
    requestId: body.requestId || '',
    cached: false,
  };

  if (useCache) {
    completionCache.set(cacheKey, { value: result, createdAt: Date.now() });
    cleanupCache();
  }
  return result;
}

export async function checkConnection({ settings, apiKey, signal }) {
  const provider = getProvider(settings.provider);
  let response;
  try {
    response = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: provider.id,
        model: settings.model,
        baseUrl: settings.baseUrl || undefined,
        apiKey: String(apiKey || '').trim() || undefined,
      }),
      signal,
    });
  } catch (error) {
    return {
      ok: false,
      online: false,
      message: '无法连接本地服务，请确认 node server.mjs 正在运行。',
      code: 'LOCAL_SERVER_UNREACHABLE',
    };
  }

  try {
    const body = await response.json();
    if (!response.ok) {
      return {
        ok: false,
        online: false,
        message: body?.error?.message || '连接检测失败。',
        code: body?.error?.code || 'CHECK_FAILED',
      };
    }
    return body;
  } catch {
    return { ok: false, online: false, message: '连接检测返回了无法解析的数据。' };
  }
}

export async function fetchHealth(signal) {
  try {
    const response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function clearCompletionCache() {
  completionCache.clear();
}
