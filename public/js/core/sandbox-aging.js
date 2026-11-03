/**
 * 历史沙盒的衰老 E。
 *
 * E 是隐性变量，不占六项能力，也不改变原始总点。
 * 它只通过“有效值”影响判定与事件风险。
 */

import { getHistoricalTemplate } from './constants.js';

export const AGING_MAX = 100;

export function parseAge(age) {
  const match = String(age ?? '').match(/\d{1,3}/);
  const value = Number(match?.[0]);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export function ageBaseE(age) {
  const value = parseAge(age);
  if (value < 25) return 0;
  if (value < 35) return 10;
  if (value < 45) return 20;
  if (value < 55) return 35;
  if (value < 65) return 50;
  if (value < 75) return 70;
  return 85;
}

export function agingPenalty(e, { physical = false, military = false } = {}) {
  const value = Math.max(0, Math.min(AGING_MAX, Number(e) || 0));
  let penalty = 0;
  if (value >= 85) penalty = 6;
  else if (value >= 65) penalty = 4;
  else if (value >= 45) penalty = 2;
  else if (value >= 25) penalty = 1;
  if (physical && military) penalty *= 2;
  return penalty;
}

export function agingStatus(e) {
  const value = Math.max(0, Math.min(AGING_MAX, Number(e) || 0));
  if (value < 25) return { id: 'prime', label: '青壮', penalty: 0, risk: '正常' };
  if (value < 45) return { id: 'early', label: '初衰', penalty: 1, risk: '轻微' };
  if (value < 65) return { id: 'aging', label: '明显衰老', penalty: 2, risk: '中等' };
  if (value < 85) return { id: 'frail', label: '衰弱', penalty: 4, risk: '较高' };
  return { id: 'dying', label: '垂老/油尽灯枯', penalty: 6, risk: '极高，重伤、瘟疫、亲征、逃难可能退场' };
}

const PHYSICAL_KEYS = new Set(['martial', 'endurance']);

export function isPhysicalAbility(templateId, abilityKey) {
  if (templateId === 'military') {
    return ['command', 'martial', 'training', 'logistics'].includes(abilityKey);
  }
  if (templateId === 'commoner') {
    return ['livelihood', 'craft', 'endurance', 'social'].includes(abilityKey);
  }
  if (templateId === 'civil') {
    return ['governance', 'diplomacy', 'culture'].includes(abilityKey);
  }
  if (templateId === 'emperor') {
    return ['command', 'intrigue', 'charisma'].includes(abilityKey);
  }
  if (templateId === 'merchant') {
    return ['business', 'network', 'management'].includes(abilityKey);
  }
  return false;
}

export function effectiveAbility(rawValue, { e = 0, templateId, abilityKey } = {}) {
  const raw = Math.max(3, Math.min(18, Math.round(Number(rawValue) || 3)));
  const physical = isPhysicalAbility(templateId, abilityKey);
  const penalty = agingPenalty(e, {
    physical,
    military: templateId === 'military' && PHYSICAL_KEYS.has(abilityKey),
  });
  return {
    raw,
    effective: Math.max(3, raw - penalty),
    penalty,
    physical,
  };
}

export function createAgingState(age, experiences = []) {
  const base = ageBaseE(age);
  const log = experiences
    .map((item) => ({
      label: String(item?.label || '经历').slice(0, 60),
      delta: Math.round(Number(item?.delta) || 0),
    }))
    .filter((item) => item.delta !== 0);
  const add = log.reduce((sum, item) => sum + item.delta, 0);
  const e = Math.max(base, Math.min(AGING_MAX, base + add));
  return {
    ageBaseE: base,
    agingE: e,
    agingLog: log,
    status: agingStatus(e),
  };
}

export function describeAging(e, templateId) {
  const status = agingStatus(e);
  const template = getHistoricalTemplate(templateId);
  const affected = template.abilities
    .filter((ability) => isPhysicalAbility(templateId, ability.key))
    .map((ability) => ability.label);
  return {
    ...status,
    affected,
    text: `${status.label} · 惩罚 -${status.penalty}${affected.length ? ` · 影响：${affected.join('、')}` : ''}`,
  };
}
