/**
 * 沙盒世界的数据模型、校验与工厂。
 *
 * 重要：该文件只处理 sandboxWorldbooks / sandboxSaves。
 * 不会读取或改写恋爱对话模式的 archives / personas / plugins。
 */

import {
  SANDBOX_ATTRIBUTE_KEYS,
  SANDBOX_CATEGORIES,
  SANDBOX_DIFFICULTIES,
  SANDBOX_HISTORICAL_TEMPLATES,
  SANDBOX_LIMITS,
  SANDBOX_TOTAL_POINT_MAX,
  SCHEMA_VERSION,
  getHistoricalTemplate,
  getSandboxAbilityKeys,
  getSandboxCategory,
  getSandboxDifficulty,
} from '../core/constants.js';
import { ageBaseE, createAgingState } from '../core/sandbox-aging.js';
import { normalizeEventLedger } from '../core/sandbox-events.js';
import {
  clamp,
  createId,
  createUsageBucket,
  normalizeWhitespace,
  safeNumber,
  sanitizeFileName,
  toArray,
  truncateText,
  uniqueBy,
} from '../core/utils.js';

export class SandboxSchemaError extends Error {
  constructor(message, detail = null) {
    super(message);
    this.name = 'SandboxSchemaError';
    this.detail = detail;
  }
}

function asString(value, fallback = '', max = 4_000) {
  if (typeof value === 'number') return String(value).slice(0, max);
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

function asArray(value, max = 40, itemMax = 100) {
  return uniqueBy(
    toArray(value, max)
      .map((item) => asString(item, '', itemMax))
      .filter(Boolean),
    (item) => item,
  );
}

function normalizeDate(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export const HISTORICAL_YEAR_MIN = -3000;
export const HISTORICAL_YEAR_MAX = 9999;

function normalizeGameDate(input, fallback = { year: 1, month: 1, day: 1 }) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    year: Math.round(
      clamp(safeNumber(source.year, fallback.year), HISTORICAL_YEAR_MIN, HISTORICAL_YEAR_MAX),
    ),
    month: Math.round(clamp(safeNumber(source.month, fallback.month), 1, 12)),
    day: Math.round(clamp(safeNumber(source.day, fallback.day), 1, 31)),
  };
}

const ALL_ABILITY_KEYS = Object.freeze([
  ...new Set([
    ...SANDBOX_ATTRIBUTE_KEYS,
    ...SANDBOX_HISTORICAL_TEMPLATES.flatMap((template) =>
      template.abilities.map((ability) => ability.key),
    ),
  ]),
]);

function normalizeAttributes(input, keys = null) {
  const source = input && typeof input === 'object' ? input : {};
  const targetKeys =
    keys?.length
      ? keys
      : ALL_ABILITY_KEYS.filter((key) => source[key] !== undefined);
  const result = {};
  for (const key of targetKeys.length ? targetKeys : SANDBOX_ATTRIBUTE_KEYS) {
    result[key] = Math.round(
      clamp(safeNumber(source[key], 8), SANDBOX_LIMITS.minAttributes, SANDBOX_LIMITS.maxAttributes),
    );
  }
  let total = Object.values(result).reduce((sum, value) => sum + value, 0);
  while (total > SANDBOX_TOTAL_POINT_MAX) {
    const largest = Object.entries(result)
      .filter(([, value]) => value > SANDBOX_LIMITS.minAttributes)
      .sort((a, b) => b[1] - a[1])[0];
    if (!largest) break;
    result[largest[0]] -= 1;
    total -= 1;
  }
  return result;
}

function inferTemplateFromAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  for (const template of SANDBOX_HISTORICAL_TEMPLATES) {
    if (template.abilities.some((ability) => attributes[ability.key] !== undefined)) {
      return template.id;
    }
  }
  return null;
}

function normalizeFixedFigure(input) {
  if (!input || typeof input !== 'object') return null;
  const name = asString(input.name, '', 60);
  if (!name) return null;
  return {
    name,
    title: asString(input.title, '', 100),
    description: asString(input.description, '', 600),
    template: SANDBOX_HISTORICAL_TEMPLATES.some((item) => item.id === input.template)
      ? input.template
      : 'civil',
    age: asString(input.age, '', 24),
    gender: asString(input.gender, '', 16),
    yearStart: input.yearStart === undefined ? null : Math.round(safeNumber(input.yearStart, 1)),
    yearEnd: input.yearEnd === undefined ? null : Math.round(safeNumber(input.yearEnd, 1)),
  };
}

function normalizeInventory(input) {
  return toArray(input, 40)
    .map((item) => {
      if (typeof item === 'string') {
        const name = asString(item, '', 80);
        return name ? { name, qty: 1, note: '' } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const name = asString(item.name, '', 80);
      if (!name) return null;
      return {
        name,
        qty: Math.round(clamp(safeNumber(item.qty, 1), 1, 999)),
        note: asString(item.note, '', 240),
      };
    })
    .filter(Boolean)
    .slice(0, 40);
}

function normalizeResources(input) {
  return toArray(input, 24)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = asString(item.name, '', 40);
      if (!name) return null;
      return {
        name,
        value: asString(item.value ?? item.amount ?? '', '', 40),
        unit: asString(item.unit, '', 16),
        note: asString(item.note, '', 160),
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeRelationships(input) {
  return toArray(input, 30)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = asString(item.name, '', 80);
      if (!name) return null;
      return {
        name,
        attitude: Math.round(clamp(safeNumber(item.attitude, 0), -100, 100)),
        note: asString(item.note, '', 240),
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeQuests(input) {
  return toArray(input, 30)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const title = asString(item.title, '', 100);
      if (!title) return null;
      return {
        title,
        status: asString(item.status, '进行中', 20),
        note: asString(item.note, '', 300),
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeScene(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    title: asString(source.title, '', 100),
    summary: asString(source.summary, '', 600),
    choices: asArray(source.choices, 6, 120),
  };
}

export function normalizeSandboxWorldState(input, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    date: normalizeGameDate(source.date, base.date || { year: 1, month: 1, day: 1 }),
    time: asString(source.time ?? base.time, '清晨', 24),
    weather: asString(source.weather ?? base.weather, '晴', 40),
    location: asString(source.location ?? base.location, '未知之地', 100),
    region: asString(source.region ?? base.region, '', 100),
    danger: Math.round(clamp(safeNumber(source.danger ?? base.danger, 10), 0, 100)),
    scene: normalizeScene(source.scene ?? base.scene),
    relationships: source.relationships !== undefined
      ? normalizeRelationships(source.relationships)
      : normalizeRelationships(base.relationships),
    quests: source.quests !== undefined ? normalizeQuests(source.quests) : normalizeQuests(base.quests),
  };
}

export function normalizeSandboxPlayer(input, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const category = getSandboxCategory(base.category || source.category);
  const attributeSource = source.attributes ?? base.attributes;
  let template = source.template ?? base.template ?? null;
  if (category.id === 'historical') {
    if (!SANDBOX_HISTORICAL_TEMPLATES.some((item) => item.id === template)) {
      template =
        inferTemplateFromAttributes(attributeSource) ||
        (attributeSource ? 'legacy' : 'commoner');
    }
  } else {
    template = 'sandbox';
  }
  const abilityKeys =
    category.id === 'historical' && template !== 'legacy'
      ? getSandboxAbilityKeys(category.id, template)
      : null;
  const attributes = normalizeAttributes(attributeSource, abilityKeys);
  const age = asString(source.age ?? base.age, '未知', 24);
  const baseAging =
    source.ageBaseE ??
    base.ageBaseE ??
    (category.id === 'historical' ? ageBaseE(age) : 0);
  const agingE = Math.round(
    clamp(
      safeNumber(source.agingE ?? base.agingE, baseAging),
      baseAging,
      100,
    ),
  );
  const agingLog = asArray(source.agingLog ?? base.agingLog, 40, 40)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      return {
        label: asString(item.label, '经历', 60),
        delta: Math.round(safeNumber(item.delta, 0)),
      };
    })
    .filter(Boolean);
  return {
    name: asString(source.name ?? base.name, '', 40) || '无名旅人',
    gender: asString(source.gender ?? base.gender, '未设定', 16),
    age,
    origin: asString(source.origin ?? base.origin, '', 160),
    identity: asString(source.identity ?? base.identity, '身份未定', 160),
    appearance: asString(source.appearance ?? base.appearance, '', 500),
    background: asString(source.background ?? base.background, '', 1_200),
    traits: asArray(source.traits ?? base.traits, 12, 40),
    template,
    attributes,
    agingE,
    ageBaseE: Math.round(clamp(safeNumber(baseAging, 0), 0, 100)),
    agingLog,
    totalPoints: Math.min(
      SANDBOX_TOTAL_POINT_MAX,
      Object.values(attributes).reduce((sum, value) => sum + (Number(value) || 0), 0),
    ),
    fixedFigureId: asString(source.fixedFigureId ?? base.fixedFigureId, '', 80),
    creationMode: source.creationMode === 'fixed' || base.creationMode === 'fixed' ? 'fixed' : 'virtual',
    health: Math.round(clamp(safeNumber(source.health ?? base.health, 100), 0, 100)),
    energy: Math.round(clamp(safeNumber(source.energy ?? base.energy, 100), 0, 100)),
    money: Math.max(0, Math.round(safeNumber(source.money ?? base.money, 0))),
    currency: asString(source.currency ?? base.currency, category.currency, 20),
    reputation: Math.round(clamp(safeNumber(source.reputation ?? base.reputation, 0), 0, 100)),
    notoriety: Math.round(clamp(safeNumber(source.notoriety ?? base.notoriety, 0), 0, 100)),
    realm: asString(source.realm ?? base.realm, '凡人', 60),
    title: asString(source.title ?? base.title, '初入此世', 80),
    inventory:
      source.inventory !== undefined
        ? normalizeInventory(source.inventory)
        : normalizeInventory(base.inventory),
    resources:
      source.resources !== undefined
        ? normalizeResources(source.resources)
        : normalizeResources(base.resources),
    skills:
      source.skills !== undefined ? asArray(source.skills, 30, 60) : asArray(base.skills, 30, 60),
    conditions:
      source.conditions !== undefined
        ? asArray(source.conditions, 20, 40)
        : asArray(base.conditions, 20, 40),
  };
}

function normalizeCheck(input) {
  if (!input || typeof input !== 'object') return null;
  const outcome = asString(input.outcome, '', 20);
  if (!outcome) return null;
  return {
    action: asString(input.action, '', 300),
    attribute: asString(input.attribute, '', 30),
    attributeLabel: asString(input.attributeLabel, '', 30),
    score: Math.round(safeNumber(input.score, 10)),
    rawScore: Math.round(safeNumber(input.rawScore, safeNumber(input.score, 10))),
    agingPenalty: Math.round(safeNumber(input.agingPenalty, 0)),
    modifier: Math.round(safeNumber(input.modifier, 0)),
    dc: Math.round(safeNumber(input.dc, 10)),
    roll: Math.round(safeNumber(input.roll, 10)),
    total: Math.round(safeNumber(input.total, 10)),
    margin: Math.round(safeNumber(input.margin, safeNumber(input.total, 10) - safeNumber(input.dc, 10))),
    outcome,
    tone: asString(input.tone, '', 30),
    explanation: asString(input.explanation, '', 600),
    instruction: asString(input.instruction, '', 600),
    difficulty: asString(input.difficulty, 'normal', 20),
    difficultyLabel: asString(input.difficultyLabel, '', 20),
    at: normalizeDate(input.at || Date.now()),
  };
}

function normalizeSandboxMessage(input, index) {
  if (!input || typeof input !== 'object') return null;
  const role = input.role === 'assistant' ? 'assistant' : input.role === 'user' ? 'user' : null;
  if (!role) return null;
  const content = normalizeWhitespace(input.content ?? input.text ?? '').slice(0, 20_000);
  if (!content) return null;
  return {
    id: asString(input.id, '', 80) || `sbmsg_${index}_${createId('m')}`,
    role,
    content,
    timestamp: normalizeDate(input.timestamp || input.at),
    check: normalizeCheck(input.check || input.meta?.check),
    opening: Boolean(input.opening || input.meta?.opening),
    hints: toArray(input.hints || input.meta?.hints, 6)
      .map((hint) => asString(hint, '', 260))
      .filter(Boolean),
  };
}

function normalizeSandboxChronicle(input, index) {
  if (!input || typeof input !== 'object') return null;
  const content = normalizeWhitespace(input.content ?? input.summary ?? '').slice(0, 2_000);
  if (!content) return null;
  return {
    id: asString(input.id, '', 80) || createId('sbchronicle'),
    content,
    createdAt: normalizeDate(input.createdAt || input.at),
    messageCount: Math.max(0, Math.round(safeNumber(input.messageCount))),
    rangeStart: Math.max(0, Math.round(safeNumber(input.rangeStart, index))),
    rangeEnd: Math.max(0, Math.round(safeNumber(input.rangeEnd, index))),
    model: asString(input.model, '', 160),
    usage: input.usage && typeof input.usage === 'object' ? input.usage : null,
  };
}

function normalizeSandboxStats(input) {
  const bucket = createUsageBucket();
  if (!input || typeof input !== 'object') return bucket;
  bucket.requests = Math.max(0, Math.round(safeNumber(input.requests)));
  bucket.promptTokens = Math.max(0, Math.round(safeNumber(input.promptTokens)));
  bucket.completionTokens = Math.max(0, Math.round(safeNumber(input.completionTokens)));
  bucket.totalTokens = Math.max(
    0,
    Math.round(safeNumber(input.totalTokens)) || bucket.promptTokens + bucket.completionTokens,
  );
  bucket.estimated = Math.max(0, Math.round(safeNumber(input.estimated)));
  bucket.last = input.last && typeof input.last === 'object' ? input.last : null;
  return bucket;
}

/* ------------------------------------------------------------------ */
/* 世界书                                                              */
/* ------------------------------------------------------------------ */

function normalizeEra(input) {
  if (!input || typeof input !== 'object') return null;
  const startYear = Math.round(
    clamp(safeNumber(input.startYear, 1), HISTORICAL_YEAR_MIN, HISTORICAL_YEAR_MAX),
  );
  const endYear = Math.round(
    clamp(safeNumber(input.endYear, startYear), startYear, HISTORICAL_YEAR_MAX),
  );
  const periods = toArray(input.periods, 40)
    .map((period) => {
      if (!period || typeof period !== 'object') return null;
      const name = asString(period.name, '', 60);
      if (!name) return null;
      const start = Math.round(clamp(safeNumber(period.startYear, startYear), startYear, endYear));
      return {
        name,
        startYear: start,
        endYear: Math.round(clamp(safeNumber(period.endYear, endYear), start, endYear)),
        summary: asString(period.summary, '', 500),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startYear - b.startYear);

  const events = toArray(input.events, 120)
    .map((event) => {
      if (!event || typeof event !== 'object') return null;
      const title = asString(event.title, '', 100);
      if (!title) return null;
      return {
        year: Math.round(clamp(safeNumber(event.year, startYear), startYear, endYear)),
        title,
        content: asString(event.content, '', 600),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.year - b.year);

  return {
    enabled: input.enabled !== false,
    dynasty: asString(input.dynasty, '', 40),
    label: asString(input.label, input.dynasty || '纪年', 60),
    startYear,
    endYear,
    defaultYear: Math.round(clamp(safeNumber(input.defaultYear, startYear), startYear, endYear)),
    calendar: asString(input.calendar, '公元', 20),
    periods,
    events,
  };
}

function normalizeSandboxDefaults(input, category, era) {
  const source = input && typeof input === 'object' ? input : {};
  const date = normalizeGameDate(source.date, {
    year: era?.defaultYear || 1,
    month: 1,
    day: 1,
  });
  if (era && (date.year < era.startYear || date.year > era.endYear)) {
    date.year = era.defaultYear;
  }
  return {
    currency: asString(source.currency, getSandboxCategory(category).currency, 20),
    startingMoney: Math.max(0, Math.round(safeNumber(source.startingMoney, 10))),
    location: asString(source.location, '未知之地', 100),
    date,
    time: asString(source.time, '清晨', 24),
    weather: asString(source.weather, '晴', 40),
  };
}

function normalizeSandboxScenario(input, index) {
  if (!input || typeof input !== 'object') return null;
  const title = asString(input.title, '', 100);
  const opening = asString(input.opening ?? input.narration, '', 3_000);
  if (!title || !opening) return null;
  return {
    id: asString(input.id, '', 80) || `sbscenario_${index}_${createId('s')}`,
    title,
    description: asString(input.description, '', 600),
    location: asString(input.location, '', 100),
    opening,
    choices: asArray(input.choices, 6, 120),
    inventory: normalizeInventory(input.inventory),
    money:
      input.money === null || input.money === undefined
        ? null
        : Math.max(0, Math.round(safeNumber(input.money))),
    realm: asString(input.realm, '凡人', 60),
    titleLabel: asString(input.titleLabel, '初入此世', 80),
    template: SANDBOX_HISTORICAL_TEMPLATES.some((item) => item.id === input.template)
      ? input.template
      : null,
    fixedFigure: normalizeFixedFigure(input.fixedFigure),
    creationMode:
      input.creationMode === 'fixed' || input.fixedFigure
        ? 'fixed'
        : input.creationMode === 'virtual'
          ? 'virtual'
          : null,
    yearStart:
      input.yearStart === null || input.yearStart === undefined
        ? null
        : Math.round(
            clamp(
              safeNumber(input.yearStart, 1),
              HISTORICAL_YEAR_MIN,
              HISTORICAL_YEAR_MAX,
            ),
          ),
    yearEnd:
      input.yearEnd === null || input.yearEnd === undefined
        ? null
        : Math.round(
            clamp(
              safeNumber(input.yearEnd, HISTORICAL_YEAR_MAX),
              HISTORICAL_YEAR_MIN,
              HISTORICAL_YEAR_MAX,
            ),
          ),
  };
}

/** 开场是否适用于当前历史年份；没有年份范围的开场默认全期可用。 */
export function isSandboxScenarioAvailable(scenario, year) {
  if (!scenario) return false;
  const target = Math.round(safeNumber(year, 1));
  if (scenario.yearStart !== null && scenario.yearStart !== undefined) {
    if (target < Number(scenario.yearStart)) return false;
  }
  if (scenario.yearEnd !== null && scenario.yearEnd !== undefined) {
    if (target > Number(scenario.yearEnd)) return false;
  }
  return true;
}

function normalizeEntry(input, index) {
  if (!input || typeof input !== 'object') return null;
  const content = asString(input.content, '', 3_000);
  if (!content) return null;
  return {
    id: asString(input.id, '', 80) || createId('sbentry'),
    title: asString(input.title, `条目 ${index + 1}`, 80),
    keywords: asArray(input.keywords, 20, 30),
    content,
    pinned: Boolean(input.pinned),
    priority: Math.round(clamp(safeNumber(input.priority, 50), 0, 100)),
  };
}

export function normalizeSandboxWorldbook(input, { id = null, builtin = false } = {}) {
  if (!input || typeof input !== 'object') {
    throw new SandboxSchemaError('沙盒世界书必须是一个 JSON 对象。');
  }
  const name = asString(input.name, '', 80);
  if (!name) throw new SandboxSchemaError('沙盒世界书缺少名称。');
  const category = SANDBOX_CATEGORIES.some((item) => item.id === input.category)
    ? input.category
    : 'xianxia';
  const era = normalizeEra(input.era);
  const scenarios = toArray(input.scenarios, 160)
    .map(normalizeSandboxScenario)
    .filter(Boolean);

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.sandbox-worldbook',
    id: id || (asString(input.id, '', 80) || createId('sbworld')),
    name,
    category,
    description: asString(input.description, '', 1_200),
    tags: asArray(input.tags, 12, 24),
    builtin: Boolean(builtin || input.builtin),
    createdAt: normalizeDate(input.createdAt),
    era,
    defaults: normalizeSandboxDefaults(input.defaults, category, era),
    genreRules: asString(input.genreRules ?? input.rules, '', 2_000),
    entries: toArray(input.entries, 80)
      .map(normalizeEntry)
      .filter(Boolean),
    scenarios,
  };
}

export function exportSandboxWorldbookPayload(worldbook) {
  return {
    ...worldbook,
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.sandbox-worldbook',
    builtin: false,
    exportedAt: new Date().toISOString(),
  };
}

/** 从多种包装格式中提取沙盒世界书条目。 */
export function prepareSandboxWorldbookImport(payload) {
  let items = [];
  if (Array.isArray(payload)) items = payload;
  else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.sandboxWorldbooks)) items = payload.sandboxWorldbooks;
    else if (Array.isArray(payload.worldbooks)) items = payload.worldbooks;
    else if (Array.isArray(payload.items)) items = payload.items;
    else items = [payload];
  }
  return toArray(items, SANDBOX_LIMITS.maxWorldbooks).map((item) =>
    normalizeSandboxWorldbook(item, {
      id: createId('sbworld'),
      builtin: false,
    }),
  );
}

export function sandboxWorldbookFilename(worldbook) {
  return `${sanitizeFileName(worldbook.name)}.sandbox-worldbook.json`;
}

/* ------------------------------------------------------------------ */
/* 历史年份映射                                                        */
/* ------------------------------------------------------------------ */

export function getWorldbookYearRange(worldbook) {
  if (!worldbook?.era?.enabled) return null;
  return {
    startYear: worldbook.era.startYear,
    endYear: worldbook.era.endYear,
    defaultYear: worldbook.era.defaultYear,
  };
}

/** 负数表示公元前，正数表示公元后。 */
export function formatHistoricalYear(year) {
  const value = Math.round(safeNumber(year, 1));
  if (value < 0) return `公元前 ${Math.abs(value)} 年`;
  if (value === 0) return '公元 1 年';
  return `公元 ${value} 年`;
}

/** 年份控件的紧凑写法：前2070 / 742。 */
export function formatHistoricalYearShort(year) {
  const value = Math.round(safeNumber(year, 1));
  return value < 0 ? `前${Math.abs(value)}` : String(value || 1);
}

/** 年份 + 月份；历史开局只精确到月，日默认沿用世界书。 */
export function formatHistoricalYearMonth(year, month) {
  const value = Math.round(clamp(safeNumber(month, 1), 1, 12));
  return `${formatHistoricalYear(year)} ${value}月`;
}

/** 区间写法：前2070–前1600 / 前202–9 / 618–907。 */
export function formatHistoricalYearRange(startYear, endYear) {
  const start = Math.round(safeNumber(startYear, 1));
  const end = Math.round(safeNumber(endYear, start));
  if (start < 0 && end < 0) return `前${Math.abs(start)}–前${Math.abs(end)}`;
  if (start < 0) return `前${Math.abs(start)}–${end}`;
  return `${start}–${end}`;
}

export function resolveHistoricalEra(worldbook, year) {
  const era = worldbook?.era;
  if (!era?.enabled) return null;
  const selectedYear = Math.round(
    clamp(safeNumber(year, era.defaultYear), era.startYear, era.endYear),
  );
  const periods = Array.isArray(era.periods) ? era.periods : [];
  const period =
    periods.find(
      (item) => selectedYear >= item.startYear && selectedYear <= item.endYear,
    ) ||
    periods
      .slice()
      .reverse()
      .find((item) => item.startYear <= selectedYear) ||
    periods[0] ||
    null;

  // 只提供“当前年份之前 30 年内”的史事，避免开局就剧透未来。
  const recentEvents = (era.events || [])
    .filter((event) => event.year <= selectedYear && event.year >= selectedYear - 30)
    .slice(-6);

  return {
    year: selectedYear,
    era,
    period,
    recentEvents,
    label: period ? `${era.label} · ${period.name}` : era.label,
    yearLabel: `${formatHistoricalYear(selectedYear)}${
      period ? ` · ${era.label} · ${period.name}` : ''
    }`,
  };
}

export function getSuggestedYears(worldbook) {
  const era = worldbook?.era;
  if (!era?.enabled) return [];
  const candidates = [];
  if (era.defaultYear) candidates.push({ year: era.defaultYear, label: '推荐开局' });
  for (const period of era.periods || []) {
    if (!candidates.some((item) => item.year === period.startYear)) {
      candidates.push({ year: period.startYear, label: period.name });
    }
  }
  const majorEvents = [...(era.events || [])]
    .sort((a, b) => b.year - a.year)
    .slice(0, 4);
  for (const event of majorEvents) {
    if (!candidates.some((item) => item.year === event.year)) {
      candidates.push({ year: event.year, label: event.title });
    }
  }
  return candidates.slice(0, 7);
}

export function formatGameDate(date) {
  if (!date) return '时间未知';
  return `${formatHistoricalYear(date.year)} ${date.month}月${date.day}日`;
}

/* ------------------------------------------------------------------ */
/* 存档                                                                */
/* ------------------------------------------------------------------ */

export function createDefaultAttributes(budget = 54, keys = SANDBOX_ATTRIBUTE_KEYS) {
  const targetKeys = keys?.length ? keys : SANDBOX_ATTRIBUTE_KEYS;
  const base = Math.floor(budget / targetKeys.length);
  let remainder = budget - base * targetKeys.length;
  const attributes = {};
  for (const key of targetKeys) {
    attributes[key] = clamp(base + (remainder > 0 ? 1 : 0), 3, 18);
    if (remainder > 0) remainder -= 1;
  }
  return attributes;
}

export function attributeTotal(attributes) {
  if (!attributes || typeof attributes !== 'object') return 0;
  return Object.values(attributes).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
}

export function normalizeSandboxSave(input, { worldbookIds = null, index = 0 } = {}) {
  if (!input || typeof input !== 'object') return null;
  const category = SANDBOX_CATEGORIES.some((item) => item.id === input.category)
    ? input.category
    : 'xianxia';
  let worldbookId = asString(input.worldbookId, '', 80) || null;
  if (worldbookIds && worldbookId && !worldbookIds.has(worldbookId)) worldbookId = null;

  const playerBase = normalizeSandboxPlayer(input.player, { category });
  const messages = toArray(input.messages, SANDBOX_LIMITS.maxMessages)
    .map(normalizeSandboxMessage)
    .filter(Boolean)
    .slice(-SANDBOX_LIMITS.maxMessages);
  const chronicles = toArray(input.chronicles, SANDBOX_LIMITS.maxChronicles)
    .map(normalizeSandboxChronicle)
    .filter(Boolean);
  const summarizedUntil = Math.min(
    messages.length,
    Math.max(0, Math.round(safeNumber(input.summarizedUntil))),
  );

  const world = normalizeSandboxWorldState(input.world, {
    date: { year: 1, month: 1, day: 1 },
    location: '未知之地',
    scene: { title: '', summary: '', choices: [] },
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.sandbox-save',
    id: asString(input.id, '', 80) || createId('sandbox'),
    name: asString(input.name, '', 80) || `沙盒 ${index + 1}`,
    category,
    worldbookId,
    initialYear: Math.round(
      clamp(
        safeNumber(input.initialYear, world.date.year),
        HISTORICAL_YEAR_MIN,
        HISTORICAL_YEAR_MAX,
      ),
    ),
    initialMonth: Math.round(clamp(safeNumber(input.initialMonth, world.date.month), 1, 12)),
    scenarioId: asString(input.scenarioId, '', 80),
    difficulty: SANDBOX_DIFFICULTIES.some((item) => item.id === input.difficulty)
      ? input.difficulty
      : 'normal',
    checksEnabled: input.checksEnabled !== false,
    player: playerBase,
    world,
    messages,
    chronicles,
    events: normalizeEventLedger(input.events),
    summarizedUntil,
    lastCheck: normalizeCheck(input.lastCheck),
    turn: Math.max(1, Math.round(safeNumber(input.turn, 1))),
    status: input.status === 'ended' ? 'ended' : 'active',
    tokenStats: normalizeSandboxStats(input.tokenStats),
    createdAt: normalizeDate(input.createdAt),
    updatedAt: normalizeDate(input.updatedAt),
    lastPlayedAt: normalizeDate(input.lastPlayedAt || input.updatedAt),
  };
}

export function createSandboxSave({
  name,
  category,
  worldbook,
  year,
  month,
  scenario,
  player,
  difficulty = 'normal',
  checksEnabled = true,
  openingOverride = null,
}) {
  const now = new Date().toISOString();
  const safeCategory = getSandboxCategory(category || worldbook.category);
  const safeDifficulty = getSandboxDifficulty(difficulty);
  const era = resolveHistoricalEra(worldbook, year);
  const defaultDate = worldbook.defaults?.date || { year: 1, month: 1, day: 1 };
  const date = {
    ...defaultDate,
    year: era?.year || defaultDate.year,
    month: Math.round(clamp(safeNumber(month, defaultDate.month), 1, 12)),
  };
  const selectedScenario =
    scenario ||
    worldbook.scenarios?.[0] || {
      title: '初入此世',
      description: '你站在一段尚未开始的命运之前。',
      location: worldbook.defaults?.location || '未知之地',
      opening: '天地辽阔，四下无人。{player}第一次意识到，从这里开始，每一个选择都会留下痕迹。',
      choices: ['观察四周', '寻找道路', '原地等待'],
      inventory: [],
      money: null,
      realm: '凡人',
      titleLabel: '初入此世',
    };

  const fixedFigure = selectedScenario.fixedFigure || null;
  const playerName = asString(
    fixedFigure?.name || player?.name,
    '无名旅人',
    40,
  );
  const template =
    safeCategory.id === 'historical'
      ? fixedFigure?.template ||
        player?.template ||
        selectedScenario.template ||
        (player?.attributes ? 'legacy' : 'commoner')
      : 'sandbox';
  const aging = createAgingState(
    player?.age || '未知',
    player?.agingLog || [],
  );

  const openingSource =
    String(openingOverride?.opening || '').trim() || selectedScenario.opening;
  const opening = String(openingSource || '')
    .replaceAll('{player}', playerName)
    .replaceAll('{year}', String(date.year))
    .replaceAll('{month}', String(date.month))
    .replaceAll('{location}', selectedScenario.location || worldbook.defaults?.location || '未知之地');

  const worldState = normalizeSandboxWorldState(
    {
      date,
      time: worldbook.defaults?.time || '清晨',
      weather: worldbook.defaults?.weather || '晴',
      location:
        openingOverride?.location ||
        selectedScenario.location ||
        worldbook.defaults?.location ||
        '未知之地',
      region: era ? era.era.label : '',
      danger: 12,
      scene: {
        title: openingOverride?.title || selectedScenario.title || '序章',
        summary: openingOverride?.summary || selectedScenario.description || '',
        choices: openingOverride?.choices?.length
          ? openingOverride.choices
          : selectedScenario.choices || [],
      },
      relationships: [],
      quests: [],
    },
    {},
  );

  const initialPlayer = normalizeSandboxPlayer(
    {
      ...player,
      name: playerName,
      age: fixedFigure?.age || player?.age,
      gender: fixedFigure?.gender || player?.gender,
      identity:
        fixedFigure?.title ||
        asString(player?.identity, '', 160) ||
        selectedScenario.titleLabel ||
        '初入此世',
      background:
        fixedFigure?.description ||
        player?.background ||
        '',
      template,
      agingE: player?.agingE ?? aging.agingE,
      ageBaseE: player?.ageBaseE ?? aging.ageBaseE,
      agingLog: player?.agingLog ?? aging.agingLog,
      fixedFigureId: fixedFigure?.name || '',
      creationMode: fixedFigure ? 'fixed' : 'virtual',
      currency: worldbook.defaults?.currency || safeCategory.currency,
      money: selectedScenario.money ?? worldbook.defaults?.startingMoney ?? 10,
      realm: selectedScenario.realm || '凡人',
      title: selectedScenario.titleLabel || '初入此世',
      inventory: selectedScenario.inventory || [],
      conditions: [],
      skills: [],
      health: 100,
      energy: 100,
    },
    { category: safeCategory.id },
  );

  const messages = opening
    ? [
        {
          id: createId('sbmsg'),
          role: 'assistant',
          content: opening,
          timestamp: now,
          check: null,
          opening: true,
        },
      ]
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.sandbox-save',
    id: createId('sandbox'),
    name:
      asString(name, '', 80) || `${playerName}·${worldbook.name}`.slice(0, 80),
    category: safeCategory.id,
    worldbookId: worldbook.id,
    initialYear: date.year,
    initialMonth: date.month,
    scenarioId: selectedScenario.id || '',
    difficulty: safeDifficulty.id,
    checksEnabled: Boolean(checksEnabled),
    player: initialPlayer,
    world: worldState,
    messages,
    chronicles: [],
    events: [],
    summarizedUntil: 0,
    lastCheck: null,
    turn: 1,
    status: 'active',
    tokenStats: createUsageBucket(),
    createdAt: now,
    updatedAt: now,
    lastPlayedAt: now,
  };
}

/**
 * 应用模型返回的状态块。
 * 只接受白名单字段，其他内容一律丢弃；缺失字段保留上一轮值。
 */
export function applySandboxStatePatch(save, patch) {
  const source = patch && typeof patch === 'object' ? patch : {};
  const playerSource = {};
  const playerKeys = [
    'health',
    'energy',
    'money',
    'reputation',
    'notoriety',
    'realm',
    'title',
    'conditions',
    'inventory',
    'skills',
    'attributes',
    'agingE',
    'agingLog',
    'resources',
  ];
  for (const key of playerKeys) {
    if (source[key] !== undefined) playerSource[key] = source[key];
  }
  if (source.attributes && typeof source.attributes === 'object') {
    playerSource.attributes = {
      ...(save.player?.attributes || {}),
      ...source.attributes,
    };
  }
  let player = normalizeSandboxPlayer(
    { ...save.player, ...playerSource },
    { category: save.category },
  );

  // 事件成长限制：单次单项 ±3，总点 ±6，避免 AI 一次把人物推到 108。
  if (source.attributes && typeof source.attributes === 'object') {
    const oldAttributes = save.player?.attributes || {};
    const next = { ...player.attributes };
    for (const [key, value] of Object.entries(next)) {
      if (oldAttributes[key] === undefined) continue;
      const oldValue = Number(oldAttributes[key]) || 0;
      const delta = Math.max(-3, Math.min(3, Number(value) - oldValue));
      next[key] = Math.max(3, Math.min(18, oldValue + delta));
    }
    const oldTotal = Object.values(oldAttributes).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0,
    );
    let newTotal = Object.values(next).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0,
    );
    const deltaTotal = Math.max(-6, Math.min(6, newTotal - oldTotal));
    let targetTotal = Math.min(
      SANDBOX_TOTAL_POINT_MAX,
      Math.max(18, oldTotal + deltaTotal),
    );
    while (newTotal > targetTotal) {
      const largest = Object.entries(next)
        .filter(([, value]) => value > 3)
        .sort((a, b) => b[1] - a[1])[0];
      if (!largest) break;
      next[largest[0]] -= 1;
      newTotal -= 1;
    }
    player = normalizeSandboxPlayer(
      { ...player, attributes: next },
      { category: save.category },
    );
  }

  const worldSource = {};
  const worldKeys = ['date', 'time', 'weather', 'location', 'region', 'danger', 'relationships', 'quests'];
  for (const key of worldKeys) {
    if (source[key] !== undefined) worldSource[key] = source[key];
  }
  if (source.scene !== undefined) {
    worldSource.scene = {
      ...save.world.scene,
      ...(source.scene && typeof source.scene === 'object' ? source.scene : {}),
    };
  }
  const world = normalizeSandboxWorldState({ ...save.world, ...worldSource }, save.world);

  return { player, world };
}

export function createSandboxChronicle({
  content,
  messageCount,
  rangeStart,
  rangeEnd,
  model = '',
  usage = null,
}) {
  return {
    id: createId('sbchronicle'),
    content: normalizeWhitespace(content).slice(0, 2_000),
    createdAt: new Date().toISOString(),
    messageCount,
    rangeStart,
    rangeEnd,
    model,
    usage,
  };
}

export function sandboxSaveFilename(save) {
  return `${sanitizeFileName(save.name)}.sandbox-save.json`;
}

export function formatSandboxLocation(save) {
  if (!save) return '';
  return [save.world?.location, save.world?.region].filter(Boolean).join(' · ');
}

export function summarizeSandboxAction(action) {
  return truncateText(action, 80);
}

export { normalizeWhitespace };
