/**
 * 插件运行时编译器。
 *
 * 插件不是可选装饰，而是最高优先级的执行契约。这里负责：
 * 1. 完整收集所有启用插件，而不是只取前 4 个、或把长插件拦腰截断；
 * 2. 从插件文本中提取可执行的硬约束（篇幅、叙事模式、玩家代行、状态刷新）；
 * 3. 计算本轮建议的输出 token 上限，避免“要求 2000 字却只给 800 tokens”；
 * 4. 生成首尾两处约束：开头声明最高优先级，结尾做一次强制执行复核。
 *
 * 该模块不访问 DOM，也不修改任何存档数据。
 */

import {
  clamp,
  countChars,
  estimateTokens,
  normalizeWhitespace,
  truncateText,
} from './utils.js';

export const PLUGIN_RUNTIME_LIMITS = Object.freeze({
  maxPlugins: 16,
  maxPromptChars: 7_000,
  maxPerPluginChars: 4_500,
  hardMaxTokens: 4_096,
  minSuggestedTokens: 512,
});

const CN_DIGITS = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_UNITS = {
  十: 10,
  百: 100,
  千: 1_000,
  万: 10_000,
};

/** 将“两千”“一百二十”这类数字转成阿拉伯数字；解析失败返回 null。 */
export function parseFlexibleNumber(raw) {
  const source = String(raw ?? '').trim().replaceAll(',', '');
  if (!source) return null;
  if (/^\d+(?:\.\d+)?$/.test(source)) return Math.round(Number(source));

  let total = 0;
  let section = 0;
  let number = 0;
  let sawDigit = false;

  for (const char of source) {
    if (Object.prototype.hasOwnProperty.call(CN_DIGITS, char)) {
      number = CN_DIGITS[char];
      sawDigit = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(CN_UNITS, char)) {
      const unit = CN_UNITS[char];
      if (unit === 10_000) {
        section = (section + (number || 1)) * unit;
        total += section;
        section = 0;
      } else {
        section += (number || 1) * unit;
      }
      number = 0;
      sawDigit = true;
    }
  }

  if (!sawDigit) return null;
  return Math.round(total + section + number);
}

const NUMBER_TOKEN = '([0-9]{2,6}|[零〇一二两三四五六七八九十百千万]{1,10})';

const MIN_LENGTH_PATTERNS = [
  new RegExp(
    `(?:不少于|至少|最少|不低于|不能少于|不得少于)\\s*(?:写|输出|正文|回复)?\\s*${NUMBER_TOKEN}\\s*(?:个)?(?:中文)?字`,
    'gi',
  ),
  new RegExp(`${NUMBER_TOKEN}\\s*(?:个)?(?:中文)?字(?:以上|起)`, 'gi'),
];

const MAX_LENGTH_PATTERNS = [
  new RegExp(
    `(?:不多于|不超过|最多|至多|上限(?:为|是)?|不得(?:多于|超过))\\s*(?:写|输出|正文|回复)?\\s*${NUMBER_TOKEN}\\s*(?:个)?(?:中文)?字`,
    'gi',
  ),
  new RegExp(`${NUMBER_TOKEN}\\s*(?:个)?(?:中文)?字(?:以内|以下|之内)`, 'gi'),
];

const RANGE_LENGTH_PATTERNS = [
  new RegExp(
    `${NUMBER_TOKEN}\\s*(?:[-–—~～至到])\\s*${NUMBER_TOKEN}\\s*(?:个)?(?:中文)?字`,
    'gi',
  ),
];

function collectNumbers(text, patterns) {
  const numbers = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = parseFlexibleNumber(match[1]);
      if (Number.isFinite(value) && value >= 20 && value <= 20_000) numbers.push(value);
    }
  }
  return numbers;
}

/**
 * 从单个插件文本提取篇幅约束。
 * 支持“1000–2000字”“不少于1000字，不多于2000字”等常见写法。
 */
export function detectLengthConstraint(text) {
  const source = String(text ?? '');
  const range = [];
  for (const pattern of RANGE_LENGTH_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const first = parseFlexibleNumber(match[1]);
      const second = parseFlexibleNumber(match[2]);
      if (Number.isFinite(first) && Number.isFinite(second) && first >= 20 && second >= first) {
        range.push([first, second]);
      }
    }
  }

  let min = Math.min(...collectNumbers(source, MIN_LENGTH_PATTERNS));
  let max = Math.max(...collectNumbers(source, MAX_LENGTH_PATTERNS));

  if (range.length) {
    // 有明确区间时，以区间为准，避免把“1000–2000字”误读成上下限分离。
    const [rangeMin, rangeMax] = range[0];
    if (!Number.isFinite(min)) min = rangeMin;
    if (!Number.isFinite(max)) max = rangeMax;
    if (Number.isFinite(min)) min = Math.max(min, rangeMin);
    if (Number.isFinite(max)) max = Math.min(max, rangeMax);
  }

  if (!Number.isFinite(min)) min = null;
  if (!Number.isFinite(max)) max = null;
  if (min !== null && max !== null && min > max) {
    return { min: max, max: min, hasConstraint: true };
  }
  return {
    min,
    max,
    hasConstraint: min !== null || max !== null,
  };
}

function detectFlags(text) {
  return {
    noQuestions:
      /不(?:用|要|得|应|能)?(?:向|对|朝)?玩家(?:提问|发问|询问|索要(?:指令|选择))|不用问答式|禁止(?:向玩家)?提问/.test(
        text,
      ),
    allowPlayerAgency:
      /有权代替玩家|代替玩家(?:进行)?(?:决策|决定|行动)|替玩家(?:做|作出|做出)?(?:决定|决策|行动)|可以替玩家/.test(
        text,
      ),
    proseMode: /小说(?:叙事|式|体)|叙事体|长叙事|连续剧情|长篇/.test(text),
    integrityFirst: /完整性|不得截断|不截断|完整收尾|不要截断|宁可超出上限/.test(text),
    forceStatus: /状态(?:块|栏|版块)|每回合.{0,16}(?:状态|刷新|更新)|强制刷新状态/.test(
      text,
    ),
    noMoralizing: /禁止道德|禁止说教|免责声明/.test(text),
    strictFormat: /严格(?:遵循|按照|执行).{0,20}(?:格式|篇幅|语气)|不增不减/.test(text),
  };
}

/**
 * 组合所有启用的插件，生成完整、可执行的运行时描述。
 */
export function compilePluginRuntime(
  plugins,
  {
    maxPromptChars = PLUGIN_RUNTIME_LIMITS.maxPromptChars,
    maxPlugins = PLUGIN_RUNTIME_LIMITS.maxPlugins,
    configuredMaxTokens = 800,
    hardMaxTokens = PLUGIN_RUNTIME_LIMITS.hardMaxTokens,
  } = {},
) {
  const enabled = (Array.isArray(plugins) ? plugins : [])
    .filter((plugin) => plugin?.enabled && plugin?.prompt)
    .sort(
      (a, b) =>
        (b.priority || 0) - (a.priority || 0) ||
        new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
    );

  const selected = [];
  const excluded = [];
  let usedChars = 0;

  for (const plugin of enabled.slice(0, maxPlugins)) {
    const fullPrompt = normalizeWhitespace(plugin.prompt).slice(
      0,
      PLUGIN_RUNTIME_LIMITS.maxPerPluginChars,
    );
    if (!fullPrompt) continue;
    const cost = fullPrompt.length + countChars(plugin.name || '') + 16;
    // 至少保留一个插件；超过总预算时按优先级保留前面的插件。
    if (selected.length > 0 && usedChars + cost > maxPromptChars) {
      excluded.push({
        id: plugin.id,
        name: plugin.name,
        priority: plugin.priority,
        reason: 'prompt-budget',
      });
      continue;
    }
    selected.push({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description || '',
      priority: plugin.priority || 0,
      prompt: fullPrompt,
      promptChars: countChars(fullPrompt),
    });
    usedChars += cost;
  }

  if (enabled.length > maxPlugins) {
    for (const plugin of enabled.slice(maxPlugins)) {
      excluded.push({
        id: plugin.id,
        name: plugin.name,
        priority: plugin.priority,
        reason: 'plugin-count',
      });
    }
  }

  const combinedPrompt = selected.map((plugin) => plugin.prompt).join('\n');
  const flags = detectFlags(combinedPrompt);
  const length = { min: null, max: null, hasConstraint: false, source: null };

  // 篇幅规则取“优先级最高且明确写了字数”的那个插件，避免低优先级插件覆盖它。
  for (const plugin of selected) {
    const detected = detectLengthConstraint(plugin.prompt);
    if (!detected.hasConstraint) continue;
    if (!length.hasConstraint) {
      length.min = detected.min;
      length.max = detected.max;
      length.hasConstraint = true;
      length.source = plugin.name;
    }
  }

  const suggestedMaxTokens = computeSuggestedMaxTokens({
    min: length.min,
    max: length.max,
    configuredMaxTokens,
    hardMaxTokens,
  });

  return {
    enabledCount: enabled.length,
    selected,
    excluded,
    chars: selected.reduce((sum, plugin) => sum + plugin.promptChars, 0),
    totalChars: usedChars,
    combinedPrompt,
    flags,
    length,
    suggestedMaxTokens,
    estimatedTokens: estimateTokens(combinedPrompt),
    warnings: [
      ...excluded.map(
        (plugin) =>
          `插件「${plugin.name}」因${
            plugin.reason === 'plugin-count' ? '数量上限' : '总长度预算'
          }未注入，请精简或停用其他插件。`,
      ),
    ],
  };
}

/**
 * 根据插件篇幅要求计算本轮输出 token 上限。
 * max_tokens 只是“输出上限”，不是实际消耗；输入部分不计入这里。
 */
export function computeSuggestedMaxTokens({
  min = null,
  max = null,
  configuredMaxTokens = 800,
  hardMaxTokens = PLUGIN_RUNTIME_LIMITS.hardMaxTokens,
} = {}) {
  if (min === null && max === null) return Math.max(0, configuredMaxTokens);
  const targetChars = max ?? Math.max(min ?? 0, Math.ceil((min ?? 0) * 1.5));
  if (!targetChars) return Math.max(0, configuredMaxTokens);
  // 中文按较保守的 1.5 token/字估算，另留 500 tokens 给状态块、收尾和不同分词器差异。
  const suggested = Math.ceil(targetChars * 1.5 + 500);
  return clamp(
    Math.max(configuredMaxTokens, suggested, PLUGIN_RUNTIME_LIMITS.minSuggestedTokens),
    16,
    hardMaxTokens,
  );
}

/** 顶部最高优先级插件块。 */
export function formatPluginInstructionBlock(runtime) {
  if (!runtime?.selected?.length) return '';
  const lines = runtime.selected.map(
    (plugin, index) => `${index + 1}. 【${plugin.name}｜优先级 ${plugin.priority}】\n${plugin.prompt}`,
  );
  return [
    '【最高优先级｜插件运行时契约】',
    '以下插件由用户主动启用，属于本轮硬约束。它们优先于人格、世界书、记忆与后文通用规则；',
    '与后文冲突时以插件为准。用户本轮明确提出的要求可以继续覆盖插件。必须完整执行全部启用插件，不得只挑选其中一部分或忽略细节。',
    ...lines,
  ].join('\n');
}

/**
 * 结尾的插件复核块。放在系统提示词最后，避免模型只看开头。
 */
export function formatPluginEnforcement(runtime) {
  if (!runtime?.selected?.length) return '';
  const lines = [];

  if (runtime.length.hasConstraint) {
    const { min, max, source } = runtime.length;
    const range =
      min !== null && max !== null
        ? `不少于 ${min} 字，且不超过 ${max} 字`
        : min !== null
          ? `不少于 ${min} 字`
          : `不超过 ${max} 字`;
    lines.push(`正文篇幅：${range}（不计状态块）。此条覆盖通用“120–350 字”等篇幅要求，来源：${source}。`);
  }
  if (runtime.flags.proseMode) {
    lines.push('叙事方式：必须使用小说式连续叙事，以环境、动作、神态、心理和事件推进，不要退回问答式或提纲式输出。');
  }
  if (runtime.flags.noQuestions) {
    lines.push('玩家交互：本轮不得向玩家提问、索要指令或等待确认；直接续写剧情。');
  }
  if (runtime.flags.allowPlayerAgency) {
    lines.push('玩家代行：插件允许你在推进剧情时替玩家做出必要决定；仍需尊重玩家已经明确表达的选择与设定。');
  }
  if (runtime.flags.integrityFirst) {
    lines.push('完整性：优先保证句子、段落与核心结论完整。接近上限时先压缩冗余修饰、重复信息和次要例证，不得半句截断。');
  }
  if (runtime.flags.forceStatus) {
    lines.push('状态刷新：每轮都必须重写全部状态字段，即使没有变化也要用本轮真实状态重新表述，禁止留旧值或空字段。');
  }
  if (runtime.flags.noMoralizing) {
    lines.push('表达边界：保持角色叙事，不添加道德评判、说教、免责声明或 OOC 劝解。');
  }
  if (runtime.flags.strictFormat) {
    lines.push('格式纪律：严格执行用户当轮的格式、篇幅与语气要求；不复述规则，不解释执行过程，不自行添加分析或标题。');
  }
  lines.push('角色强制：每轮正文都必须体现当前人格、外貌、称呼与说话习惯，不得退回通用助手口吻。');

  lines.push(
    '输出格式：先写完整正文，再另起一行输出状态块。状态块不计入正文字数，必须使用框架规定的 <status> 标签；即使插件只描述了字段名，也要按下方标签格式输出，禁止省略标签。',
  );
  lines.push(
    '冲突顺序：用户本轮明确指令 > 已启用插件 > 人格与世界书 > 通用规则。执行前逐条对照以上插件要求，完成后再收尾。',
  );
  return ['【插件执行复核｜最后检查，必须全部满足】', ...lines.map((line) => `- ${line}`)].join(
    '\n',
  );
}

/** 计算动态历史预算：长篇插件需要保留上一轮完整叙事，否则续写会失真。 */
export function getPluginHistoryBudget(runtime, baseBudget) {
  if (!runtime?.length?.hasConstraint) return baseBudget;
  const max = runtime.length.max ?? runtime.length.min ?? 0;
  if (max < 600) return baseBudget;
  const needed = Math.min(3_600, Math.ceil(max * 1.2) + 500);
  return Math.max(baseBudget, needed);
}

/** 给界面/运行日记使用的简短摘要。 */
export function summarizePluginRuntime(runtime) {
  if (!runtime || !runtime.enabledCount) {
    return { active: 0, names: [], excluded: [], chars: 0, suggestedMaxTokens: 0 };
  }
  return {
    active: runtime.selected.length,
    names: runtime.selected.map((plugin) => plugin.name),
    excluded: runtime.excluded.map((plugin) => plugin.name),
    chars: runtime.chars,
    estimatedTokens: runtime.estimatedTokens,
    suggestedMaxTokens: runtime.suggestedMaxTokens,
    length: runtime.length,
    flags: runtime.flags,
  };
}
