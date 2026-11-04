/**
 * 日记记忆强度。
 *
 * 0%：完全不写入日记，章节直接从后续上下文中消失。
 * 100%：不压缩，保存本章完整对话。
 * 中间值：控制日记正文的目标长度与细节程度。
 */
export const DEFAULT_MEMORY_STRENGTH = 40;
/** 完整记忆仍受浏览器本地数据上限保护。 */
export const FULL_MEMORY_MAX_CHARS = 200_000;

export const MEMORY_STRENGTH_LEVELS = Object.freeze([
  {
    min: 0,
    max: 0,
    label: '不记忆',
    target: '不保存日记',
    description: '本章不生成日记，之后不会再被回忆。',
  },
  {
    min: 1,
    max: 20,
    label: '模糊印象',
    target: '约 40–80 字',
    description: '只记住一两个关键画面或结论，细节基本消失。',
  },
  {
    min: 21,
    max: 40,
    label: '简要记忆',
    target: '约 100–200 字',
    description: '能回忆主要事件、关系变化与承诺，细节较少；旧版默认。',
  },
  {
    min: 41,
    max: 60,
    label: '清晰记忆',
    target: '约 250–450 字',
    description: '关键事件、情绪转折、承诺与线索都能保留。',
  },
  {
    min: 61,
    max: 80,
    label: '详细记忆',
    target: '约 500–900 字',
    description: '接近逐场景回忆，能记住较多对话细节与因果。',
  },
  {
    min: 81,
    max: 99,
    label: '近乎完整',
    target: '约 1000–1800 字',
    description: '只省略寒暄和重复内容，主要对话与细节都在。',
  },
  {
    min: 100,
    max: 100,
    label: '完整对话',
    target: '原文完整保存',
    description: '不压缩，保存本章全部玩家与角色对话。',
  },
]);

export function normalizeMemoryStrength(value, fallback = DEFAULT_MEMORY_STRENGTH) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? Math.round(number) : fallback;
  return Math.max(0, Math.min(100, safe));
}

export function getMemoryStrengthMeta(value) {
  const strength = normalizeMemoryStrength(value);
  return (
    MEMORY_STRENGTH_LEVELS.find(
      (level) => strength >= level.min && strength <= level.max,
    ) || MEMORY_STRENGTH_LEVELS[2]
  );
}

export function memoryStrengthTargetText(value) {
  const meta = getMemoryStrengthMeta(value);
  return meta.target;
}

export function isFullMemoryStrength(value) {
  return normalizeMemoryStrength(value) >= 100;
}
