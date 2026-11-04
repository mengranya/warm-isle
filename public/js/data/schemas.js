/**
 * 数据模型、校验、规范化与工厂函数。
 *
 * 所有来自 LocalStorage / IndexedDB / 用户导入 JSON 的数据，
 * 都必须先经过这里，避免脏数据进入渲染层与提示词。
 */

import {
  DEFAULT_SETTINGS,
  LIMITS,
  PROVIDERS,
  SANDBOX_LIMITS,
  SCHEMA_VERSION,
  STATUS_FIELDS,
} from '../core/constants.js';
import {
  FULL_MEMORY_MAX_CHARS,
  normalizeMemoryStrength,
} from '../core/memory-strength.js';
import {
  clamp,
  clone,
  compactText,
  createId,
  createUsageBucket,
  normalizeWhitespace,
  safeColor,
  safeNumber,
  sanitizeFileName,
  toArray,
  truncateText,
  uniqueBy,
} from '../core/utils.js';
import {
  BUILTIN_PERSONAS,
  BUILTIN_PLUGINS,
  BUILTIN_WORLDBOOKS,
} from './presets.js';
import {
  BUILTIN_SANDBOX_PLUGINS,
  BUILTIN_SANDBOX_WORLDBOOKS,
} from './sandbox-presets.js';
import {
  normalizeSandboxSave,
  normalizeSandboxWorldbook,
} from './sandbox-schemas.js';

export class SchemaError extends Error {
  constructor(message, detail = null) {
    super(message);
    this.name = 'SchemaError';
    this.detail = detail;
  }
}

const ANIMATION_IDS = new Set(['none', 'bounce', 'gradient', 'glow']);

function asString(value, fallback = '', max = 4_000) {
  if (typeof value === 'number') return String(value).slice(0, max);
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

function asArray(value, max = 20, itemMax = 80) {
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

function normalizeEmojiList(value) {
  const emojis = asArray(value, 16, 12).filter((emoji) => Array.from(emoji).length <= 6);
  return emojis.length ? emojis : ['🌷'];
}

function normalizeOpeningStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    health: asString(raw.health, '', 160),
    outfit: asString(raw.outfit, '', 180),
    environment: asString(raw.environment, '', 180),
    action: asString(raw.action, '', 180),
    notes: asString(raw.notes, '', LIMITS.maxStatusNotes),
  };
}

/* ------------------------------------------------------------------ */
/* 人格                                                                */
/* ------------------------------------------------------------------ */

export function normalizePersona(input, { id = null, builtin = false } = {}) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('人格数据必须是一个 JSON 对象。');
  }
  const name = asString(input.name, '', LIMITS.maxPersonaName);
  if (!name) {
    throw new SchemaError('人格缺少「姓名」字段。');
  }

  const dialogue = input.dialogue && typeof input.dialogue === 'object' ? input.dialogue : {};
  const animation = ANIMATION_IDS.has(dialogue.animation) ? dialogue.animation : 'none';

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.persona',
    id: id || (asString(input.id, '', 80) || createId('persona')),
    name,
    age: asString(input.age, '未知', 24),
    pronouns: asString(input.pronouns, 'TA', 8),
    identity: asString(input.identity, '身份未设定', 160),
    personality: asString(input.personality, '性格未设定', 1_200),
    appearance: asString(input.appearance, '', 800),
    background: asString(input.background, '', 1_200),
    likes: asArray(input.likes, 20, 40),
    address: asString(input.address, '你', 40),
    greeting: asString(input.greeting, '', 800),
    dialogue: {
      color: safeColor(dialogue.color, '#c56b57'),
      animation,
      emojiEnabled: dialogue.emojiEnabled !== false,
      emojis: normalizeEmojiList(dialogue.emojis),
      habits: asString(dialogue.habits, '', 800),
    },
    tags: asArray(input.tags, 12, 24),
    openingStatus: normalizeOpeningStatus(input.openingStatus),
    builtin: Boolean(builtin || input.builtin),
    createdAt: normalizeDate(input.createdAt),
  };
}

export function normalizeWorldbook(input, { id = null, builtin = false } = {}) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('世界书数据必须是一个 JSON 对象。');
  }
  const name = asString(input.name, '', 80);
  if (!name) throw new SchemaError('世界书缺少「名称」字段。');

  const entries = toArray(input.entries, 80)
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null;
      const content = asString(entry.content, '', 3_000);
      if (!content) return null;
      return {
        id: asString(entry.id, '', 80) || createId('entry'),
        title: asString(entry.title, `条目 ${index + 1}`, 80),
        keywords: asArray(entry.keywords, 20, 30),
        content,
        pinned: Boolean(entry.pinned),
        priority: Math.round(clamp(safeNumber(entry.priority, 50), 0, 100)),
      };
    })
    .filter(Boolean);

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.worldbook',
    id: id || (asString(input.id, '', 80) || createId('world')),
    name,
    description: asString(input.description, '', 1_200),
    tags: asArray(input.tags, 12, 24),
    entries,
    builtin: Boolean(builtin || input.builtin),
    createdAt: normalizeDate(input.createdAt),
  };
}

export function normalizePlugin(input, { id = null, builtin = false } = {}) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('插件数据必须是一个 JSON 对象。');
  }
  const name = asString(input.name, '', 80);
  const prompt = asString(input.prompt, '', 6_000);
  if (!name) throw new SchemaError('插件缺少「name」字段。');
  if (!prompt) throw new SchemaError(`插件「${name}」缺少 prompt 指令。`);

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.plugin',
    id: id || (asString(input.id, '', 80) || createId('plugin')),
    name,
    description: asString(input.description, '', 400),
    author: asString(input.author, '未署名', 80),
    version: asString(input.version, '1.0.0', 24),
    prompt,
    enabled: input.enabled === true,
    userToggled: Boolean(input.userToggled),
    priority: Math.round(clamp(safeNumber(input.priority, 50), 0, 100)),
    builtin: Boolean(builtin || input.builtin),
    createdAt: normalizeDate(input.createdAt),
  };
}

/* ------------------------------------------------------------------ */
/* 状态、消息、日记                                                    */
/* ------------------------------------------------------------------ */

function statusFieldMax(key) {
  return STATUS_FIELDS.find((field) => field.key === key)?.max || 200;
}

export function normalizeStatus(input, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const result = {
    health: asString(source.health ?? base.health, '', statusFieldMax('health')),
    outfit: asString(source.outfit ?? base.outfit, '', statusFieldMax('outfit')),
    environment: asString(
      source.environment ?? base.environment,
      '',
      statusFieldMax('environment'),
    ),
    action: asString(source.action ?? base.action, '', statusFieldMax('action')),
    notes: asString(source.notes ?? base.notes, '', LIMITS.maxStatusNotes),
    updatedAt: normalizeDate(source.updatedAt || base.updatedAt || Date.now()),
    source: ['ai', 'manual', 'initial'].includes(source.source)
      ? source.source
      : base.source || 'manual',
  };
  return result;
}

function normalizeMessage(input, index) {
  if (!input || typeof input !== 'object') return null;
  const role = input.role === 'assistant' ? 'assistant' : input.role === 'user' ? 'user' : null;
  if (!role) return null;
  const content = normalizeWhitespace(input.content ?? input.text ?? '').slice(0, 20_000);
  if (!content) return null;
  return {
    id: asString(input.id, '', 80) || `msg_${index}_${createId('m')}`,
    role,
    content,
    timestamp: normalizeDate(input.timestamp || input.at),
    provider: asString(input.provider, '', 40),
    model: asString(input.model, '', 160),
    usage: input.usage && typeof input.usage === 'object' ? input.usage : null,
  };
}

function normalizeDiary(input, index) {
  if (!input || typeof input !== 'object') return null;
  const content = normalizeWhitespace(input.content ?? input.summary ?? '').slice(
    0,
    FULL_MEMORY_MAX_CHARS,
  );
  if (!content) return null;
  return {
    id: asString(input.id, '', 80) || createId('diary'),
    content,
    memoryStrength: normalizeMemoryStrength(input.memoryStrength, 40),
    createdAt: normalizeDate(input.createdAt || input.at),
    messageCount: Math.max(0, Math.round(safeNumber(input.messageCount))),
    rangeStart: Math.max(0, Math.round(safeNumber(input.rangeStart, index))),
    rangeEnd: Math.max(0, Math.round(safeNumber(input.rangeEnd, index))),
    model: asString(input.model, '', 160),
    usage: input.usage && typeof input.usage === 'object' ? input.usage : null,
  };
}

function normalizeNpc(input, index) {
  if (!input || typeof input !== 'object') return null;
  const name = asString(input.name, '', 40);
  if (!name) return null;
  return {
    id: asString(input.id, '', 80) || createId('npc'),
    name,
    identity: asString(input.identity ?? input.role, '身份未设定', 160),
    style: asString(input.style, '', 500),
    appearance: asString(input.appearance, '', 500),
    color: safeColor(input.color, '#b8846b'),
    source: input.source === 'ai' ? 'ai' : 'manual',
    createdAt: normalizeDate(input.createdAt || Date.now()),
    index,
  };
}

export function normalizeProtagonist(input, { fallbackName = '旅人' } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const name = asString(source.name, fallbackName, 40) || fallbackName;
  const extras = toArray(source.extras, 20)
    .map((field, index) => {
      if (!field || typeof field !== 'object') return null;
      const label = asString(field.label ?? field.key, '', 40);
      const value = asString(field.value, '', 500);
      if (!label || !value) return null;
      return {
        id: asString(field.id, '', 80) || `extra_${index}`,
        label,
        value,
      };
    })
    .filter(Boolean);

  return {
    name,
    age: asString(source.age, '', 24),
    identity: asString(source.identity, '', 200),
    likes: asString(source.likes, '', 600),
    extras,
  };
}

function normalizeStats(input) {
  const bucket = createUsageBucket();
  if (!input || typeof input !== 'object') return bucket;

  bucket.requests = Math.max(0, Math.round(safeNumber(input.requests)));
  bucket.promptTokens = Math.max(0, Math.round(safeNumber(input.promptTokens)));
  bucket.completionTokens = Math.max(0, Math.round(safeNumber(input.completionTokens)));
  bucket.totalTokens = Math.max(
    0,
    Math.round(safeNumber(input.totalTokens)) ||
      bucket.promptTokens + bucket.completionTokens,
  );
  bucket.estimated = Math.max(0, Math.round(safeNumber(input.estimated)));
  bucket.last = input.last && typeof input.last === 'object' ? input.last : null;

  if (input.byProvider && typeof input.byProvider === 'object') {
    bucket.byProvider = {};
    for (const [providerId, providerStats] of Object.entries(input.byProvider)) {
      if (!PROVIDERS[providerId] || !providerStats || typeof providerStats !== 'object') continue;
      const providerBucket = createUsageBucket();
      providerBucket.requests = Math.max(0, Math.round(safeNumber(providerStats.requests)));
      providerBucket.promptTokens = Math.max(
        0,
        Math.round(safeNumber(providerStats.promptTokens)),
      );
      providerBucket.completionTokens = Math.max(
        0,
        Math.round(safeNumber(providerStats.completionTokens)),
      );
      providerBucket.totalTokens = Math.max(
        0,
        Math.round(safeNumber(providerStats.totalTokens)),
      );
      providerBucket.estimated = Math.max(0, Math.round(safeNumber(providerStats.estimated)));
      bucket.byProvider[providerId] = providerBucket;
    }
  }
  return bucket;
}

/* ------------------------------------------------------------------ */
/* 存档                                                                */
/* ------------------------------------------------------------------ */

export function buildInitialStatus(persona, worldbook) {
  if (persona?.openingStatus) {
    return normalizeStatus(
      {
        ...persona.openingStatus,
        environment:
          persona.openingStatus.environment ||
          (worldbook ? `${worldbook.name}的某个安静角落` : '熟悉的地方'),
        updatedAt: new Date().toISOString(),
        source: 'initial',
      },
      {},
    );
  }
  return normalizeStatus({
    health: '呼吸平稳，状态安然',
    outfit: '随场景而变的日常衣着',
    environment: worldbook?.name ? `${worldbook.name}的某个角落` : '熟悉的地方',
    action: '安静地等待着下一次相遇',
    notes: '故事刚刚开始，一切细节都还留有改变的余地。',
    updatedAt: new Date().toISOString(),
    source: 'initial',
  });
}

function normalizeStrongMemories(input) {
  return toArray(input, 10_000)
    .map((item) => {
      if (typeof item === 'string') return asString(item, '', 1_000_000);
      if (!item || typeof item !== 'object') return '';
      return asString(item.text ?? item.content ?? item.note, '', 1_000_000);
    })
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

export function createArchiveRecord({
  name,
  persona,
  worldbook,
  protagonist,
  npcs = [],
  greeting = '',
  openingStatus = null,
}) {
  const now = new Date().toISOString();
  const player = normalizeProtagonist(protagonist);
  const initialGreeting =
    normalizeWhitespace(greeting).slice(0, 2_000) ||
    persona.greeting ||
    `（${persona.name}看了你一会儿，像是在确认你真的来了。）`;

  const messages = initialGreeting
    ? [
        {
          id: createId('msg'),
          role: 'assistant',
          content: initialGreeting,
          timestamp: now,
          provider: '',
          model: '',
          usage: null,
        },
      ]
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId('archive'),
    name: asString(name, `${persona.name}的存档`, 80),
    personaId: persona.id,
    worldbookId: worldbook?.id || null,
    protagonist: player,
    npcs: toArray(npcs, 20).map(normalizeNpc).filter(Boolean),
    messages,
    status: normalizeStatus(openingStatus || buildInitialStatus(persona, worldbook)),
    strongMemories: [],
    diaries: [],
    summarizedUntil: 0,
    tokenStats: createUsageBucket(),
    createdAt: now,
    updatedAt: now,
    lastChatAt: now,
  };
}

function normalizeArchive(input, context) {
  if (!input || typeof input !== 'object') return null;
  const { personaIds, worldbookIds, index } = context;
  const fallbackPersonaId = personaIds[0];
  let personaId = asString(input.personaId, '', 80);
  if (!personaIds.has(personaId)) personaId = fallbackPersonaId;
  if (!personaId) return null;

  let worldbookId = asString(input.worldbookId, '', 80) || null;
  if (worldbookId && !worldbookIds.has(worldbookId)) worldbookId = null;

  const messages = toArray(input.messages, LIMITS.maxMessages)
    .map(normalizeMessage)
    .filter(Boolean)
    .slice(-LIMITS.maxMessages);

  const diaries = toArray(input.diaries, 500)
    .map(normalizeDiary)
    .filter(Boolean);

  const summarizedUntil = Math.min(
    messages.length,
    Math.max(0, Math.round(safeNumber(input.summarizedUntil))),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    id: asString(input.id, '', 80) || createId('archive'),
    name: asString(input.name, `存档 ${index + 1}`, 80),
    personaId,
    worldbookId,
    protagonist: normalizeProtagonist(input.protagonist),
    npcs: toArray(input.npcs, 20).map(normalizeNpc).filter(Boolean),
    messages,
    status: normalizeStatus(input.status),
    strongMemories: normalizeStrongMemories(input.strongMemories),
    diaries,
    summarizedUntil,
    tokenStats: normalizeStats(input.tokenStats),
    createdAt: normalizeDate(input.createdAt),
    updatedAt: normalizeDate(input.updatedAt),
    lastChatAt: normalizeDate(input.lastChatAt || input.updatedAt),
  };
}

/* ------------------------------------------------------------------ */
/* 其他                                                                */
/* ------------------------------------------------------------------ */

export function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const providerId = PROVIDERS[source.provider] ? source.provider : DEFAULT_SETTINGS.provider;
  const provider = PROVIDERS[providerId];
  const defaultModel = provider.models[0]?.id || '';
  let model = asString(source.model, defaultModel, 160);
  if (!model) model = defaultModel;

  const keyVault = {};
  if (source.keyVault && typeof source.keyVault === 'object') {
    for (const [providerKey, cipher] of Object.entries(source.keyVault)) {
      if (PROVIDERS[providerKey] && typeof cipher === 'string' && cipher.length < 8_000) {
        keyVault[providerKey] = cipher;
      }
    }
  }

  return {
    provider: providerId,
    model,
    baseUrl: asString(source.baseUrl, '', 500),
    temperature: clamp(safeNumber(source.temperature, DEFAULT_SETTINGS.temperature), 0, 2),
    maxTokens: Math.round(clamp(safeNumber(source.maxTokens, DEFAULT_SETTINGS.maxTokens), 64, 4_096)),
    stream: source.stream !== false,
    useServerKey: source.useServerKey !== false,
    rememberKeys: source.rememberKeys !== false,
    demoMode: source.demoMode === true,
    contextChars: Math.round(
      clamp(safeNumber(source.contextChars, LIMITS.contextChars), 1_800, 12_000),
    ),
    diaryMemoryStrength: normalizeMemoryStrength(
      source.diaryMemoryStrength,
      DEFAULT_SETTINGS.diaryMemoryStrength,
    ),
    keyVault,
  };
}

export function normalizeLog(input) {
  if (!input || typeof input !== 'object') return null;
  const level = ['info', 'warn', 'error'].includes(input.level) ? input.level : 'info';
  const at = normalizeDate(input.at || input.timestamp);
  const error =
    input.error && typeof input.error === 'object'
      ? {
          name: asString(input.error.name, 'Error', 120),
          message: asString(input.error.message, '', 2_000),
          stack: asString(input.error.stack, '', 8_000),
          code: asString(input.error.code, '', 80),
          requestId: asString(input.error.requestId, '', 80),
        }
      : null;

  return {
    id: asString(input.id, '', 80) || createId('log'),
    at,
    level,
    event: asString(input.event, 'event', 80),
    message: asString(input.message, '', 500),
    detail: input.detail ?? null,
    error,
    archiveId: asString(input.archiveId, '', 80) || null,
    route: asString(input.route, '', 80) || null,
  };
}

/* ------------------------------------------------------------------ */
/* 初始状态 / 总规范化                                                 */
/* ------------------------------------------------------------------ */

export function createInitialState() {
  return normalizeState({});
}

/**
 * 将任意已存储数据规范化为可运行状态。
 * - 内置内容会补齐，但保留内置插件的开关状态。
 * - 引用不存在的存档人格会回退到第一个人格。
 */
export function normalizeState(input) {
  const source = input && typeof input === 'object' ? input : {};
  const settings = normalizeSettings(source.settings);

  const builtinPersonaMap = new Map(
    BUILTIN_PERSONAS.map((persona) => [persona.id, normalizePersona(persona, { builtin: true })]),
  );
  const rawPersonas = toArray(source.personas, LIMITS.maxImportedItems)
    .map((persona) => {
      try {
        return normalizePersona(persona, {
          id: persona?.builtin ? persona.id : null,
          builtin: Boolean(persona?.builtin),
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  for (const raw of rawPersonas) {
    if (raw.builtin && builtinPersonaMap.has(raw.id)) continue;
    builtinPersonaMap.set(raw.id, raw);
  }
  // 若旧存档里移除了某个内置人格，重新补回。
  for (const preset of BUILTIN_PERSONAS) {
    if (!builtinPersonaMap.has(preset.id)) {
      builtinPersonaMap.set(preset.id, normalizePersona(preset, { builtin: true }));
    }
  }
  const personas = Array.from(builtinPersonaMap.values());

  const builtinWorldbookMap = new Map(
    BUILTIN_WORLDBOOKS.map((worldbook) => [
      worldbook.id,
      normalizeWorldbook(worldbook, { builtin: true }),
    ]),
  );
  for (const raw of toArray(source.worldbooks, LIMITS.maxImportedItems)) {
    try {
      const worldbook = normalizeWorldbook(raw, {
        id: raw?.builtin ? raw.id : null,
        builtin: Boolean(raw?.builtin),
      });
      if (worldbook.builtin && builtinWorldbookMap.has(worldbook.id)) continue;
      builtinWorldbookMap.set(worldbook.id, worldbook);
    } catch {
      /* skip invalid */
    }
  }
  for (const preset of BUILTIN_WORLDBOOKS) {
    if (!builtinWorldbookMap.has(preset.id)) {
      builtinWorldbookMap.set(preset.id, normalizeWorldbook(preset, { builtin: true }));
    }
  }
  const worldbooks = Array.from(builtinWorldbookMap.values());

  const rawPlugins = toArray(source.plugins, LIMITS.maxImportedItems);
  const pluginMap = new Map();
  for (const preset of BUILTIN_PLUGINS) {
    const saved = rawPlugins.find((item) => item?.id === preset.id);
    const normalized = normalizePlugin(preset, { builtin: true });
    if (saved) {
      normalized.enabled = saved.enabled === true;
      normalized.priority = Math.round(clamp(safeNumber(saved.priority, normalized.priority), 0, 100));
    }
    pluginMap.set(normalized.id, normalized);
  }
  for (const raw of rawPlugins) {
    try {
      if (raw?.builtin && pluginMap.has(raw.id)) continue;
      const plugin = normalizePlugin(raw, {
        id: raw?.builtin ? raw.id : null,
        builtin: Boolean(raw?.builtin),
      });
      pluginMap.set(plugin.id, plugin);
    } catch {
      /* skip invalid */
    }
  }
  const plugins = Array.from(pluginMap.values());

  /* ---------------- 沙盒世界：独立的世界书 / 规则 / 存档 ---------------- */

  const sandboxWorldbookMap = new Map(
    BUILTIN_SANDBOX_WORLDBOOKS.map((worldbook) => [
      worldbook.id,
      normalizeSandboxWorldbook(worldbook, { builtin: true }),
    ]),
  );
  for (const raw of toArray(source.sandboxWorldbooks, SANDBOX_LIMITS.maxWorldbooks)) {
    try {
      const worldbook = normalizeSandboxWorldbook(raw, {
        id: raw?.builtin ? raw.id : null,
        builtin: Boolean(raw?.builtin),
      });
      if (worldbook.builtin && sandboxWorldbookMap.has(worldbook.id)) continue;
      sandboxWorldbookMap.set(worldbook.id, worldbook);
    } catch {
      /* skip invalid */
    }
  }
  for (const preset of BUILTIN_SANDBOX_WORLDBOOKS) {
    if (!sandboxWorldbookMap.has(preset.id)) {
      sandboxWorldbookMap.set(
        preset.id,
        normalizeSandboxWorldbook(preset, { builtin: true }),
      );
    }
  }
  const sandboxWorldbooks = Array.from(sandboxWorldbookMap.values());

  const rawSandboxPlugins = toArray(
    source.sandboxPlugins,
    LIMITS.maxImportedItems,
  );
  const sandboxPluginMap = new Map();
  for (const preset of BUILTIN_SANDBOX_PLUGINS) {
    const saved = rawSandboxPlugins.find((item) => item?.id === preset.id);
    const normalized = normalizePlugin(preset, { builtin: true });
    if (saved) {
      normalized.enabled =
        preset.id === 'sb_plugin_decision_hints'
          ? saved.userToggled
            ? saved.enabled === true
            : true
          : saved.enabled === true;
      normalized.userToggled = Boolean(saved.userToggled);
      normalized.priority = Math.round(
        clamp(safeNumber(saved.priority, normalized.priority), 0, 100),
      );
    }
    sandboxPluginMap.set(normalized.id, normalized);
  }
  for (const raw of rawSandboxPlugins) {
    try {
      if (raw?.builtin && sandboxPluginMap.has(raw.id)) continue;
      const plugin = normalizePlugin(raw, {
        id: raw?.builtin ? raw.id : null,
        builtin: Boolean(raw?.builtin),
      });
      sandboxPluginMap.set(plugin.id, plugin);
    } catch {
      /* skip invalid */
    }
  }
  const sandboxPlugins = Array.from(sandboxPluginMap.values());

  const sandboxWorldbookIds = new Set(
    sandboxWorldbooks.map((worldbook) => worldbook.id),
  );
  const sandboxSaves = toArray(source.sandboxSaves, SANDBOX_LIMITS.maxSaves)
    .map((save, index) =>
      normalizeSandboxSave(save, { worldbookIds: sandboxWorldbookIds, index }),
    )
    .filter(Boolean);
  let activeSandboxSaveId = asString(source.activeSandboxSaveId, '', 80) || null;
  if (!sandboxSaves.some((save) => save.id === activeSandboxSaveId)) {
    activeSandboxSaveId = sandboxSaves[0]?.id || null;
  }

  const personaIds = new Set(personas.map((persona) => persona.id));
  const worldbookIds = new Set(worldbooks.map((worldbook) => worldbook.id));
  const archives = toArray(source.archives, LIMITS.maxArchives)
    .map((archive, index) => normalizeArchive(archive, { personaIds, worldbookIds, index }))
    .filter(Boolean);

  let activeArchiveId = asString(source.activeArchiveId, '', 80) || null;
  if (!archives.some((archive) => archive.id === activeArchiveId)) {
    activeArchiveId = archives[0]?.id || null;
  }

  const logs = toArray(source.logs, LIMITS.maxLogs)
    .map(normalizeLog)
    .filter(Boolean)
    .slice(-LIMITS.maxLogs);

  return {
    schemaVersion: SCHEMA_VERSION,
    settings,
    personas,
    worldbooks,
    plugins,
    archives,
    activeArchiveId,
    sandboxWorldbooks,
    sandboxPlugins,
    sandboxSaves,
    activeSandboxSaveId,
    stats: normalizeStats(source.stats),
    logs,
    meta: {
      createdAt: normalizeDate(source.meta?.createdAt || Date.now()),
      lastOpenedAt: normalizeDate(source.meta?.lastOpenedAt || Date.now()),
      lastRoute: asString(source.meta?.lastRoute, 'archives', 40),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 导入解析                                                            */
/* ------------------------------------------------------------------ */

/**
 * 从多种导出形态中提取待导入条目：
 * - [item, item]
 * - { personas: [...] } / { worldbooks: [...] } / { plugins: [...] }
 * - { kind: 'warm-isle.persona', ... }
 */
export function extractImportItems(payload, type) {
  if (Array.isArray(payload)) return toArray(payload, LIMITS.maxImportedItems);
  if (!payload || typeof payload !== 'object') {
    throw new SchemaError('无法识别的 JSON 结构。');
  }

  const collectionKeys = {
    persona: ['personas'],
    worldbook: ['worldbooks'],
    plugin: ['plugins'],
  }[type] || [];

  for (const key of collectionKeys) {
    if (Array.isArray(payload[key])) {
      return toArray(payload[key], LIMITS.maxImportedItems);
    }
  }
  if (Array.isArray(payload.items)) return toArray(payload.items, LIMITS.maxImportedItems);
  if (payload.data && typeof payload.data === 'object') {
    if (Array.isArray(payload.data)) return toArray(payload.data, LIMITS.maxImportedItems);
    return [payload.data];
  }
  return [payload];
}

export function preparePersonaImport(payload) {
  const items = extractImportItems(payload, 'persona');
  // 导入总是分配新 ID，避免与内置人格或已有同名文件互相覆盖。
  return items.map((item) =>
    normalizePersona(item, { id: createId('persona'), builtin: false }),
  );
}

export function prepareWorldbookImport(payload) {
  const items = extractImportItems(payload, 'worldbook');
  return items.map((item) =>
    normalizeWorldbook(item, { id: createId('world'), builtin: false }),
  );
}

export function preparePluginImport(payload) {
  const items = extractImportItems(payload, 'plugin');
  return items.map((item) =>
    normalizePlugin(item, { id: createId('plugin'), builtin: false }),
  );
}

export function mergeImportedItems(existing, incoming, type) {
  const list = [...existing];
  const existingIds = new Set(list.map((item) => item.id));
  let imported = 0;
  const names = new Set(list.map((item) => `${item.name}`.toLowerCase()));

  for (const item of incoming) {
    let next = clone(item);
    if (!next.id || existingIds.has(next.id)) next.id = createId(type);
    // 重名时添加序号，避免 UI 无法区分。
    if (names.has(next.name.toLowerCase())) {
      let counter = 2;
      let candidate = `${item.name}（${counter}）`;
      while (names.has(candidate.toLowerCase())) {
        counter += 1;
        candidate = `${item.name}（${counter}）`;
      }
      next.name = candidate;
    }
    existingIds.add(next.id);
    names.add(next.name.toLowerCase());
    list.push(next);
    imported += 1;
  }
  return { list, imported };
}

export function exportPersonaPayload(persona) {
  return {
    ...persona,
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.persona',
    builtin: false,
    exportedAt: new Date().toISOString(),
  };
}

export function exportWorldbookPayload(worldbook) {
  return {
    ...worldbook,
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.worldbook',
    builtin: false,
    exportedAt: new Date().toISOString(),
  };
}

export function exportPluginPayload(plugin) {
  return {
    ...plugin,
    schemaVersion: SCHEMA_VERSION,
    kind: 'warm-isle.plugin',
    builtin: false,
    exportedAt: new Date().toISOString(),
  };
}

export function personaExportFilename(persona) {
  return `${sanitizeFileName(persona.name)}.persona.json`;
}

/* ------------------------------------------------------------------ */
/* 演示存档                                                            */
/* ------------------------------------------------------------------ */

export function createDemoArchive(state) {
  const persona =
    state.personas.find((item) => item.id === 'persona_shen_zhixia') || state.personas[0];
  const worldbook =
    state.worldbooks.find((item) => item.id === 'world_mist_harbor') || state.worldbooks[0];
  return createArchiveRecord({
    name: '雾屿的初见',
    persona,
    worldbook,
    protagonist: {
      name: '林屿',
      age: '25',
      identity: '刚搬回雾屿镇的插画编辑',
      likes: '雨天、柑橘、旧电影，以及书店里那只叫页码的橘猫',
      extras: [{ label: '随身物品', value: '一把总也晾不干的深蓝色雨伞' }],
    },
    greeting: persona.greeting,
    openingStatus: buildInitialStatus(persona, worldbook),
  });
}

/** 根据玩家输入生成开场白中的简单占位替换。 */
export function personalizeGreeting(greeting, protagonist, persona) {
  return String(greeting || '')
    .replaceAll('{player}', protagonist?.name || '你')
    .replaceAll('{address}', persona?.address || '你')
    .replaceAll('{{player}}', protagonist?.name || '你');
}

export { compactText, truncateText };
