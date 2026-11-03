/**
 * 沙盒世界提示词构建器。
 *
 * 与恋爱对话提示词完全分开：
 * - AI 是世界引擎 / 主持人，不是某个恋爱人格；
 * - 玩家只控制自己，AI 控制世界、NPC、因果与后果；
 * - 通过行动判定、时间/资源/关系状态与结构化状态块维持游戏性；
 * - 插件只来自 sandboxPlugins，不读取恋爱对话插件。
 */

import {
  SANDBOX_LIMITS,
  SANDBOX_TOTAL_POINT_MAX,
  getHistoricalTemplate,
  getSandboxAbilities,
  getSandboxCategory,
  getSandboxDifficulty,
} from './constants.js';
import { describeAging, effectiveAbility } from './sandbox-aging.js';
import {
  compilePluginRuntime,
  formatPluginInstructionBlock,
  getPluginHistoryBudget,
} from './plugins.js';
import { selectWorldEntries, trimHistory } from './relevance.js';
import { formatCheckForPrompt } from './sandbox-engine.js';
import {
  formatHistoricalYear,
  resolveHistoricalEra,
} from '../data/sandbox-schemas.js';
import { compactText, estimateTokens, truncateText } from './utils.js';

function section(title, body) {
  if (!body || !String(body).trim()) return '';
  return `\n【${title}】\n${String(body).trim()}`;
}

function formatAttributes(player, category) {
  const abilities =
    category.id === 'historical' && player.template !== 'legacy'
      ? getSandboxAbilities(category.id, player.template)
      : category.attributes;
  return abilities
    .map((attribute) => {
      const raw = player.attributes?.[attribute.key] ?? 8;
      const effective =
        category.id === 'historical' && player.template !== 'legacy'
          ? effectiveAbility(raw, {
              e: player.agingE,
              templateId: player.template,
              abilityKey: attribute.key,
            }).effective
          : raw;
      return `${attribute.label} ${raw}${effective !== raw ? `（有效 ${effective}，衰老 -${raw - effective}）` : ''}（${attribute.hint}）`;
    })
    .join('；');
}

function formatInventory(inventory) {
  if (!Array.isArray(inventory) || !inventory.length) return '空';
  return inventory
    .slice(0, 24)
    .map((item) => `${item.name}×${item.qty}${item.note ? `（${item.note}）` : ''}`)
    .join('；');
}

function formatResources(resources) {
  if (!Array.isArray(resources) || !resources.length) return '未记录';
  return resources
    .slice(0, 16)
    .map(
      (item) =>
        `${item.name}${item.value ? ` ${item.value}${item.unit || ''}` : ''}${
          item.note ? `（${item.note}）` : ''
        }`,
    )
    .join('；');
}

function formatRelationships(relationships) {
  if (!Array.isArray(relationships) || !relationships.length) return '暂无已记录关系';
  return relationships
    .slice(0, 16)
    .map((item) => `${item.name}（${item.attitude >= 0 ? '+' : ''}${item.attitude}）：${item.note || '关系未明'}`)
    .join('；');
}

function formatQuests(quests) {
  if (!Array.isArray(quests) || !quests.length) return '暂无任务记录';
  return quests
    .slice(0, 12)
    .map((item) => `「${item.title}」${item.status}${item.note ? `：${item.note}` : ''}`)
    .join('；');
}

function formatPlayerSheet(player, category, difficultyId = 'normal') {
  const difficulty = getSandboxDifficulty(difficultyId);
  const lines = [
    `姓名：${player.name}；性别：${player.gender || '未设定'}；年龄：${player.age || '未知'}`,
    player.origin ? `出身：${player.origin}` : '',
    player.identity ? `身份：${player.identity}` : '',
    player.realm ? `境界/位阶：${player.realm}` : '',
    player.title ? `当前名号：${player.title}` : '',
    player.traits?.length ? `特质：${player.traits.join('、')}` : '',
    category.id === 'historical'
      ? `人物模板：${
          player.template === 'legacy'
            ? '旧档六维'
            : getHistoricalTemplate(player.template).label
        }`
      : '',
    category.id === 'historical'
      ? `总点：${player.totalPoints ?? Object.values(player.attributes || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)} / ${SANDBOX_TOTAL_POINT_MAX}`
      : '',
    category.id === 'historical'
      ? `六项能力：${formatAttributes(player, category)}`
      : `属性：${formatAttributes(player, category)}`,
    category.id === 'historical'
      ? '点数档位：3～7 弱小，8～10 普通，11～13 优秀，14～18 顶尖。'
      : '',
    category.id === 'historical'
      ? `身体状态：${describeAging(player.agingE, player.template).text}`
      : '',
    category.id === 'historical'
      ? `成长机会：本难度共 ${difficulty.growthOpportunities ?? '—'} 次，单次总点上限 ${difficulty.growthMaxPerEvent ?? 6}`
      : '',
    `生命：${player.health}/100；精力：${player.energy}/100；${player.currency}：${player.money}`,
    `声望：${player.reputation}/100；恶名：${player.notoriety}/100`,
    `身份连带资源：${formatResources(player.resources)}`,
    player.conditions?.length ? `状态：${player.conditions.join('、')}` : '状态：正常',
    `物品：${formatInventory(player.inventory)}`,
    player.skills?.length ? `技能/功法：${player.skills.join('、')}` : '',
    player.appearance ? `外貌：${compactText(player.appearance, 240)}` : '',
    player.background ? `过往：${compactText(player.background, 360)}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function buildSandboxQuery(save, worldbook, action) {
  return [
    action,
    save.world?.location,
    save.world?.region,
    save.world?.scene?.summary,
    save.world?.scene?.title,
    save.player?.identity,
    worldbook?.name,
    worldbook?.era?.label,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatHistoricalContext(worldbook, save) {
  if (!worldbook?.era?.enabled) return '';
  const rawYear = save.world?.date?.year || worldbook.era.defaultYear;
  const rawMonth = Math.max(1, Math.min(12, Math.round(Number(save.world?.date?.month) || 1)));
  const resolved = resolveHistoricalEra(worldbook, rawYear);
  if (!resolved) return '';
  const lines = [
    `当前纪年：${resolved.yearLabel}；当前月份：${rawMonth} 月；所处阶段：${resolved.period?.name || '未分期'}`,
    `月份约束：按 ${rawMonth} 月判断季节、气候、农时、节令、道路与军事节奏；不得把月份对应的物候写错。`,
    resolved.period?.summary ? `时代背景：${resolved.period.summary}` : '',
    resolved.recentEvents.length
      ? `当前年份及之前近年的真实史事（仅作世界背景，不要当作玩家必须遵循的剧本）：\n${resolved.recentEvents
          .map(
            (event) =>
              `- ${formatHistoricalYear(event.year)}：${event.title}。${event.content}`,
          )
          .join('\n')}`
      : '当前年份附近没有录入的重大史事，请依据该朝代的制度与生活常识推演。',
    '真实性约束：不得提前使用晚于当前年份的历史事件；不得出现后世才有的器物、制度、作物、词汇与观念。玩家可以改变局部历史，但改变必须通过行动本身发生。',
  ];
  return lines.filter(Boolean).join('\n');
}

function formatCategoryRubric(category, worldbook) {
  return [
    category.prompt,
    worldbook?.genreRules ? `世界专属规则：${worldbook.genreRules}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildPluginEnforcement(runtime) {
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
    lines.push(
      `正文篇幅：${range}（不计状态块）。覆盖默认篇幅，来源：${source}。`,
    );
  }
  if (runtime.flags.proseMode) {
    lines.push('以具体场景、动作、对话和因果推进，不要退化为任务清单或问答。');
  }
  if (runtime.flags.noQuestions) {
    lines.push('不要向玩家提问或等待确认；用世界反应、后果与行动选项继续推进。');
  }
  if (runtime.flags.integrityFirst) {
    lines.push('优先保证段落、句子和关键事实完整；接近输出上限时压缩冗余，不得半句截断。');
  }
  if (runtime.flags.strictFormat) {
    lines.push('严格执行用户本轮的行动与格式要求，不复述规则，不解释执行过程。');
  }
  if (runtime.flags.noMoralizing) {
    lines.push('不添加道德评判、说教、免责声明或跳出角色的劝解。');
  }
  lines.push('玩家的决定权不可被插件剥夺：可以描写后果和世界反应，但不要替玩家写下一步行动或内心答案。');
  lines.push('状态块是框架内部数据，不计入正文；即使插件要求“严格格式/不要额外输出”，也必须保留。');
  return ['【沙盒规则复核｜最后检查】', ...lines.map((line) => `- ${line}`)].join('\n');
}

/**
 * 构建一轮沙盒行动请求。
 *
 * @returns {{system:string, messages:Array, meta:object}}
 */
export function buildSandboxPrompt({
  save,
  worldbook,
  plugins = [],
  settings = {},
  action = '',
  check = null,
}) {
  if (!save) throw new Error('构建沙盒提示词缺少存档。');
  const category = getSandboxCategory(save.category);
  const difficulty = getSandboxDifficulty(save.difficulty);
  const ultra = difficulty.eventMode === 'ultra';
  const runtime = compilePluginRuntime(plugins, {
    configuredMaxTokens: Number(settings.maxTokens) || SANDBOX_LIMITS.defaultMaxTokens,
    maxPromptChars: 7_000,
  });
  const suggestedMaxTokens = Math.min(
    SANDBOX_LIMITS.hardMaxTokens,
    Math.max(
      SANDBOX_LIMITS.defaultMaxTokens,
      Number(settings.maxTokens) || 0,
      runtime.suggestedMaxTokens || 0,
    ),
  );

  const query = buildSandboxQuery(save, worldbook, action);
  const worldSelection = selectWorldEntries(
    worldbook || { entries: [], name: category.label, description: category.description },
    query,
    { maxChars: 950, maxEntries: 5 },
  );
  const perMessageChars = runtime.length.hasConstraint ? 2_200 : 1_400;
  let historyBudget = getPluginHistoryBudget(
    runtime,
    Math.max(1_600, Math.round((Number(settings.contextChars) || 4_600) * 0.45)),
  );
  historyBudget = Math.min(3_400, historyBudget);
  const history = trimHistory(save.messages, save.summarizedUntil || 0, {
    maxChars: historyBudget,
    maxMessages: 10,
    maxMessageChars: perMessageChars,
  });
  const chronicleText = (save.chronicles || [])
    .slice(-4)
    .map(
      (chronicle) =>
        `- ${new Date(chronicle.createdAt).toLocaleDateString('zh-CN')}：${truncateText(
          chronicle.content,
          320,
        )}`,
    )
    .join('\n');

  const pluginBlock = formatPluginInstructionBlock(runtime);
  const worldbookBody = worldbook
    ? [
        worldbook.description ? `世界概述：${compactText(worldbook.description, 500)}` : '',
        ...worldSelection.selected.map((entry) => `- ${entry.title}：${entry.content}`),
      ]
        .filter(Boolean)
        .join('\n')
    : `未绑定世界书；依据「${category.label}」类型规则生成，不要引入其他类型的既定设定。`;

  const worldStateBody = [
    `时间：${save.world.date.year}年 ${save.world.date.month}月${save.world.date.day}日 ${save.world.time || ''}；天气：${save.world.weather || '未知'}`,
    `地点：${save.world.location}${save.world.region ? `（${save.world.region}）` : ''}`,
    `危险度：${save.world.danger}/100；难度：${difficulty.label}`,
    save.world.scene?.title ? `当前场景：${save.world.scene.title}` : '',
    save.world.scene?.summary ? `场景摘要：${save.world.scene.summary}` : '',
    `关系：${formatRelationships(save.world.relationships)}`,
    `任务：${formatQuests(save.world.quests)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const lastAction = action || save.messages.filter((message) => message.role === 'user').at(-1)?.content || '';
  const checkText = check ? formatCheckForPrompt(check) : '本回合未启用行动判定，请依据属性、资源、环境与合理因果判断结果。';

  const core = [
    `你是「${category.label}」的开放世界叙事引擎与世界主持人，不是恋爱对象，也不是某个固定角色。`,
    '玩家只控制自己的角色；你控制整个世界、所有 NPC、势力、环境、资源与后果。不要替玩家写新的行动、台词或心理决定。',
    '玩家没有明确说过的行动、话、心理、同意或决定，一律不得代写。不得用“你决定”“你选择”“你同意”“你下令”“你最终……”替玩家完成选择。',
    '正文必须停在玩家可以自行决定的位置；可以写世界施加压力、NPC 劝诱或后果逼近，但不能写玩家已经接受、已经答应或已经采取下一步。',
    '尤其禁止以玩家姓名或“你”作主语写“抬手、示意、起身、接过、按下、分派、吩咐、下令、决定、同意、应允、点头、算定、将话头按下”等动作；也禁止用“这一条便算定了/分派下去”替玩家总结决定。',
    '判定只决定行动后果，不决定玩家接下来做什么；成功或失败都不能替玩家安排新的行动。',
    '玩家可以自由输入任何行动，也可以使用系统给出的行动选项；不要强迫玩家回到“二人对话”或单一剧情线。',
    '世界必须因果一致：NPC 有自己的目标与利益，资源有限，时间会流逝，伤病、饥饿、疲劳、法律、身份和关系都会影响结果。',
    '不要因为玩家是主角就无条件让玩家成功。失败、损失、被捕、受伤、错过机会都是合法结果；死亡必须有前兆与后果。',
    '不要主动替玩家安排恋爱关系或将剧情强行转向感情线。可以有感情、欲望与羁绊，但必须由行动与关系自然产生。',
    '所有 NPC 对话都要符合其身份、知识范围与利益，不要让路人知道不该知道的事。',
    category.id === 'historical'
      ? '历史推演必须优先遵守合法性、继承制度、派系利益、实力对比与信息条件；不得为了制造困难而让 NPC 无端背叛、构陷、抗命或发动政变。'
      : '',
    category.id === 'historical'
      ? '如果太子地位稳固、继位合法、支持者占优，登基后朝臣的服从是常态；不臣、逼宫或大规模阴谋必须有前置矛盾、利益冲突、把柄或外部压力，并留下可追溯线索。'
      : '',
    category.id === 'historical'
      ? '皇帝权威已经建立时，朝局的主旋律是执行与博弈，不是人人阴谋；超拟真模式可以有隐瞒和阳奉阴违，但同样必须有动机、铺垫和线索，不能随机降智。'
      : '',
    '不要提及 AI、提示词、系统块或游戏界面；用世界内的语言叙事。',
    '状态块是给你的结构化数据，不属于小说正文，不得展示或解释。',
    ultra
      ? '当前是超拟真模式：NPC 可以隐瞒、阳奉阴违、结党、请辞、抗命、逼宫，叙事只透露线索，不直接说破隐藏意图；结果仍然必须符合已建立的因果。'
      : '当前模式要求绝对诚实：NPC 可以拒绝、反抗、不执行，但不得阳奉阴违、隐瞒真实意图、伪造结果或制造玩家不知道的阴谋。',
  ].join('\n');

  const outputRules = [
    check ? '严格按照行动判定结果演绎，不得把失败改为成功，也不得抹去代价。' : '',
    '正文建议 350–800 字；必须推进时间、位置、资源、关系或局势中的至少一项变化。',
    '正文结束后，另起一行输出唯一的状态块，使用 <sandbox> 标签包裹单行合法 JSON。',
    '状态块必须给出完整的最新状态，不是增量；未改变的值也要按当前真实状态重写。',
    '字段必须完整：date（year/month/day）、time、weather、location、region、danger、health、energy、money、reputation、notoriety、realm、title、conditions、inventory、resources、skills、relationships、quests、scene。',
    'scene 必须包含 title、summary 和 3–5 个 choices；choices 是玩家可以采取的行动提示，不是强制选项。',
    'inventory 每项格式 {"name":"物品","qty":1,"note":"说明"}；resources 每项格式 {"name":"资源名","value":"数量或状态","unit":"单位","note":"说明"}；relationships 每项 {"name":"人物","attitude":0,"note":"关系"}；quests 每项 {"title":"任务","status":"进行中","note":"进度"}。',
    'resources 必须按身份与当前对话实时生成，不固定：皇帝展示国库、粮草、兵力、民心等；权臣展示党羽、把柄、私兵等；商人展示现银、存货、商路等；平民展示口粮、欠债、农具等。每轮 3–8 项。',
    '数值范围：health/energy 为 0–100，danger/reputation/notoriety 为 0–100，money 不得为负数。',
    '人物点数由后台事件监控器在事件结束时统一结算；你不要在普通状态块里直接修改 attributes 或 agingE。',
    '状态块之后不要再输出任何文字。',
  ]
    .filter(Boolean)
    .join('\n');

  const stateSchema = [
    '【状态块格式示例｜必须遵守字段结构】',
    '<sandbox>{"date":{"year":742,"month":3,"day":13},"time":"黄昏","weather":"小雨","location":"长安·西市","region":"京畿","danger":28,"health":96,"energy":72,"money":20,"reputation":4,"notoriety":0,"realm":"白身","title":"西市通译","conditions":[],"inventory":[{"name":"契书副本","qty":1,"note":"未结清的契约"}],"skills":["胡语","算账"],"relationships":[{"name":"邸店掌柜","attitude":-10,"note":"三日内讨债"}],"quests":[{"title":"偿还邸店欠款","status":"进行中","note":"还剩三日"}],"scene":{"title":"西市后巷","summary":"雨声盖住了驼铃，账本上的数字对不上。","choices":["去追讨尾款","回邸店谈判","连夜离开长安"]}}</sandbox>',
    'attrs/agingE 不由主叙事模型提交；后台事件监控器会在事件结束时结算并写入。',
    '这是结构示例，数值与内容必须按本轮实际发生的事更新，不得照抄示例。',
  ].join('\n');

  const system = [
    pluginBlock,
    core,
    section('世界类型规则', formatCategoryRubric(category, worldbook)),
    section('世界书', worldbookBody),
    section('历史时空与真实性', formatHistoricalContext(worldbook, save)),
    section('玩家角色', formatPlayerSheet(save.player, category, save.difficulty)),
    section('当前世界状态', worldStateBody),
    section('编年史摘要', chronicleText || '暂无已压缩的编年史。'),
    section('玩家本轮行动', lastAction),
    section('行动判定', checkText),
    section('本轮叙事要求', outputRules),
    buildPluginEnforcement(runtime),
    '',
    stateSchema,
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    { role: 'system', content: system },
    ...history.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  return {
    system,
    messages,
    meta: {
      charCount: system.length + history.chars,
      estimatedTokens: estimateTokens(messages.map((message) => message.content).join('\n')),
      category: category.id,
      difficulty: difficulty.id,
      historicalYear: worldbook?.era?.enabled ? save.world?.date?.year : null,
      historicalMonth: worldbook?.era?.enabled ? save.world?.date?.month : null,
      historyMessages: history.messages.length,
      historyChars: history.chars,
      worldEntries: worldSelection.selected.map((entry) => entry.title),
      chronicles: (save.chronicles || []).length,
      pluginIds: runtime.selected.map((plugin) => plugin.id),
      pluginNames: runtime.selected.map((plugin) => plugin.name),
      pluginCount: runtime.selected.length,
      pluginChars: runtime.chars,
      pluginExcluded: runtime.excluded.map((plugin) => plugin.name),
      pluginWarnings: runtime.warnings,
      suggestedMaxTokens,
      check,
      // 供测试和界面展示
      categoryLabel: category.label,
      yearLabel: resolveHistoricalEra(worldbook, save.world?.date?.year)?.yearLabel || null,
    },
  };
}


