/**
 * 纯工具函数集合。
 * 尽量不访问 window / document，便于在 Node 测试中复用。
 */

import { LIMITS } from './constants.js';

export function createId(prefix = 'id') {
  let random = '';
  try {
    random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12);
  } catch {
    /* ignore */
  }
  if (!random) {
    random = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  return `${prefix}_${random}`;
}

export function clone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function flattenText(text, max = 20_000) {
  return normalizeWhitespace(text).replace(/\s+/g, ' ').slice(0, max);
}

/** 按字符截断，尽量在句末或空白处收尾，避免提示词被腰斩。 */
export function truncateText(text, max = 200, ellipsis = '…') {
  const source = String(text ?? '').trim();
  if (!source) return '';
  const chars = Array.from(source);
  if (chars.length <= max) return source;
  const slice = chars.slice(0, Math.max(1, max - 1)).join('');
  const lastBreak = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf('，'),
  );
  const cut = lastBreak > Math.floor((max - 1) * 0.55) ? slice.slice(0, lastBreak + 1) : slice;
  return `${cut.trimEnd()}${ellipsis}`;
}

/** 单行压缩，用于嵌入提示词。 */
export function compactText(text, max = 600) {
  return truncateText(flattenText(text, max + 200), max);
}

export function safeColor(value, fallback = '#c56b57') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw
      .slice(1)
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`.toLowerCase();
  }
  return fallback;
}

export function hexToRgb(hex) {
  const color = safeColor(hex);
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickBySeed(list, seed, offset = 0) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[(hashString(seed) + offset) % list.length];
}

export function debounce(fn, wait = 200) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function throttle(fn, wait = 80) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = null;
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

export function formatDateTime(value, { withSeconds = false } = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}${withSeconds ? `:${pad(date.getSeconds())}` : ''}`;
}

export function formatShortTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const pad = (number) => String(number).padStart(2, '0');
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatRelative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return formatDateTime(value).split(' ')[0];
}

export function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(safeNumber(value))));
}

export function formatCompactNumber(value) {
  const number = Math.max(0, safeNumber(value));
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}m`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(number));
}

/**
 * 轻量 token 估算。用于上游没有返回 usage 时的兜底，不作为计费依据。
 * 中文约 0.85 token/字，拉丁文本约 3.6 字符/token。
 */
export function estimateTokens(text) {
  const source = String(text ?? '');
  if (!source) return 0;
  const cjk = (source.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const others = source.length - cjk;
  return Math.max(1, Math.ceil(cjk * 0.85 + others / 3.6));
}

export function normalizeUsage(usage, promptText = '', completionText = '') {
  const promptTokens = Math.max(0, Math.round(safeNumber(usage?.promptTokens)));
  const completionTokens = Math.max(0, Math.round(safeNumber(usage?.completionTokens)));
  const totalTokens = Math.max(
    0,
    Math.round(safeNumber(usage?.totalTokens)) || promptTokens + completionTokens,
  );
  if (promptTokens || completionTokens || totalTokens) {
    return { promptTokens, completionTokens, totalTokens, estimated: false };
  }
  const estimatedPrompt = estimateTokens(promptText);
  const estimatedCompletion = estimateTokens(completionText);
  return {
    promptTokens: estimatedPrompt,
    completionTokens: estimatedCompletion,
    totalTokens: estimatedPrompt + estimatedCompletion,
    estimated: true,
  };
}

export function addUsage(target, usage) {
  if (!target || !usage) return target;
  target.requests = Math.max(0, safeNumber(target.requests)) + 1;
  target.promptTokens = Math.max(0, safeNumber(target.promptTokens)) + safeNumber(usage.promptTokens);
  target.completionTokens =
    Math.max(0, safeNumber(target.completionTokens)) + safeNumber(usage.completionTokens);
  target.totalTokens = Math.max(0, safeNumber(target.totalTokens)) + safeNumber(usage.totalTokens);
  target.estimated = Math.max(0, safeNumber(target.estimated)) + (usage.estimated ? 1 : 0);
  target.last = {
    ...usage,
    at: new Date().toISOString(),
  };
  return target;
}

export function createUsageBucket() {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimated: 0,
    last: null,
  };
}

export function isEndsWithEmoji(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return false;
  try {
    return /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\s*$/u.test(trimmed);
  } catch {
    return false;
  }
}

export function isWritingComposition(event) {
  return Boolean(event?.isComposing || event?.keyCode === 229 || event?.which === 229);
}

/** 从可能带 ```json 围栏的文本中提取 JSON。 */
export function parseLooseJson(raw) {
  if (typeof raw !== 'string') return raw;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(text.slice(objectStart, objectEnd + 1));
    } catch {
      /* continue */
    }
  }
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    } catch {
      /* continue */
    }
  }
  return null;
}

export function sanitizeFileName(name, fallback = 'warm-isle') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_500);
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadJson(filename, value, { pretty = true } = {}) {
  const text = JSON.stringify(value, null, pretty ? 2 : 0);
  downloadText(filename.endsWith('.json') ? filename : `${filename}.json`, text, 'application/json;charset=utf-8');
}

export async function readTextFile(file, maxBytes = 2 * 1024 * 1024) {
  if (!file) throw new Error('没有选择文件。');
  if (file.size > maxBytes) {
    throw new Error(`文件超过 ${Math.round(maxBytes / 1024)} KB，无法导入。`);
  }
  return await file.text();
}

export function toArray(value, max = LIMITS.maxImportedItems) {
  if (Array.isArray(value)) return value.slice(0, max);
  if (value === null || value === undefined) return [];
  return [value];
}

export function uniqueBy(list, keyFn) {
  const seen = new Set();
  return list.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatBytes(bytes) {
  const value = safeNumber(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function countChars(text) {
  const value = String(text ?? '');
  // 中文等 BMP 字符不需要展开成码点数组；只有遇到代理对时才走慢路径。
  if (!/[\uD800-\uDFFF]/.test(value)) return value.length;
  return Array.from(value).length;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertNever(value) {
  throw new Error(`Unexpected value: ${String(value)}`);
}
