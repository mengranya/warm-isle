/**
 * 沙盒运行时规则：属性映射、行动判定、后果描述。
 * 纯逻辑，不访问 DOM；方便单测与后续扩展。
 */

import {
  SANDBOX_DIFFICULTIES,
  getSandboxAbilities,
  getSandboxCategory,
  getSandboxDifficulty,
} from './constants.js';
import { effectiveAbility } from './sandbox-aging.js';

const ATTRIBUTE_KEYWORDS = {
  body: [
    '攻击',
    '打',
    '挥',
    '砍',
    '劈',
    '刺',
    '推',
    '拉',
    '扛',
    '搬',
    '举',
    '硬闯',
    '冲',
    '撞',
    '搏斗',
    '近身',
    '拔剑',
    '拔刀',
    '用力',
  ],
  agility: [
    '潜行',
    '潜',
    '躲',
    '闪避',
    '闪',
    '跑',
    '追',
    '爬',
    '翻墙',
    '翻',
    '偷',
    '轻身',
    '跃',
    '溜',
    '脱身',
    '跟踪',
    '绕路',
  ],
  mind: [
    '观察',
    '看',
    '听',
    '查',
    '搜',
    '分析',
    '判断',
    '推理',
    '阅读',
    '读',
    '学',
    '研究',
    '计划',
    '布局',
    '算',
    '辨认',
    '回忆',
    '医术',
    '阵法',
    '计算',
  ],
  presence: [
    '说',
    '问',
    '谈',
    '劝',
    '说服',
    '请求',
    '交涉',
    '交易',
    '讨价',
    '结交',
    '拜访',
    '演讲',
    '威吓',
    '安抚',
    '欺骗',
    '谈判',
  ],
  will: [
    '忍',
    '坚持',
    '抵抗',
    '对抗',
    '承受',
    '静心',
    '打坐',
    '突破',
    '守',
    '忍住',
    '克制',
    '直面',
  ],
  luck: ['碰运气', '赌', '机缘', '随便', '凭感觉', '试探', '祈祷', '冒险', '碰碰'],
};

const SAFE_HINTS = ['小心', '谨慎', '先观察', '试探', '轻轻', '慢慢', '不动声色'];
const RISKY_HINTS = ['强行', '冒险', '冲', '闯', '硬来', '孤注一掷', '不顾一切', '拼命'];

function secureD20() {
  try {
    const bytes = new Uint32Array(1);
    globalThis.crypto.getRandomValues(bytes);
    return (bytes[0] % 20) + 1;
  } catch {
    return Math.floor(Math.random() * 20) + 1;
  }
}

export function inferSandboxAttribute(action, categoryId, templateId = null) {
  const text = String(action || '');
  const category = getSandboxCategory(categoryId);
  const useTemplate =
    categoryId === 'historical' && templateId && templateId !== 'legacy';
  const abilities = useTemplate
    ? getSandboxAbilities(categoryId, templateId)
    : category.attributes;
  const scores = Object.fromEntries(abilities.map((ability) => [ability.key, 0]));
  const legacyKeywords = useTemplate ? {} : ATTRIBUTE_KEYWORDS;
  for (const [key, words] of Object.entries(legacyKeywords)) {
    if (!(key in scores)) continue;
    for (const word of words) {
      if (text.includes(word)) scores[key] += word.length >= 2 ? 2 : 1;
    }
  }
  for (const ability of abilities) {
    // 玩家明确写出能力名时，优先使用该能力，避免被普通关键词抢走。
    if (text.includes(ability.label)) scores[ability.key] += 12;
    for (const word of ability.keywords || []) {
      if (text.includes(word)) scores[ability.key] += word.length >= 2 ? 2 : 1;
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  // 默认用谋略/事务类能力处理不确定行动。
  if (!ranked[0] || ranked[0][1] === 0) {
    const fallback =
      abilities.find((item) =>
        ['strategy', 'mind', 'governance', 'statecraft', 'business', 'livelihood'].includes(
          item.key,
        ),
      ) || abilities[0];
    return {
      key: fallback.key,
      label: fallback.label,
      score: 0,
      inferred: false,
    };
  }

  const [key, score] = ranked[0];
  return {
    key,
    label: abilities.find((item) => item.key === key)?.label || key,
    score,
    inferred: true,
  };
}

function difficultyLabel(id) {
  return SANDBOX_DIFFICULTIES.find((item) => item.id === id)?.label || '标准';
}

/**
 * 生成一次行动判定。AI 拿到的是已经发生的结果，必须按结果叙事。
 */
export function createSandboxCheck({
  action,
  save,
  danger = 10,
  rng = secureD20,
  difficulty = null,
}) {
  if (!save?.checksEnabled) return null;
  const category = getSandboxCategory(save.category);
  const templateId = save.player?.template || null;
  const inferred = inferSandboxAttribute(action, save.category, templateId);
  const attributes = save.player?.attributes || {};
  const rawScore = Number(attributes[inferred.key]) || 10;
  const effective = effectiveAbility(rawScore, {
    e: save.player?.agingE,
    templateId,
    abilityKey: inferred.key,
  });
  const score = effective.effective;
  const modifier = Math.floor((score - 10) / 2);
  const difficultyId = difficulty || save.difficulty || 'normal';
  const difficultyMeta = getSandboxDifficulty(difficultyId);
  const risky = RISKY_HINTS.some((word) => String(action).includes(word));
  const cautious = SAFE_HINTS.some((word) => String(action).includes(word));
  const riskModifier = risky ? 2 : cautious ? -1 : 0;
  const dc = Math.max(
    5,
    Math.round(10 + Number(danger || 0) / 15 + difficultyMeta.dcModifier + riskModifier),
  );
  const roll = Math.min(20, Math.max(1, Number(rng()) || 1));
  const total = roll + modifier;

  let outcome;
  let tone;
  let instruction;
  if (roll === 1) {
    outcome = '大失败';
    tone = 'critical-failure';
    instruction =
      '行动以明显的方式失败，并产生额外的、可信的后果；不要写成毫无代价的转机。';
  } else if (roll === 20) {
    outcome = '大成功';
    tone = 'critical-success';
    instruction =
      '行动效果超出预期，但不能凭空出现不合世界逻辑的奖励；成功同样要消耗时间或资源。';
  } else if (total >= dc + 5) {
    outcome = '成功';
    tone = 'success';
    instruction = '行动成功，结果清晰；付出与行动规模相称的代价即可。';
  } else if (total >= dc) {
    outcome = '勉强成功';
    tone = 'partial-success';
    instruction = '目标达成，但出现一个明确的小代价、延迟或隐患。';
  } else if (total >= dc - 3) {
    outcome = '部分成功';
    tone = 'partial';
    instruction = '只达成部分目标，或达成目标但付出明显代价；世界必须产生后续麻烦。';
  } else {
    outcome = '失败';
    tone = 'failure';
    instruction = '行动失败，世界按因果继续运转；不要让 NPC 无条件迁就玩家。';
  }

  const margin = total - dc;
  const explanation = buildCheckExplanation({
    attributeLabel: inferred.label,
    score,
    roll,
    total,
    dc,
    margin,
    outcome,
  });

  return {
    action: String(action).slice(0, 300),
    attribute: inferred.key,
    attributeLabel: inferred.label,
    rawScore,
    score,
    agingPenalty: effective.penalty,
    modifier,
    dc,
    roll,
    total,
    margin,
    outcome,
    tone,
    difficulty: difficultyId,
    difficultyLabel: difficultyLabel(difficultyId),
    explanation,
    instruction,
    at: new Date().toISOString(),
  };
}

function buildCheckExplanation({
  attributeLabel,
  score,
  roll,
  total,
  dc,
  margin,
  outcome,
}) {
  if (outcome === '大成功') {
    return `${attributeLabel} ${score} 的能力与本次行动匹配，且出现了有利时机；结果是超常发挥，不是世界无条件让步。`;
  }
  if (outcome === '成功') {
    return `${attributeLabel} ${score} 足以覆盖本次行动的主要难点；成功来自能力、条件与执行的共同作用。`;
  }
  if (roll === 1) {
    return `d20 为 1，属于极端失手或突发意外；这不等于${attributeLabel}不足。${
      score >= 14
        ? `该能力已达到 ${score}，失败来自意外、对手针对或执行中的具体失误，不能写成“${attributeLabel}不足”。`
        : '失败主要来自意外与执行失误。'
    }`;
  }
  if (score >= 14 && outcome === '失败') {
    return `${attributeLabel} 已达到 ${score}，属于当世顶尖水平；本次总计 ${total} 低于 DC ${dc}（差 ${Math.abs(
      margin,
    )}），失败应归因于对手强度、外部阻力、信息不足或时机不利，不能写成“${attributeLabel}不足”。`;
  }
  if (score >= 14 && (outcome === '部分成功' || outcome === '勉强成功')) {
    return `${attributeLabel} ${score} 足以处理大部分难点，但外部条件或代价限制了结果；这是有条件的成功，不是能力不足。`;
  }
  if (score <= 7) {
    return `${attributeLabel} ${score} 储备有限，本次结果说明该能力不足以稳定覆盖行动难点；失败或代价与能力短板相符。`;
  }
  return `${attributeLabel} ${score} 与本次 DC ${dc} 接近，胜负取决于执行、信息与外部条件；结果不能简单解释为能力高低。`;
}

export function describeSandboxCheck(check) {
  if (!check) return null;
  const sign = check.modifier >= 0 ? `+${check.modifier}` : String(check.modifier);
  const margin = Number(check.margin ?? check.total - check.dc);
  return {
    ...check,
    headline: `${check.attributeLabel}判定 · ${check.outcome}`,
    formula: `d20 ${check.roll} ${sign} = ${check.total} / DC ${check.dc} · ${
      margin >= 0 ? '高出' : '差'
    } ${Math.abs(margin)}`,
  };
}

/** 把判定写进提示词，让模型不能把失败改成成功。 */
export function formatCheckForPrompt(check) {
  if (!check) return '';
  return [
    '【本轮行动判定｜已结算，必须遵守】',
    `玩家行动：${check.action}`,
    `使用属性：${check.attributeLabel}（有效 ${check.score}${
      check.agingPenalty
        ? `，原始 ${check.rawScore}，衰老 -${check.agingPenalty}`
        : ''
    }，修正 ${check.modifier >= 0 ? '+' : ''}${check.modifier}）`,
    `判定：d20 = ${check.roll}，总计 ${check.total}，DC ${check.dc}`,
    `结果：${check.outcome}（${check.difficultyLabel}难度）`,
    `判定解释（必须采用，不得改写）：${check.explanation || ''}`,
    `叙事要求：${check.instruction}`,
    '如果本次使用的能力已达到 14 或以上，禁止在叙事中写“该能力不足”；失败只能归因于对手、外部阻力、信息、时机或具体执行失误。达到 18 时更不得写成不懂、无能或缺乏经验。',
    '你必须按照这个结果描写行动后果，不能把失败改写为成功，也不能抹去失败代价。世界会继续运转，NPC 不会因为玩家是主角而无条件让步。',
  ].join('\n');
}

export function isSandboxDefeated(save) {
  return Number(save?.player?.health) <= 0;
}
