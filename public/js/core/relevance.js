/**
 * 轻量相关性检索：不调用向量模型，不产生额外 token。
 * 用于从世界书条目与日记中挑选与当前对话最相关的内容。
 */

import { normalizeMemoryStrength } from './memory-strength.js';
import { compilePluginRuntime } from './plugins.js';
import { compactText, truncateText } from './utils.js';

const STOP_WORDS = new Set([
  '我们',
  '你们',
  '他们',
  '这个',
  '那个',
  '什么',
  '怎么',
  '就是',
  '还是',
  '因为',
  '所以',
  '但是',
  '然后',
  '现在',
  '已经',
  '可以',
  '一个',
  '没有',
  '不是',
  '自己',
  '真的',
  '知道',
  '觉得',
  '这样',
  '那样',
  '如果',
  '时候',
  'the',
  'and',
  'that',
  'this',
  'with',
  'you',
  'are',
  'for',
  'was',
  'have',
]);

/** 从自由文本中拆出中文二元组与拉丁词，作为极简检索词集合。 */
export function extractQueryTerms(text) {
  const normalized = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = new Set();

  for (const word of normalized.match(/[a-z0-9]{2,}/g) || []) {
    if (!STOP_WORDS.has(word)) terms.add(word);
  }

  for (const segment of normalized.match(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g) || []) {
    for (let index = 0; index < segment.length - 1; index += 1) {
      const bigram = segment.slice(index, index + 2);
      if (!STOP_WORDS.has(bigram)) terms.add(bigram);
    }
  }

  return terms;
}

function overlapScore(text, terms) {
  if (!text || !terms.size) return 0;
  const normalized = String(text).toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) score += term.length > 1 ? 1 : 0.4;
  }
  return score;
}

function entryScore(entry, terms, queryText) {
  const query = String(queryText || '').toLowerCase();
  let score = 0;
  for (const keyword of entry.keywords || []) {
    const clean = String(keyword).toLowerCase().trim();
    if (!clean) continue;
    if (query.includes(clean)) score += 8;
    else score += overlapScore(clean, terms) * 2;
  }
  score += overlapScore(entry.title, terms) * 3;
  score += overlapScore(entry.content, terms);
  score += (entry.priority || 0) * 0.02;
  if (entry.pinned) score += 3;
  return score;
}

/**
 * 选出当前场景需要的世界书条目。
 * pinned 条目必带，其余按相关性排序，受字符预算限制。
 */
export function selectWorldEntries(
  worldbook,
  queryText,
  { maxChars = 850, maxEntries = 4 } = {},
) {
  if (!worldbook || !Array.isArray(worldbook.entries) || !worldbook.entries.length) {
    return { selected: [], chars: 0 };
  }

  const terms = extractQueryTerms(queryText);
  const scored = worldbook.entries.map((entry) => ({
    entry,
    score: entryScore(entry, terms, queryText),
  }));

  const pinned = scored
    .filter((item) => item.entry.pinned)
    .sort((a, b) => (b.entry.priority || 0) - (a.entry.priority || 0) || b.score - a.score);
  const rest = scored
    .filter((item) => !item.entry.pinned)
    .sort((a, b) => b.score - a.score || (b.entry.priority || 0) - (a.entry.priority || 0));

  const ordered = [...pinned, ...rest];
  const selected = [];
  let chars = 0;

  for (const item of ordered) {
    if (selected.length >= maxEntries) break;
    const content = compactText(item.entry.content, Math.min(480, maxChars));
    const cost = content.length + (item.entry.title?.length || 0) + 6;
    if (chars + cost > maxChars && selected.length > 0) continue;
    selected.push({
      id: item.entry.id,
      title: item.entry.title,
      content: chars + cost > maxChars ? truncateText(content, Math.max(120, maxChars - chars - 12)) : content,
      pinned: Boolean(item.entry.pinned),
      score: Number(item.score.toFixed(2)),
    });
    chars += cost;
  }

  return { selected, chars };
}

/** 从日记中选出最新 + 与当前话题最相关的片段。 */
export function selectDiaries(
  diaries,
  queryText,
  { maxChars = 620, maxEntries = 4 } = {},
) {
  if (!Array.isArray(diaries) || !diaries.length) {
    return { selected: [], chars: 0 };
  }

  const terms = extractQueryTerms(queryText);
  const latestIndex = diaries.length - 1;
  const scored = diaries.map((diary, index) => {
    const recency = Math.max(0, 5 - (latestIndex - index) * 0.45);
    return {
      diary,
      index,
      score: overlapScore(diary.content, terms) * 1.6 + recency + (index === latestIndex ? 4 : 0),
    };
  });

  // 最新一篇始终保留，其余按相关性排序。
  const latest = scored[latestIndex];
  const ordered = [
    latest,
    ...scored
      .filter((item) => item.index !== latestIndex)
      .sort((a, b) => b.score - a.score || b.index - a.index),
  ];

  const selected = [];
  let chars = 0;
  for (const item of ordered) {
    if (selected.length >= maxEntries) break;
    const strength = normalizeMemoryStrength(item.diary.memoryStrength, 40);
    if (strength <= 0) continue;
    const full = strength >= 100;
    const perDiaryLimit =
      strength >= 100 ? 50_000 : strength >= 81 ? 1_800 : strength >= 61 ? 900 : strength >= 41 ? 450 : 280;
    const content = full
      ? String(item.diary.content || '')
      : truncateText(compactText(item.diary.content, perDiaryLimit), perDiaryLimit);
    const cost = content.length + 14;
    if (!full && chars + cost > maxChars && selected.length > 0) continue;
    selected.push({
      ...item.diary,
      excerpt: content,
      relevance: Number(item.score.toFixed(2)),
    });
    chars += cost;
  }

  // 按时间正序排列，便于模型理解记忆的先后。
  selected.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return { selected, chars };
}

/**
 * 兼容旧调用：转发到插件运行时编译器。
 * 不再使用旧的“最多 4 个 / 每个截断 500 字”逻辑。
 */
export function selectPlugins(plugins, { maxChars = 7_000, maxPlugins = 16 } = {}) {
  const runtime = compilePluginRuntime(plugins, {
    maxPromptChars: maxChars,
    maxPlugins,
  });
  return {
    selected: runtime.selected,
    chars: runtime.chars,
  };
}

/**
 * 只保留“尚未被日记压缩”的对话，并按字符预算截取最近若干条。
 * 这既是记忆系统的一部分，也是控制 token 的关键。
 */
export function trimHistory(
  messages,
  summarizedUntil = 0,
  { maxChars = 1_700, maxMessages = 12, maxMessageChars = 1_200 } = {},
) {
  const source = (Array.isArray(messages) ? messages : [])
    .slice(Math.max(0, summarizedUntil))
    .filter((message) => ['user', 'assistant'].includes(message.role) && message.content);

  const picked = [];
  let chars = 0;
  const perMessageLimit = Math.max(300, Number(maxMessageChars) || 1_200);
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    const content = truncateText(
      compactText(message.content, perMessageLimit),
      perMessageLimit,
    );
    const cost = content.length + 8;
    if (picked.length >= maxMessages) break;
    if (chars + cost > maxChars && picked.length > 0) break;
    picked.unshift({ role: message.role, content });
    chars += cost;
  }

  return { messages: picked, chars, summarizedCount: Math.max(0, summarizedUntil) };
}
