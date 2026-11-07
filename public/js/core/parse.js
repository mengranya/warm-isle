/**
 * AI 文本解析：把正文与隐藏状态块分离，并解析日记 / NPC JSON。
 * 所有解析都应该是“宽容但安全”的——模型格式轻微跑偏不影响正文显示。
 */

import {
  countChars,
  isEndsWithEmoji,
  normalizeWhitespace,
  parseLooseJson,
  pickBySeed,
  safeColor,
  truncateText,
} from './utils.js';

const STATUS_START = /[<＜]\s*(?:status\b|状态(?=\s|[>＞]))[^>＞]*[>＞]/i;
const STATUS_START_LOOSE = /[<＜]\s*(?:status\b|状态(?=\s|[>＞]))/i;
const STATUS_END = /[<＜]\s*[\/／]\s*(?:status|状态)\s*[>＞]/i;
const CHINESE_STATUS_START =
  /(?:^|\n)\s*(?:\*{0,2}\s*(?:【\s*(?:角色)?状态\s*】|(?:角色)?状态\s*[:：])\s*\*{0,2})/;
const CHINESE_STATUS_JSON = /(?:【\s*(?:角色)?状态\s*】|(?:角色)?状态\s*[:：])\s*\{/;

function cleanStatusValue(value, max = 400) {
  if (value === null || value === undefined) return '';
  const text = String(value)
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateText(text, max, '');
}

function pickStatusValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

export function normalizeStatusPatch(input) {
  if (!input || typeof input !== 'object') return null;
  if (Array.isArray(input)) input = input.find((item) => item && typeof item === 'object');
  if (!input || typeof input !== 'object') return null;
  const nestedKeys = [
    'status',
    'state',
    'currentStatus',
    '角色状态',
    '当前状态',
    '状态',
  ];
  const nested = nestedKeys
    .map((key) => input[key])
    .find((value) => value && typeof value === 'object');
  if (nested) input = nested;
  const patch = {
    health: cleanStatusValue(
      pickStatusValue(input, ['health', '身体状况', '身体状态', '健康状态', '身体', '健康']),
      160,
    ),
    outfit: cleanStatusValue(
      pickStatusValue(input, ['outfit', 'clothing', '当前衣着', '衣着', '服装', '穿着']),
      180,
    ),
    environment: cleanStatusValue(
      pickStatusValue(input, ['environment', 'location', '所处环境', '环境', '地点', '位置']),
      180,
    ),
    action: cleanStatusValue(
      pickStatusValue(input, ['action', '正在进行的动作', '当前动作', '动作', '行为']),
      180,
    ),
    notes: cleanStatusValue(
      pickStatusValue(input, ['notes', 'detail', '补充描写', '补充', '补述', '细节', '备注']),
      1_000,
    ),
  };
  const hasAny = Object.values(patch).some(Boolean);
  if (!hasAny) return null;
  patch.updatedAt = new Date().toISOString();
  patch.source = 'ai';
  return patch;
}

function parseLabeledStatus(raw) {
  const fields = {
    health: ['身体状况', '身体状态', '健康状态', '身体', '健康', 'health'],
    outfit: ['当前衣着', '衣着', '服装', '穿着', 'outfit', 'clothing'],
    environment: ['所处环境', '环境', '地点', '位置', 'environment', 'location'],
    action: ['正在进行的动作', '当前动作', '动作', '行为', 'action'],
    notes: ['补充描写', '补充', '补述', '细节', '备注', 'notes'],
  };
  const result = {};
  for (const [key, labels] of Object.entries(fields)) {
    for (const label of labels) {
      const regex = new RegExp(
        `(?:^|[\\n,，;；、|{])\\s*(?:[-*•]\\s*)?\\*{0,2}["“']?${label}(?:\\s*[（(][^）)]*[）)])?["”']?\\*{0,2}\\s*[:：]\\s*["“']?([^"\\n,，;；}]+)`,
        'i',
      );
      const match = raw.match(regex);
      if (match?.[1]) {
        result[key] = match[1].replace(/["”'’]/g, '').trim();
        break;
      }
    }
  }
  return normalizeStatusPatch(result);
}

function parseStatusTags(raw) {
  const fields = {
    health: ['身体状况', '身体状态', '健康状态', '身体', '健康', 'health'],
    outfit: ['当前衣着', '衣着', '服装', '穿着', 'outfit', 'clothing'],
    environment: ['所处环境', '环境', '地点', '位置', 'environment', 'location'],
    action: ['正在进行的动作', '当前动作', '动作', '行为', 'action'],
    notes: ['补充描写', '补充', '补述', '细节', '备注', 'notes'],
  };
  const result = {};
  for (const [key, labels] of Object.entries(fields)) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = String(raw).match(
        new RegExp(`<\\s*${escaped}\\s*>([\\s\\S]*?)<\\s*\\/\\s*${escaped}\\s*>`, 'i'),
      );
      if (match?.[1]) {
        result[key] = match[1];
        break;
      }
    }
  }
  return normalizeStatusPatch(result);
}

function parseStatusBrackets(raw) {
  const fields = {
    health: ['身体状况', '身体状态', '健康状态', '身体', '健康', 'health'],
    outfit: ['当前衣着', '衣着', '服装', '穿着', 'outfit', 'clothing'],
    environment: ['所处环境', '环境', '地点', '位置', 'environment', 'location'],
    action: ['正在进行的动作', '当前动作', '动作', '行为', 'action'],
    notes: ['补充描写', '补充', '补述', '细节', '备注', 'notes'],
  };
  const result = {};
  for (const [key, labels] of Object.entries(fields)) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = String(raw).match(
        new RegExp(`(?:【|\\[)\\s*${escaped}\\s*(?:】|\\])\\s*[:：]?\\s*([^\\n|,，;；【\\[]+)`, 'i'),
      );
      if (match?.[1]) {
        result[key] = match[1];
        break;
      }
    }
  }
  return normalizeStatusPatch(result);
}

function parseStatusTable(raw) {
  const fields = {
    health: ['身体状况', '身体状态', '健康状态', '身体', '健康', 'health'],
    outfit: ['当前衣着', '衣着', '服装', '穿着', 'outfit', 'clothing'],
    environment: ['所处环境', '环境', '地点', '位置', 'environment', 'location'],
    action: ['正在进行的动作', '当前动作', '动作', '行为', 'action'],
    notes: ['补充描写', '补充', '补述', '细节', '备注', 'notes'],
  };
  const result = {};
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell && !/^:?-{2,}:?$/.test(cell));
    if (cells.length < 2) continue;
    const label = cells[0].replace(/[*"“”'‘’]/g, '').trim();
    const key = Object.entries(fields).find(([, labels]) =>
      labels.some((item) => item.toLowerCase() === label.toLowerCase()),
    )?.[0];
    if (key && cells[1]) result[key] = cells[1];
  }
  return normalizeStatusPatch(result);
}

function parseStatusCandidate(raw) {
  if (!raw) return null;
  const text = String(raw)
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed = parseLooseJson(text);
  if (typeof parsed === 'string') parsed = parseLooseJson(parsed);
  if (parsed && typeof parsed === 'object') {
    const status = normalizeStatusPatch(parsed);
    if (status) return status;
  }
  // JSON 轻微跑偏或字段名不在标准列表时，继续尝试标签 / 表格 / XML 标签解析。
  return (
    parseLabeledStatus(text.replace(/\*\*/g, '')) ||
    parseStatusTable(text) ||
    parseStatusTags(text) ||
    parseStatusBrackets(text)
  );
}

function statusFieldCount(status) {
  return ['health', 'outfit', 'environment', 'action', 'notes'].filter(
    (key) => status?.[key],
  ).length;
}

/**
 * 插件只写了 health/outfit 等字段名时，模型可能不使用 <status> 标签。
 * 只在末尾识别至少两个字段，避免把正文里的普通描述误删。
 */
function extractLooseStatus(content) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenced?.index !== undefined) {
    const status = parseStatusCandidate(fenced[1]);
    if (statusFieldCount(status) >= 2) {
      return { status, index: fenced.index };
    }
  }

  const labeledStart = content.search(
    /(?:^|\n)\s*(?:[-*•]\s*)?\*{0,2}(?:health|身体状况|健康|outfit|当前衣着|衣着|environment|所处环境|环境|action|正在进行的动作|动作)(?:\s*[（(][^）)]*[）)])?\*{0,2}\s*[:：]/i,
  );
  if (labeledStart >= 0) {
    const status = parseStatusCandidate(content.slice(labeledStart));
    if (statusFieldCount(status) >= 2) {
      return { status, index: labeledStart };
    }
  }

  const keywordStart = content.search(
    /(?:身体状况|身体状态|健康状态|当前衣着|衣着|服装|所处环境|环境|地点|正在进行的动作|当前动作|动作|health|outfit|environment|action)\s*[:：=]/i,
  );
  if (keywordStart >= 0) {
    const status = parseStatusCandidate(content.slice(keywordStart));
    if (statusFieldCount(status) >= 2) {
      return { status, index: keywordStart };
    }
  }

  const tableStart = content.search(
    /(?:^|\n)\s*\|?\s*(?:身体状况|身体状态|当前衣着|衣着|所处环境|环境|正在进行的动作|动作|health|outfit|environment|action)\s*\|/i,
  );
  if (tableStart >= 0) {
    const status = parseStatusCandidate(content.slice(tableStart));
    if (statusFieldCount(status) >= 2) {
      return { status, index: tableStart };
    }
  }

  // 模型有时会漏掉 <status> 标签，直接在正文末尾输出 JSON；
  // 从正文末尾附近最早的 { / [ 开始尝试，能连同 state / 角色状态 外壳一起移除。
  const scanFrom = Math.max(0, content.length - 4_000);
  for (let index = scanFrom; index < content.length; index += 1) {
    if (content[index] !== '{' && content[index] !== '[') continue;
    const status = parseStatusCandidate(content.slice(index));
    if (statusFieldCount(status) >= 2) {
      return { status, index };
    }
  }

  return null;
}

function extractStatus(raw) {
  if (!raw) return { content: '', status: null, hadStatusBlock: false, statusPreview: '' };

  const original = String(raw);
  let content = original;
  let statusRaw = null;
  let hadStatusBlock = false;

  const startMatch = content.match(STATUS_START);
  if (startMatch && startMatch.index !== undefined) {
    hadStatusBlock = true;
    const before = content.slice(0, startMatch.index);
    const after = content.slice(startMatch.index + startMatch[0].length);
    const endMatch = after.match(STATUS_END);
    statusRaw = (endMatch ? after.slice(0, endMatch.index) : after).trim();
    content = before;
  } else {
    // 兼容模型擅自使用【状态】/【角色状态】作为控制块开头的情况。
    const looseStart = content.search(CHINESE_STATUS_START);
    const looseJsonStart = content.search(CHINESE_STATUS_JSON);
    const labelStart =
      looseJsonStart >= 0 && (looseStart < 0 || looseJsonStart >= looseStart)
        ? looseJsonStart
        : looseStart;
    if (labelStart >= 0) {
      const block = content.slice(labelStart);
      const jsonMatch = block.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        hadStatusBlock = true;
        statusRaw = jsonMatch[0];
        content = content.slice(0, labelStart);
      }
    }
  }

  // 没有控制块时，不要误删正文。
  let status = null;
  if (statusRaw) {
    status = parseStatusCandidate(statusRaw);
  }

  // 兼容插件只要求字段名、模型却漏掉 <status> 标签的情况。
  if (!status) {
    const loose = extractLooseStatus(original);
    if (loose?.status) {
      status = loose.status;
      content = original.slice(0, loose.index);
      hadStatusBlock = true;
    }
  }

  content = content
    .replace(/^\s*<reply>/i, '')
    .replace(/<\/reply>\s*$/i, '')
    .replace(/```(?:json)?\s*$/i, '')
    .trim();

  return {
    content,
    status,
    hadStatusBlock,
    statusPreview: statusRaw
      ? String(statusRaw).slice(0, 600)
      : status
        ? ''
        : `${String(original).slice(0, 300)}${
            String(original).length > 900 ? '\n…\n' : ''
          }${String(original).slice(-600)}`,
  };
}

/** 解析完整回复，返回可显示的正文与状态补丁。 */
export function extractAssistantPayload(raw) {
  return extractStatus(raw);
}

/**
 * 流式输出时只展示正文，状态块一旦开始出现就隐藏。
 * 这样用户不会看到 JSON 闪烁。
 */
export function getStreamingVisibleText(raw) {
  if (!raw) return '';
  let content = String(raw);
  const startMatch = content.match(STATUS_START_LOOSE);
  if (startMatch?.index !== undefined) {
    content = content.slice(0, startMatch.index);
  } else {
    // 避免标签还没收全时短暂露出 “<st”。
    const trailingTag = content.match(/<\s*s?t?a?t?u?s?[^>]*$/i);
    if (trailingTag?.index !== undefined && trailingTag[0].startsWith('<')) {
      content = content.slice(0, trailingTag.index);
    }
  }
  return content
    .replace(/^\s*<reply>/i, '')
    .replace(/<\/reply>\s*$/i, '')
    .trimEnd();
}

/** 根据人格设置自动追加结尾 emoji；模型已经用 emoji 结尾时不重复。 */
export function appendEmojiTail(content, persona, seed = '') {
  const text = String(content || '').trimEnd();
  const dialogue = persona?.dialogue;
  if (!text || !dialogue?.emojiEnabled || !dialogue?.emojis?.length) return text;
  if (isEndsWithEmoji(text)) return text;
  const emoji = pickBySeed(dialogue.emojis, `${persona?.id || persona?.name || ''}:${seed}:${text}`);
  return emoji ? `${text} ${emoji}` : text;
}

/** 去除日记可能带上的标题、代码围栏与引号。 */
export function extractDiaryText(raw) {
  if (!raw) return '';
  let text = String(raw).trim();
  const diaryTag = text.match(/<\s*diary\s*>([\s\S]*?)<\/\s*diary\s*>/i);
  if (diaryTag) text = diaryTag[1];
  const fence = text.match(/```(?:text|markdown)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1];
  text = text
    .replace(/^\s*(?:日记|记忆日记|memory diary)\s*[:：]\s*/i, '')
    .replace(/^["“「']+|["”」']+$/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  return normalizeWhitespace(text).slice(0, 200_000);
}

export function diaryCharCount(text) {
  return countChars(String(text || '').replace(/\s+/g, ''));
}

/** 解析 NPC 生成结果。 */
export function extractNpcDraft(raw) {
  const data = parseLooseJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('模型没有返回可用的 NPC JSON，请重试。');
  }
  const name = String(data.name || '').trim().slice(0, 40);
  if (!name) throw new Error('生成的 NPC 缺少姓名，请重试。');
  return {
    name,
    identity: String(data.identity || data.role || '身份未设定').trim().slice(0, 160),
    style: String(data.style || '').trim().slice(0, 500),
    appearance: String(data.appearance || '').trim().slice(0, 500),
    color: safeColor(data.color, '#b8846b'),
    source: 'ai',
  };
}

/**
 * 把模型回复里的“角色名：台词”拆成片段，用于更细腻的渲染。
 * 未匹配的普通段落保持原样。
 */
export function splitDialogueSegments(text) {
  const source = String(text || '');
  const lines = source.split('\n');
  const segments = [];
  for (const line of lines) {
    const match = line.match(/^([\u4e00-\u9fffA-Za-z0-9·\s]{1,12})[：:]\s*(.+)$/);
    if (match && !/[。！？!?]/.test(match[1])) {
      segments.push({ speaker: match[1].trim(), text: match[2].trim() });
    } else {
      segments.push({ speaker: null, text: line });
    }
  }
  return segments;
}

/** 从任意文本中移除控制块，用于导出与搜索。 */
export function stripControlBlocks(text) {
  return extractAssistantPayload(text).content;
}
