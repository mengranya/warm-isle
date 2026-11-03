/**
 * 沙盒后台事件监控与结算。
 *
 * 事件监控器是独立于叙事 AI 的后台调用：
 * - 识别事件开始、持续、结束；
 * - 允许同一事件跨多条对话；
 * - 只在事件结束时结算点数；
 * - 多个事件的效果合并后统一结算，避免单次判定直接加点。
 */

import {
  getHistoricalTemplate,
  getSandboxAbilities,
} from './constants.js';
import {
  createId,
  clamp,
  parseLooseJson,
  truncateText,
} from './utils.js';

const MAX_EVENTS = 40;

export function normalizeSandboxEvent(input) {
  if (!input || typeof input !== 'object') return null;
  const title = String(input.title || input.name || '').trim().slice(0, 80);
  if (!title) return null;
  const status = input.status === 'ended' ? 'ended' : 'ongoing';
  const effects = Array.isArray(input.effects)
    ? input.effects
        .map((effect) => {
          if (!effect || typeof effect !== 'object') return null;
          const ability = String(effect.ability || effect.key || '').trim().slice(0, 40);
          const delta = Math.round(Number(effect.delta) || 0);
          if (!ability || !delta) return null;
          return {
            ability,
            delta: clamp(delta, -3, 3),
            reason: String(effect.reason || '').slice(0, 160),
          };
        })
        .filter(Boolean)
    : [];
  return {
    id: String(input.id || `sbevent_${createId('e')}`).slice(0, 80),
    title,
    status,
    startTurn: input.startTurn
      ? Math.max(1, Math.round(Number(input.startTurn) || 1))
      : 0,
    endTurn:
      input.endTurn === undefined || input.endTurn === null
        ? null
        : Math.max(1, Math.round(Number(input.endTurn) || 1)),
    summary: String(input.summary || input.description || '').slice(0, 600),
    participants: Array.isArray(input.participants)
      ? input.participants.map((item) => String(item).slice(0, 40)).slice(0, 12)
      : [],
    developments: Array.isArray(input.developments)
      ? input.developments
          .map((item) => {
            if (typeof item === 'string') return item.slice(0, 240);
            return String(item?.text || '').slice(0, 240);
          })
          .filter(Boolean)
          .slice(-8)
      : [],
    effects,
    visibility: input.visibility === 'hidden' ? 'hidden' : 'public',
    effectsApplied: Boolean(input.effectsApplied),
  };
}

export function normalizeEventLedger(input) {
  return (Array.isArray(input) ? input : [])
    .map(normalizeSandboxEvent)
    .filter(Boolean)
    .slice(-MAX_EVENTS);
}

export function mergeEventUpdates(previous, updates, { turn = 1, ultra = false } = {}) {
  const events = normalizeEventLedger(previous);
  const byId = new Map(events.map((event) => [event.id, event]));
  const byTitle = new Map(events.map((event) => [event.title, event]));
  for (const raw of Array.isArray(updates) ? updates : []) {
    const normalized = normalizeSandboxEvent(raw);
    if (!normalized) continue;
    let existing = byId.get(normalized.id) || byTitle.get(normalized.title);
    if (!existing) {
      existing = {
        ...normalized,
        id: normalized.id,
        startTurn: normalized.startTurn || turn,
        endTurn: normalized.status === 'ended' ? normalized.endTurn || turn : null,
        visibility: ultra ? normalized.visibility : 'public',
        effectsApplied: false,
      };
      events.push(existing);
      byId.set(existing.id, existing);
      byTitle.set(existing.title, existing);
      continue;
    }
    // 已结束并结算的事件不被回滚；只补齐描述。
    if (existing.status === 'ended' && existing.effectsApplied) continue;
    existing.status = normalized.status;
    existing.summary = normalized.summary || existing.summary;
    existing.participants = [...new Set([...existing.participants, ...normalized.participants])].slice(0, 12);
    existing.developments = [...existing.developments, ...normalized.developments].slice(-8);
    if (normalized.effects.length) {
      existing.effects = [...existing.effects, ...normalized.effects].slice(-16);
    }
    if (normalized.status === 'ended') {
      existing.endTurn = normalized.endTurn || turn;
    }
    if (ultra) existing.visibility = normalized.visibility;
    else existing.visibility = 'public';
  }
  return events.slice(-MAX_EVENTS);
}

function abilityForLabel(categoryId, templateId, label) {
  const abilities =
    categoryId === 'historical'
      ? getSandboxAbilities(categoryId, templateId)
      : getSandboxAbilities(categoryId, null);
  return (
    abilities.find((ability) => ability.label === label || ability.key === label) ||
    abilities.find((ability) => label.includes(ability.label) || ability.label.includes(label))
  );
}

/**
 * 结算所有已结束且尚未结算的事件。
 * 返回新的 events、属性变化（未应用）、是否发生结算。
 */
export function collectEndedEventEffects(save, events) {
  const categoryId = save.category;
  const templateId = save.player?.template || 'commoner';
  const ended = events.filter(
    (event) => event.status === 'ended' && !event.effectsApplied,
  );
  if (!ended.length) return { events, attributeDeltas: {}, settled: false };

  const deltas = {};
  for (const event of ended) {
    for (const effect of event.effects) {
      const ability = abilityForLabel(categoryId, templateId, effect.ability);
      if (!ability) continue;
      deltas[ability.key] = (deltas[ability.key] || 0) + effect.delta;
    }
  }

  // 皇帝联动：皇权/政务增强会自然带动威望。
  if (
    categoryId === 'historical' &&
    templateId === 'emperor' &&
    (deltas.intrigue || deltas.statecraft) > 0
  ) {
    deltas.charisma = clamp((deltas.charisma || 0) + 1, -3, 3);
  }

  // 多事件合并：单项最多 ±3，总点最多 ±6。
  for (const key of Object.keys(deltas)) {
    deltas[key] = clamp(deltas[key], -3, 3);
  }
  let total = Object.values(deltas).reduce((sum, value) => sum + value, 0);
  while (total > 6) {
    const largest = Object.entries(deltas)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])[0];
    if (!largest) break;
    deltas[largest[0]] -= 1;
    total -= 1;
  }
  while (total < -6) {
    const largest = Object.entries(deltas)
      .filter(([, value]) => value < 0)
      .sort((a, b) => a[1] - b[1])[0];
    if (!largest) break;
    deltas[largest[0]] += 1;
    total += 1;
  }

  const createdAt = new Date().toISOString();
  const nextEvents = events.map((event) =>
    ended.some((item) => item.id === event.id)
      ? { ...event, effectsApplied: true, appliedAt: createdAt }
      : event,
  );
  return {
    events: nextEvents,
    attributeDeltas: Object.fromEntries(
      Object.entries(deltas).filter(([, value]) => value !== 0),
    ),
    settled: Object.values(deltas).some((value) => value !== 0),
  };
}

export function formatEventForPrompt(event) {
  return [
    `- ${event.id}｜${event.title}｜${event.status === 'ended' ? '已结束' : '进行中'}`,
    event.summary ? `  摘要：${event.summary}` : '',
    event.participants.length ? `  参与者：${event.participants.join('、')}` : '',
    event.developments.length
      ? `  进展：${event.developments.slice(-3).join(' / ')}`
      : '',
    event.effects.length
      ? `  待结算：${event.effects
          .map((effect) => `${effect.ability}${effect.delta >= 0 ? '+' : ''}${effect.delta}`)
          .join('、')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildEventMonitorPrompt({
  save,
  worldbook,
  difficulty,
  messages,
  events,
}) {
  const category = save.category;
  const templateId = save.player?.template || 'commoner';
  const isHistorical = category === 'historical';
  const template = getHistoricalTemplate(templateId);
  const templateLabel = isHistorical ? template.label : '通用';
  const abilities = isHistorical
    ? getSandboxAbilities(category, templateId)
    : getSandboxAbilities(category, null);
  const ultra = difficulty?.eventMode === 'ultra';
  const recent = (messages || [])
    .slice(-12)
    .map((message) => `${message.role === 'user' ? '玩家' : '世界'}：${truncateText(message.content, 500)}`)
    .join('\n');
  const system = [
    '你是沙盒后台的「事件监控器」，不是叙事者，也不是角色扮演者。',
    '你的唯一任务是：根据最近对话，识别事件开始、持续、结束，并维护已有事件。',
    '事件可以跨越多条对话；同一个事件必须沿用已有 id，不要重复新建。',
    '只有重大事件才允许产生 effects；普通寒暄、普通行动、普通成功/失败不得加点。',
    '历史事件必须遵守合法性、继承制度、派系利益、实力与信息条件；不得为了制造困难而凭空制造背叛、构陷、逼宫或大臣不臣。',
    '如果太子地位稳固、继位合法、支持者占优，登基后的常态是朝臣服从；不臣或政变必须有前置矛盾、利益冲突、把柄或外部压力，并留下线索。',
    'effects 只在事件结束时结算；未结束事件只记录进展。',
    '点数变化必须是多个事件或阶段性结果的联合，不能由一次普通判定直接决定。',
    '你只能输出 JSON，不要写叙事、解释、Markdown 或代码围栏。',
    ultra
      ? '当前是「超拟真」：允许隐藏事件、谎言、阳奉阴违、结党、请辞、抗命、逼宫；visibility 可为 hidden。叙事只给线索，不要把隐藏意图直接说破。'
      : '当前不是超拟真：必须绝对诚实。NPC 可以拒绝、反抗、不执行，但不得阳奉阴违、隐瞒真实意图、伪造结果或制造玩家不知道的阴谋；visibility 只能为 public。',
    `当前人物模板：${templateLabel}。可用能力标签：${abilities.map((ability) => ability.label).join('、')}。`,
    '皇帝示例：与大臣争论并成功，可在事件结束时给“威望魅力”+1；皇权/权谋增强时，可同时给“威望魅力”联动 +1。',
    '一个事件可以有多个 effects，但单项 delta 必须在 -3～3，整个事件总变化应在 -6～6。',
    '如果事件结束但没有可靠的点数效果，effects 可以为空。',
    '',
    '输出结构：',
    '{"events":[{"id":"稳定ID","title":"事件名","status":"ongoing|ended","summary":"一句话","participants":["人物"],"developments":["本轮进展"],"effects":[{"ability":"能力标签","delta":1,"reason":"为什么"}],"visibility":"public|hidden"}]}',
    'events 数组只输出本轮新增或更新的事件；未变化的事件不要重复输出。',
  ].join('\n');

  const user = [
    `【世界书】${worldbook?.name || '未绑定'}`,
    `【难度】${difficulty?.label || '标准'}（${ultra ? '超拟真' : '绝对诚实'}）`,
    `【当前回合】${save.turn}`,
    `【当前时间】${save.world?.date?.year ?? '未知'} 年 ${save.world?.date?.month ?? 1} 月 ${save.world?.date?.day ?? 1} 日 ${save.world?.time || ''}`,
    `【月份约束】按当前月份判断季节、农时、节令、道路与军事节奏，事件进展不得脱离该季节。`,
    `【玩家】${save.player?.name || '无名旅人'}；身份：${save.player?.identity || '未定'}；模板：${templateLabel}`,
    `【当前能力】${abilities
      .map((ability) => `${ability.label} ${save.player?.attributes?.[ability.key] ?? 9}`)
      .join('；')}`,
    `【当前资源】${(save.player?.resources || [])
      .map((resource) => `${resource.name}${resource.value ? ` ${resource.value}${resource.unit || ''}` : ''}`)
      .join('；') || '未记录'}`,
    '',
    '【已有事件】',
    (events || []).length ? events.map(formatEventForPrompt).join('\n') : '暂无',
    '',
    '【最近对话】',
    recent || '暂无',
    '',
    '请只输出本轮新增/更新的事件 JSON。',
  ].join('\n');

  return {
    system,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    meta: {
      ultra,
      template: templateId,
      events: events?.length || 0,
      messages: messages?.length || 0,
    },
  };
}

export function parseEventResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return { events: [] };
  let parsed = parseLooseJson(text);
  if (!parsed || typeof parsed !== 'object') {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = parseLooseJson(match[0]);
  }
  if (!parsed || typeof parsed !== 'object') return { events: [] };
  const events = Array.isArray(parsed.events)
    ? parsed.events
    : Array.isArray(parsed)
      ? parsed
      : parsed.event
        ? [parsed.event]
        : [];
  return { events };
}
