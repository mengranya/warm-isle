/**
 * 全局常量：模型目录、视觉选项、存储键与产品信息。
 * 这个文件不依赖 DOM，Node 测试也可以直接导入。
 */

export const APP_NAME = '暖屿';
export const APP_NAME_EN = 'Warm Isle';
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;

export const STORAGE = Object.freeze({
  dbName: 'warm-isle-db',
  dbVersion: 1,
  storeName: 'kv',
  stateKey: 'state',
  backupKey: 'warm-isle:v1:backup',
  sessionKeysKey: 'warm-isle:v1:session-keys',
  vaultDbName: 'warm-isle-vault',
  vaultStoreName: 'keys',
});

export const LIMITS = Object.freeze({
  maxLogs: 400,
  maxMessages: 3000,
  maxArchives: 80,
  maxStatusNotes: 1000,
  maxInputChars: 4000,
  maxPersonaName: 40,
  maxImportedItems: 100,
  contextChars: 4600,
});

export const PROVIDERS = Object.freeze({
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    accent: '#5f8f85',
    description: '中文角色扮演性价比高，流式响应稳定。',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', note: '日常对话 · 推荐' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', note: '深度推理 · 较慢' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    accent: '#6b8f6d',
    description: '角色演绎细腻，支持 GPT-4 系列。',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: '轻快 · 省 token' },
      { id: 'gpt-4o', label: 'GPT-4o', note: '细腻 · 均衡' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', note: '经典 GPT-4' },
      { id: 'gpt-4.1', label: 'GPT-4.1', note: '长上下文' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', note: '高性价比' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude',
    shortLabel: 'Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    accent: '#b27a58',
    description: '长文与情绪层次出色。',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', note: '推荐' },
      { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', note: '均衡' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', note: '轻快' },
    ],
  },
  custom: {
    id: 'custom',
    label: '自定义接口',
    shortLabel: '自定义',
    kind: 'openai',
    baseUrl: '',
    keyEnv: 'CUSTOM_API_KEY',
    accent: '#8a7b99',
    description: '任何兼容 OpenAI Chat Completions 的接口。',
    models: [],
  },
});

export const PROVIDER_LIST = Object.freeze(Object.values(PROVIDERS));

export const DIALOGUE_ANIMATIONS = Object.freeze([
  { id: 'none', label: '自然平静', hint: '无额外动画' },
  { id: 'bounce', label: '轻轻跳动', hint: '回复入场时轻弹一下' },
  { id: 'gradient', label: '彩色流光', hint: '渐变文字缓慢流动' },
  { id: 'glow', label: '暖光呼吸', hint: '柔和光晕明暗变化' },
]);

export const DEFAULT_EMOJIS = Object.freeze(['🌷', '☕', '🌙', '✨', '🫧', '🍂']);

export const NAV_ITEMS = Object.freeze([
  { route: 'chat', label: '对话', icon: 'chat' },
  { route: 'archives', label: '存档', icon: 'archive' },
  { route: 'personas', label: '人格', icon: 'persona' },
  { route: 'worldbooks', label: '世界书', icon: 'book' },
  { route: 'plugins', label: '插件', icon: 'plug' },
  { route: 'journal', label: '运行日记', icon: 'journal' },
  { route: 'settings', label: '设置', icon: 'settings' },
]);

export const ROUTE_META = Object.freeze({
  chat: { title: '对话', label: '对话' },
  archives: { title: '我的存档', label: '存档' },
  'archives/new': { title: '创建存档', label: '存档 / 新建' },
  personas: { title: '人格工坊', label: '人格' },
  'personas/new': { title: '创建人格', label: '人格 / 新建' },
  worldbooks: { title: '世界书', label: '世界书' },
  'worldbooks/new': { title: '创建世界书', label: '世界书 / 新建' },
  plugins: { title: '插件', label: '插件' },
  journal: { title: '运行日记', label: '运行日记' },
  settings: { title: '设置', label: '设置' },
});

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: '',
  temperature: 0.9,
  maxTokens: 800,
  stream: true,
  useServerKey: true,
  rememberKeys: true,
  demoMode: false,
  contextChars: LIMITS.contextChars,
});

export const STORY_SEEDS = Object.freeze([
  '窗外的雨刚停，空气里有潮湿的泥土味。',
  '街角的灯忽明忽暗，像是有什么话还没说完。',
  '今天比往常安静，连钟表走动的声音都格外清楚。',
  '一杯温热的饮品被推到面前，杯壁还带着水汽。',
  '风把门吹开了一条缝，远处传来模糊的音乐。',
]);

export const STATUS_FIELDS = Object.freeze([
  { key: 'health', label: '身体状况', icon: 'heart', max: 160 },
  { key: 'outfit', label: '当前衣着', icon: 'shirt', max: 180 },
  { key: 'environment', label: '所处环境', icon: 'pin', max: 180 },
  { key: 'action', label: '正在进行的动作', icon: 'motion', max: 180 },
  { key: 'notes', label: '场景补述', icon: 'spark', max: LIMITS.maxStatusNotes },
]);

/* ------------------------------------------------------------------ */
/* 沙盒世界模式（与恋爱对话模式完全独立）                              */
/* ------------------------------------------------------------------ */

export const SANDBOX_CATEGORIES = Object.freeze([
  {
    id: 'xianxia',
    label: '修仙大世界',
    shortLabel: '修仙',
    icon: 'spark',
    accent: '#6e907f',
    description: '宗门、散修、妖兽、洞天与天劫。境界森严，资源稀缺，因果会真实地回到你身上。',
    prompt:
      '这是一个有秩序、有代价的修仙世界。境界差距真实存在，灵石、丹药、功法与寿元都是稀缺资源；宗门有利益与门规，散修有生存压力。不要写成无所不能的爽文。',
    currency: '灵石',
    attributes: [
      { key: 'body', label: '根骨', hint: '炼体、抗伤、近身搏杀' },
      { key: 'agility', label: '身法', hint: '轻身、闪避、潜行' },
      { key: 'mind', label: '悟性', hint: '参悟功法、阵法、丹道' },
      { key: 'presence', label: '神识', hint: '察觉、威压、神魂交锋' },
      { key: 'will', label: '道心', hint: '抵抗心魔、承受痛苦' },
      { key: 'luck', label: '机缘', hint: '奇遇、气运、临场运气' },
    ],
  },
  {
    id: 'historical',
    label: '真实历史古朝代',
    shortLabel: '历史',
    icon: 'scroll',
    accent: '#b47c4f',
    description: '选择真实朝代与年份，进入有制度、物价、礼法与历史因果的古代中国。没有现代科技与超自然外挂。',
    prompt:
      '这是一个以真实中国古代社会为底的历史世界。严格遵守所选朝代与年份的制度、礼法、技术条件、物价、交通、饮食、称谓与权力结构；不得出现后世才有的器物、制度、词汇或观念。玩家可以改变局部历史，但必须承担真实的因果、身份限制与社会代价。',
    currency: '两银',
    attributes: [
      { key: 'body', label: '体魄', hint: '体力、耐性、搏斗' },
      { key: 'agility', label: '敏捷', hint: '身手、骑射、潜行' },
      { key: 'mind', label: '谋略', hint: '经义、谋划、察人' },
      { key: 'presence', label: '声望', hint: '门第、谈吐、人脉' },
      { key: 'will', label: '意志', hint: '忍耐、胆识、守节' },
      { key: 'luck', label: '气运', hint: '机遇、巧合、命运' },
    ],
  },
  {
    id: 'western_fantasy',
    label: '西方玄幻',
    shortLabel: '西幻',
    icon: 'castle',
    accent: '#7b7393',
    description: '王国、教会、行会、旧神与低魔诅咒。剑与魔法不是万能，政治、信仰和代价才是世界的骨架。',
    prompt:
      '这是一个低魔、重政治与生存的西方奇幻世界。魔法有明确代价和禁忌，教会、王权、行会与地方领主互相制衡；旅行、伤病、补给与情报都需要成本。不要让魔法变成无代价的万能工具，也不要写成现代价值观下的无脑冒险。',
    currency: '银币',
    attributes: [
      { key: 'body', label: '体魄', hint: '力量、耐力、近战' },
      { key: 'agility', label: '敏捷', hint: '闪避、潜行、手上功夫' },
      { key: 'mind', label: '学识', hint: '文书、秘术、战术' },
      { key: 'presence', label: '魅力', hint: '交涉、领导、伪装' },
      { key: 'will', label: '意志', hint: '抗压、抗咒、信念' },
      { key: 'luck', label: '幸运', hint: '命运、偶然、险境转机' },
    ],
  },
]);

export const SANDBOX_ATTRIBUTE_KEYS = Object.freeze([
  'body',
  'agility',
  'mind',
  'presence',
  'will',
  'luck',
]);

/**
 * 历史类沙盒的五种人物模板。
 * 六项能力各自独立，不再使用修仙/西幻的通用六维。
 */
export const SANDBOX_HISTORICAL_TEMPLATES = Object.freeze([
  {
    id: 'civil',
    label: '文臣',
    shortLabel: '文臣',
    description: '以政务、谋略、识人与名望立身，适合朝廷、地方官署与使节。',
    abilities: [
      { key: 'governance', label: '政务行政', hint: '治理、财政、律令与执行', keywords: ['治理', '政务', '行政', '财政', '律令', '公文', '赈灾', '税', '吏治', '政令'] },
      { key: 'strategy', label: '谋略机断', hint: '布局、判断、临机决断', keywords: ['谋略', '布局', '判断', '决策', '计策', '筹划', '分析', '推断', '机断'] },
      { key: 'personnel', label: '识人用人', hint: '察人、举荐、驭下', keywords: ['识人', '用人', '举荐', '察人', '提拔', '门生', '僚属', '人才'] },
      { key: 'diplomacy', label: '外交辞令', hint: '谈判、周旋、出使', keywords: ['外交', '谈判', '辞令', '出使', '交涉', '说服', '盟约', '周旋'] },
      { key: 'culture', label: '文化学识', hint: '经义、文章、典章', keywords: ['经义', '文章', '读书', '学识', '典籍', '科举', '修史', '礼制'] },
      { key: 'virtue', label: '名望德行', hint: '清议、声望、人心', keywords: ['名望', '德行', '清议', '声望', '人心', '口碑', '气节'] },
    ],
  },
  {
    id: 'military',
    label: '武将',
    shortLabel: '武将',
    description: '以统兵、武艺、战术与军务立身，适合边镇、军府与乱世。',
    abilities: [
      { key: 'command', label: '统兵作战', hint: '大军指挥、战阵与士气', keywords: ['统兵', '指挥', '大军', '战阵', '出战', '军队', '攻城', '列阵'] },
      { key: 'martial', label: '武艺勇武', hint: '单挑、近战、骑射', keywords: ['武艺', '单挑', '近战', '骑射', '搏斗', '杀', '刀', '枪', '箭'] },
      { key: 'tactics', label: '战术谋略', hint: '行军、伏击、地利', keywords: ['战术', '谋略', '伏击', '行军', '地利', '奇袭', '布阵', '粮道'] },
      { key: 'training', label: '治军练兵', hint: '军纪、训练、部曲', keywords: ['治军', '练兵', '军纪', '训练', '部曲', '亲兵', '军法'] },
      { key: 'logistics', label: '军务后勤', hint: '粮草、军械、转运', keywords: ['后勤', '粮草', '军械', '转运', '补给', '军饷', '辎重'] },
      { key: 'charisma', label: '威望魅力', hint: '将威、号召、服众', keywords: ['威望', '魅力', '号召', '服众', '军心', '威吓', '演讲'] },
    ],
  },
  {
    id: 'emperor',
    label: '皇帝',
    shortLabel: '皇帝',
    description: '以治国、统帅、权谋与用人立身，适合在位君主或开国之君。',
    abilities: [
      { key: 'statecraft', label: '治国理政', hint: '制度、财政、民生', keywords: ['治国', '理政', '制度', '财政', '民生', '朝政', '改革', '赈灾'] },
      { key: 'command', label: '军事统帅', hint: '亲征、调将、战略', keywords: ['军事', '统帅', '亲征', '调将', '战略', '出兵', '军权'] },
      { key: 'intrigue', label: '权谋心术', hint: '制衡、密谋、宫斗', keywords: ['权谋', '制衡', '密谋', '宫斗', '心术', '猜忌', '布局'] },
      { key: 'personnel', label: '用人驭下', hint: '任相、驭将、党争', keywords: ['用人', '驭下', '任相', '驭将', '党争', '举荐', '罢免'] },
      { key: 'culture', label: '文化学识', hint: '礼制、文教、正统', keywords: ['文化', '学识', '礼制', '文教', '正统', '经义', '修史'] },
      { key: 'charisma', label: '威望魅力', hint: '威仪、民心、号召', keywords: ['威望', '魅力', '威仪', '民心', '号召', '声望', '服众'] },
    ],
  },
  {
    id: 'merchant',
    label: '商人',
    shortLabel: '商人',
    description: '以经商、理财、鉴货与人脉立身，适合市镇、商路与海贸。',
    abilities: [
      { key: 'business', label: '经商谋略', hint: '商机、定价、竞争', keywords: ['经商', '商机', '定价', '买卖', '竞争', '囤货', '商路'] },
      { key: 'finance', label: '理财核算', hint: '账目、资金、成本', keywords: ['理财', '核算', '账目', '资金', '成本', '利润', '银钱'] },
      { key: 'appraisal', label: '货物鉴识', hint: '辨货、估价、真伪', keywords: ['鉴识', '辨货', '估价', '真伪', '货物', '成色', '茶', '丝'] },
      { key: 'network', label: '交际人脉', hint: '行会、客户、官商', keywords: ['交际', '人脉', '行会', '客户', '官商', '应酬', '结交'] },
      { key: 'management', label: '组织管理', hint: '商队、伙计、分号', keywords: ['管理', '组织', '商队', '伙计', '分号', '调度', '掌柜'] },
      { key: 'credit', label: '信誉名望', hint: '信用、口碑、契约', keywords: ['信誉', '名望', '信用', '口碑', '契约', '诚信', '招牌'] },
    ],
  },
  {
    id: 'commoner',
    label: '平民',
    shortLabel: '平民',
    description: '以生计、持家、手艺与人情立身，适合市井、乡村与流民。',
    abilities: [
      { key: 'livelihood', label: '生计营生', hint: '农事、做工、谋生', keywords: ['生计', '营生', '农事', '做工', '谋生', '种地', '打零工'] },
      { key: 'household', label: '持家理财', hint: '家用、积蓄、度日', keywords: ['持家', '理财', '家用', '积蓄', '度日', '省钱', '买粮'] },
      { key: 'craft', label: '手艺劳作', hint: '匠作、耕作、体力活', keywords: ['手艺', '劳作', '匠作', '耕作', '编织', '木工', '打铁'] },
      { key: 'social', label: '人情世故', hint: '邻里、宗族、消息', keywords: ['人情', '世故', '邻里', '宗族', '消息', '求人', '帮忙'] },
      { key: 'endurance', label: '体魄韧劲', hint: '体力、耐性、抗病', keywords: ['体魄', '韧劲', '体力', '耐性', '抗病', '挑担', '赶路'] },
      { key: 'localFame', label: '乡里名望', hint: '口碑、面子、乡望', keywords: ['乡里', '名望', '口碑', '面子', '乡望', '声望'] },
    ],
  },
]);

export const SANDBOX_TOTAL_POINT_MAX = 108;

export const SANDBOX_POINT_BANDS = Object.freeze([
  { min: 3, max: 7, id: 'weak', label: '弱小', hint: '3～7 点：明显短板' },
  { min: 8, max: 10, id: 'normal', label: '普通', hint: '8～10 点：普通常人' },
  { min: 11, max: 13, id: 'excellent', label: '优秀', hint: '11～13 点：优秀专长' },
  { min: 14, max: 18, id: 'top', label: '顶尖', hint: '14～18 点：顶尖/传奇' },
]);

export function getHistoricalTemplate(templateId) {
  return (
    SANDBOX_HISTORICAL_TEMPLATES.find((template) => template.id === templateId) ||
    SANDBOX_HISTORICAL_TEMPLATES[4]
  );
}

export function getSandboxAbilities(categoryId, templateId) {
  if (categoryId === 'historical') {
    return getHistoricalTemplate(templateId).abilities;
  }
  return getSandboxCategory(categoryId).attributes;
}

export function getSandboxAbilityKeys(categoryId, templateId) {
  return getSandboxAbilities(categoryId, templateId).map((ability) => ability.key);
}

export function getPointBand(value) {
  const point = Number(value) || 0;
  return SANDBOX_POINT_BANDS.find((band) => point >= band.min && point <= band.max) || SANDBOX_POINT_BANDS[0];
}

const OVERALL_LABELS = {
  civil: ['庸劣之臣', '弱臣', '中下之臣', '中平文臣', '中上干臣', '贤臣/权臣', '名臣', '传奇名臣'],
  military: ['败军之将', '弱将', '中下之将', '中平之将', '中上良将', '名将/军阀之资', '杰出名将', '兵家传奇'],
  emperor: ['昏暴/傀儡之主', '弱主/庸主', '中下之主', '中平之主', '中上之主/明君之资', '英主/雄主', '明君英主', '千古一帝'],
  merchant: ['败家商贾', '小贩/弱商号', '中下商人', '中平商人', '中上良商', '一方巨商', '商界巨擘', '商圣'],
  commoner: ['流民破户', '贫弱百姓', '中下百姓', '中平百姓', '殷实能人', '乡里能人/豪民', '一方乡贤/大匠', '乡野传奇'],
};

export function getHistoricalOverallLabel(total, templateId) {
  const value = Math.max(0, Math.min(108, Number(total) || 0));
  const index =
    value <= 35 ? 0 : value <= 47 ? 1 : value <= 53 ? 2 : value <= 59 ? 3 : value <= 65 ? 4 : value <= 75 ? 5 : value <= 90 ? 6 : 7;
  const labels = OVERALL_LABELS[getHistoricalTemplate(templateId).id] || OVERALL_LABELS.commoner;
  return labels[index];
}

export const SANDBOX_DIFFICULTIES = Object.freeze([
  {
    id: 'easy',
    label: '闲游',
    hint: '判定更宽松，重伤与死亡概率较低。绝对诚实：NPC 可以拒绝或反抗，但不会隐瞒真实意图、阳奉阴违或伪造结果。',
    dcModifier: -3,
    budget: 60,
    growthOpportunities: 18,
    growthMaxPerEvent: 6,
    eventMode: 'honest',
  },
  {
    id: 'normal',
    label: '标准',
    hint: '真实后果，资源需要精打细算。绝对诚实：NPC 可以拒绝、反抗或不执行，但不会阳奉阴违、隐瞒真实意图或伪造结果。',
    dcModifier: 0,
    budget: 54,
    growthOpportunities: 15,
    growthMaxPerEvent: 6,
    eventMode: 'honest',
  },
  {
    id: 'ultra',
    label: '超拟真',
    hint: '点数分配与标准相同。NPC 会隐瞒、阳奉阴违、结党、请辞、抗命甚至逼宫；叙事只给线索，真实意图需要你自己判断。',
    dcModifier: 0,
    budget: 54,
    growthOpportunities: 15,
    growthMaxPerEvent: 6,
    eventMode: 'ultra',
  },
  {
    id: 'hard',
    label: '残酷',
    hint: '失败代价高，缺衣少食、受伤与死亡都真实存在。绝对诚实：NPC 可以拒绝或反抗，但不会阴谋欺瞒或伪造结果。',
    dcModifier: 4,
    budget: 48,
    growthOpportunities: 12,
    growthMaxPerEvent: 6,
    eventMode: 'honest',
  },
]);

export const SANDBOX_LIMITS = Object.freeze({
  maxWorldbooks: 80,
  maxSaves: 60,
  maxMessages: 3000,
  maxChronicles: 200,
  maxActionChars: 2000,
  defaultMaxTokens: 1_600,
  hardMaxTokens: 4_096,
  maxAttributes: 18,
  minAttributes: 3,
});

export const SANDBOX_NAV_ITEMS = Object.freeze([
  { route: 'sandbox', label: '沙盒大厅', icon: 'compass' },
  { route: 'sandbox/worldbooks', label: '沙盒世界书', icon: 'scroll' },
  { route: 'sandbox/plugins', label: '沙盒规则', icon: 'plug' },
]);

export const SANDBOX_ROUTE_META = Object.freeze({
  sandbox: { title: '沙盒世界', label: '沙盒 / 大厅' },
  'sandbox/new': { title: '创建沙盒世界', label: '沙盒 / 新建' },
  'sandbox/play': { title: '沙盒历险', label: '沙盒 / 进行中' },
  'sandbox/worldbooks': { title: '沙盒世界书', label: '沙盒 / 世界书' },
  'sandbox/worldbooks/new': { title: '创建沙盒世界书', label: '沙盒 / 世界书' },
  'sandbox/plugins': { title: '沙盒规则插件', label: '沙盒 / 规则' },
});

export function getSandboxCategory(categoryId) {
  return (
    SANDBOX_CATEGORIES.find((category) => category.id === categoryId) ||
    SANDBOX_CATEGORIES[0]
  );
}

export function getSandboxDifficulty(difficultyId) {
  return (
    SANDBOX_DIFFICULTIES.find((difficulty) => difficulty.id === difficultyId) ||
    SANDBOX_DIFFICULTIES[1]
  );
}

export function getProvider(providerId) {
  return PROVIDERS[providerId] || PROVIDERS.deepseek;
}

export function getModelMeta(providerId, modelId) {
  const provider = getProvider(providerId);
  return provider.models.find((model) => model.id === modelId) || null;
}
