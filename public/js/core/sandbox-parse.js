/**
 * 沙盒世界 AI 回复解析。
 * 正文与控制块分离；控制块不会显示给玩家。
 */

import { normalizeWhitespace, parseLooseJson } from './utils.js';

const BLOCK_START = /<\s*sandbox\b[^>]*>/i;
const BLOCK_END = /<\/\s*sandbox\s*>/i;
const ALT_START = /<\s*world_state\b[^>]*>/i;
const ALT_END = /<\/\s*world_state\s*>/i;

function extractBlock(raw) {
  const source = String(raw || '');
  let startMatch = source.match(BLOCK_START);
  let startTag = startMatch?.[0] || '';
  let endTag = BLOCK_END;
  if (!startMatch) {
    startMatch = source.match(ALT_START);
    startTag = startMatch?.[0] || '';
    endTag = ALT_END;
  }
  if (!startMatch || startMatch.index === undefined) {
    return { narrative: source, blockRaw: '', hadBlock: false };
  }

  const before = source.slice(0, startMatch.index);
  const after = source.slice(startMatch.index + startTag.length);
  const endMatch = after.match(endTag);
  const blockRaw = (endMatch ? after.slice(0, endMatch.index) : after).trim();
  return {
    narrative: before,
    blockRaw,
    hadBlock: true,
  };
}

function cleanNarrative(narrative) {
  return normalizeWhitespace(
    String(narrative || '')
      .replace(/^\s*<narration>/i, '')
      .replace(/<\/narration>\s*$/i, '')
      .replace(/```(?:json)?\s*$/i, '')
      .trim(),
  );
}

/** 完整解析；state 为 null 表示模型没有给出合法控制块。 */
export function extractSandboxPayload(raw) {
  const { narrative, blockRaw, hadBlock } = extractBlock(raw);
  let state = null;
  if (blockRaw) {
    state = parseLooseJson(blockRaw);
  }
  return {
    narrative: cleanNarrative(narrative),
    state: state && typeof state === 'object' && !Array.isArray(state) ? state : null,
    rawState: blockRaw,
    hadBlock,
  };
}

/**
 * 流式显示时只显示正文；一旦进入状态块就隐藏。
 */
export function getSandboxStreamingVisibleText(raw) {
  const source = String(raw || '');
  const match = source.match(/<\s*(?:sandbox|world_state)\b/i);
  if (match?.index !== undefined) {
    return cleanNarrative(source.slice(0, match.index));
  }
  // 防止标签尚未收全时露出 "<sand"。
  const trailing = source.match(/<\s*s?a?n?d?b?o?x?[^>]*$/i);
  if (trailing?.index !== undefined && trailing[0].trimStart().startsWith('<')) {
    return cleanNarrative(source.slice(0, trailing.index));
  }
  return cleanNarrative(source);
}

/**
 * 「辅助决定」插件输出的思路提示。
 * 只作为正文末尾的提示栏，不进入正文，也不成为可点击选项。
 */
export function splitDecisionHints(text) {
  const source = String(text || '');
  const marker = source.lastIndexOf('【思路提示】');
  if (marker < 0) return { narrative: source, hints: [] };
  const before = source.slice(0, marker).trim();
  const body = source.slice(marker + '【思路提示】'.length);
  const hints = body
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[.、)]\s*/, '')
        .replace(/^思路提示[:：]?\s*/, '')
        .trim(),
    )
    .filter(
      (line) =>
        line.length >= 4 &&
        line.length <= 260 &&
        !/^[-—=]{2,}$/.test(line) &&
        !/(你应该|最佳选择是|你必须选择|你决定|你选择)/.test(line),
    )
    .slice(0, 6);
  return {
    narrative: before,
    hints,
  };
}

/** 只取控制块，用于调试或导入。 */
export function extractSandboxState(raw) {
  return extractSandboxPayload(raw).state;
}
