/**
 * 沙盒世界预设。
 *
 * 这些数据与恋爱对话模式的「人格 / 世界书 / 插件」完全分离，
 * 只用于 sandboxSaves 与 sandboxWorldbooks。
 */

import { HISTORICAL_DYNASTY_BOOKS } from './sandbox-dynasties.js';
import { MODERN_HISTORICAL_BOOKS } from './sandbox-modern.js';
import { attachSpecialOpenings } from './sandbox-special-openings.js';

const FIXED_TIME = '2026-01-01T08:00:00.000Z';

export const BUILTIN_SANDBOX_WORLDBOOKS = [
  {
    schemaVersion: 1,
    kind: 'warm-isle.sandbox-worldbook',
    id: 'sb_world_jiuzhou',
    name: '九洲仙途',
    category: 'xianxia',
    description:
      '九洲灵机渐衰，七大仙宗与世俗王朝共治天下。修士以灵石、丹药和寿元换取力量，每一次越阶都要付出代价。',
    tags: ['修仙', '宗门', '资源稀缺', '高自由度'],
    builtin: true,
    createdAt: FIXED_TIME,
    era: null,
    defaults: {
      currency: '灵石',
      startingMoney: 18,
      location: '云海坊市',
      date: { year: 3271, month: 8, day: 12 },
      time: '午时',
      weather: '多云',
    },
    genreRules:
      '境界从炼气、筑基、金丹、元婴、化神、炼虚、合体到大乘，每境差距真实存在。低阶修士不能随手击败高阶修士；丹药、法器、符箓都有成本与来源。宗门有门规、派系与利益，不围绕玩家旋转。',
    entries: [
      {
        id: 'sb_jiuzhou_realm',
        title: '境界与寿元',
        keywords: ['境界', '炼气', '筑基', '金丹', '元婴', '寿元', '突破'],
        content:
          '炼气期寿元约百余年，筑基后可延至两百年，金丹约五百年，元婴约千年。每次突破都有失败风险：灵气驳杂、心魔、根基损伤、外敌窥伺。越阶战斗极难，除非有阵法、地利、重宝或多人配合。',
        pinned: true,
        priority: 100,
      },
      {
        id: 'sb_jiuzhou_sects',
        title: '宗门与势力',
        keywords: ['宗门', '太玄剑宗', '丹霞谷', '万宝楼', '血河教', '镇魔司'],
        content:
          '太玄剑宗重剑道与门规，内门竞争激烈；丹霞谷垄断高阶丹药；万宝楼经营拍卖与情报；血河教被正道通缉却渗透各地；大乾王朝设镇魔司管理修士与凡俗边界。没有绝对正邪，只有立场与代价。',
        pinned: true,
        priority: 95,
      },
      {
        id: 'sb_jiuzhou_resources',
        title: '资源与代价',
        keywords: ['灵石', '丹药', '功法', '法器', '天劫', '因果', '坊市'],
        content:
          '下品灵石是日常货币，中品、上品灵石有价无市。丹药服用过多会产生丹毒；功法品阶决定上限；法器需要温养；杀夺资源会结下因果。坊市交易受万宝楼抽成，黑市价格更高但风险更大。',
        pinned: false,
        priority: 85,
      },
      {
        id: 'sb_jiuzhou_world',
        title: '九洲地理与禁忌',
        keywords: ['九洲', '归墟', '禁地', '秘境', '妖兽', '灵脉'],
        content:
          '中洲最繁华，东荒多妖兽，南疆蛊修横行，西漠佛国与沙盗并立，北原冰原下埋着上古战场。归墟是灵气不存的深海裂隙，进入者少有生还。秘境通常在特定天象时开启，名额由宗门与王朝分配。',
        pinned: false,
        priority: 80,
      },
    ],
    scenarios: [
      {
        id: 'sb_scene_village',
        title: '山村少年的仙缘',
        description: '青石村少年，灵根未明。仙门测灵将至，而村外妖兽最近频繁出没。',
        location: '东荒·青石村',
        opening:
          '暮色压在青石村上，远处山雾里传来一声不像野兽的低鸣。{player}刚把最后一担柴放进门廊，村长便敲响了铜锣：明日辰时，太玄剑宗的外门执事会来测灵。',
        choices: ['去村口看看守夜的猎户', '回家准备明日的测灵', '独自循着山雾中的声音走去'],
        inventory: [
          { name: '柴刀', qty: 1, note: '开了刃的旧柴刀' },
          { name: '粗布行囊', qty: 1, note: '内有两块干饼' },
        ],
        money: 3,
        realm: '凡人',
        titleLabel: '青石村村民',
      },
      {
        id: 'sb_scene_sect',
        title: '外门弟子的困局',
        description: '太玄剑宗外门弟子，入门三年仍未筑基，宗门月例即将削减。',
        location: '太玄剑宗·外门',
        opening:
          '晨钟刚过，执事堂的告示前已围满外门弟子。{player}挤进人群，看见自己的名字被写在“减例”一栏。三年未筑基，宗门不会再无条件供养；而山下最近出现了一条失控的灵脉。',
        choices: ['去执事堂争辩', '接下山下灵脉的探查任务', '找相熟的同门借一笔灵石'],
        inventory: [
          { name: '外门弟子令牌', qty: 1, note: '出入山门与领取月例之用' },
          { name: '铁剑', qty: 1, note: '宗门制式法器，勉强能引一丝剑气' },
        ],
        money: 12,
        realm: '炼气七层',
        titleLabel: '太玄剑宗外门弟子',
      },
      {
        id: 'sb_scene_market',
        title: '坊市散修',
        description: '无门无派，靠替人跑腿和倒卖灵材为生。今天万宝楼有一场不寻常的拍卖。',
        location: '中洲·云海坊市',
        opening:
          '云海坊市被阵法罩在细雨之外。{player}蹲在檐下啃一张凉饼，怀里的传讯符忽然发热：万宝楼今晚临时加拍一件“来历不明”的筑基丹。身后的巷口，两个戴斗笠的人已经盯了你很久。',
        choices: ['先进万宝楼探探消息', '绕进黑市打听拍卖品来历', '装作没看见，离开坊市'],
        inventory: [
          { name: '下品灵石', qty: 18, note: '散修的全部积蓄' },
          { name: '低阶传讯符', qty: 2, note: '可短距离传一句话' },
        ],
        money: 18,
        realm: '炼气五层',
        titleLabel: '无门散修',
      },
    ],
  },

  {
    schemaVersion: 1,
    kind: 'warm-isle.sandbox-worldbook',
    id: 'sb_world_tang',
    name: '大唐',
    category: 'historical',
    description:
      '从初唐到唐末，横跨二百八十九年。长安、洛阳、藩镇、科举、丝路与边患共同构成一个开放而动荡的帝国；开局年份决定你遇见的是哪一段唐。',
    tags: ['唐朝', '全唐', '长安', '真实历史', '朝堂江湖'],
    builtin: true,
    createdAt: FIXED_TIME,
    era: {
      dynasty: '唐',
      label: '大唐',
      startYear: 618,
      endYear: 907,
      defaultYear: 742,
      calendar: '公元',
      periods: [
        { name: '初唐', startYear: 618, endYear: 626, summary: '唐朝建立，统一战争尚未结束，制度与权力格局仍在形成。' },
        { name: '贞观', startYear: 627, endYear: 649, summary: '太宗整饬吏治，府兵强盛，四夷来朝，社会秩序恢复。' },
        { name: '永徽至武周', startYear: 650, endYear: 712, summary: '高宗、武则天相继执政，科举与官僚制度扩张，武周代唐，政局屡变。' },
        { name: '开元', startYear: 713, endYear: 741, summary: '玄宗前期政治清明、经济繁荣，长安人口稠密，西域商路畅通。' },
        { name: '天宝', startYear: 742, endYear: 756, summary: '表面极盛，边镇节度使权势膨胀，朝堂奢靡，社会矛盾累积。' },
        { name: '中晚唐', startYear: 757, endYear: 907, summary: '安史之乱后藩镇割据、宦官专权、赋税改革，长安屡经战火。' },
      ],
      events: [
        { year: 626, title: '玄武门之变', content: '李世民在玄武门发动政变，随后即位，是为唐太宗。' },
        { year: 630, title: '灭东突厥', content: '唐军击灭东突厥，北方部族尊太宗为天可汗。' },
        { year: 641, title: '文成公主入藏', content: '唐与吐蕃和亲，文成公主入藏，汉藏交流加深。' },
        { year: 690, title: '武周建立', content: '武则天称帝，改唐为周，洛阳成为神都。' },
        { year: 713, title: '开元元年', content: '玄宗即位后整顿朝政，开元盛世开始。' },
        { year: 755, title: '安史之乱', content: '安禄山在范阳起兵，次年攻入洛阳、长安，唐廷由盛转衰。' },
        { year: 780, title: '两税法', content: '杨炎推行两税法，以资产和田亩为征税基础，改变租庸调体系。' },
        { year: 845, title: '会昌灭佛', content: '武宗大规模拆毁寺院、没收寺产，佛教势力受挫。' },
        { year: 875, title: '黄巢起事', content: '盐商黄巢起兵，数年后攻入长安，唐末大乱。' },
      ],
    },
    defaults: {
      currency: '贯',
      startingMoney: 24,
      location: '长安·西市',
      date: { year: 742, month: 3, day: 12 },
      time: '午后',
      weather: '晴',
    },
    genreRules:
      '严格遵守唐代制度与生活条件：里坊制与宵禁、府兵与募兵、科举与门荫、胡商与丝路、坊市与邸店、铜钱与绢帛并用。不得出现火药武器、现代官僚制度、白话网络用语或后世才有的作物与观念。性别、门第、户籍与身份会限制行动。',
    entries: [
      {
        id: 'sb_tang_politics',
        title: '朝堂与制度',
        keywords: ['朝堂', '皇帝', '宰相', '节度使', '科举', '门第', '玄宗'],
        content:
          '唐前期实行三省六部、府兵与均田制，科举尚与门荫并行。开元后节度使掌握边镇军政财权，朝廷倚重宦官与外戚。官员品级、服饰颜色、称谓与议事程序都有严格规定，平民越级言事需要付出代价。',
        pinned: true,
        priority: 100,
      },
      {
        id: 'sb_tang_changan',
        title: '长安城',
        keywords: ['长安', '西市', '东市', '坊', '宵禁', '大明宫', '曲江'],
        content:
          '长安以朱雀大街为中轴，108坊整齐排列，东市西市贸易繁盛。城内实行宵禁，暮鼓后坊门关闭，夜行需有许可。西市多胡商、酒肆与邸店；曲江、大慈恩寺、平康坊各有不同的身份与风险。',
        pinned: true,
        priority: 95,
      },
      {
        id: 'sb_tang_society',
        title: '衣食住行与物价',
        keywords: ['物价', '米', '绢', '胡饼', '酒', '驿', '路程'],
        content:
          '普通人家以粟米、麦饼、蔬菜为主，肉食不常有；胡饼、葡萄酒、酪浆在长安盛行。铜钱与绢帛都可用于大额交易。普通人日行二三十里，骑马可更快；出远门需要路引、干粮与住宿钱。',
        pinned: false,
        priority: 85,
      },
      {
        id: 'sb_tang_frontier',
        title: '边镇与异域',
        keywords: ['边关', '吐蕃', '突厥', '西域', '胡商', '商队', '战事'],
        content:
          '唐与吐蕃、突厥、契丹、南诏关系时战时和，河西与西域商路繁荣而危险。边军中有蕃兵与胡将，军需、马匹与情报决定战局。长安的胡商带来香料、宝石、乐舞，也带来间谍与债务。',
        pinned: false,
        priority: 80,
      },
    ],
    scenarios: [
      {
        id: 'sb_scene_tang_xishi',
        title: '西市通译',
        description: '长安西市的一名胡汉通译，熟悉多种语言，也欠着邸店一笔钱。',
        location: '长安·西市',
        opening:
          '西市的驼铃声从早到晚不曾停歇。{player}刚替一位粟特商人写完契书，邸店掌柜便把账本拍到案上：三日内还不上欠款，就收回你在后巷的住处。与此同时，一名穿绯色官袍的人正站在门口，打量你许久了。',
        choices: ['先问那位官员来意', '去西市找粟特商人追讨尾款', '收拾细软，今夜离开长安'],
        yearStart: 618,
        yearEnd: 907,
        inventory: [
          { name: '契书副本', qty: 1, note: '几份没结清的商队契约' },
          { name: '短笔与墨', qty: 1, note: '吃饭的家伙' },
        ],
        money: 24,
        realm: '白身',
        titleLabel: '西市通译',
      },
      {
        id: 'sb_scene_tang_border',
        title: '范阳军中的书记',
        description: '在范阳节度使麾下抄写军牍，知道一些不该知道的事。',
        location: '范阳·节度使军营',
        opening:
          '夜雨打在军帐上，灯芯爆了一下。{player}把最后一封军牍封好，发现封泥下多了一行不属于你的字：粮草数对不上。帐外脚步渐近，来人是节度使亲卫，点名要见今晚值守的书记。',
        choices: ['带着军牍从后帐离开', '把军牍交给亲卫，装作什么也没发现', '先去找掌管粮簿的老吏对质'],
        yearStart: 713,
        yearEnd: 907,
        inventory: [
          { name: '军牍抄本', qty: 1, note: '记录着异常粮数' },
          { name: '短刀', qty: 1, note: '军中制式，聊胜于无' },
        ],
        money: 16,
        realm: '军中书记',
        titleLabel: '范阳军书记',
      },
      {
        id: 'sb_scene_tang_scholar',
        title: '太学举子',
        description: '出身寒门，寄居长安备考，盘缠将尽。',
        location: '长安·务本坊',
        opening:
          '春雨把务本坊的青石板洗得发亮。{player}抱着借来的《文选》回到赁屋，房东正把行李搬到门外：这个月的房钱已经拖了十日。院中另一位举子探头看了一眼，压低声音说，有个贵人愿意出钱资助寒门学子，但条件不太寻常。',
        choices: ['去拜访那位愿意资助的贵人', '把仅剩的钱先交房租', '去东市替人代写书信赚钱'],
        yearStart: 618,
        yearEnd: 907,
        inventory: [
          { name: '《文选》', qty: 1, note: '借来的旧书' },
          { name: '毛笔', qty: 1, note: '笔锋已秃' },
        ],
        money: 5,
        realm: '白身',
        titleLabel: '太学举子',
      },
    ],
  },

  {
    schemaVersion: 1,
    kind: 'warm-isle.sandbox-worldbook',
    id: 'sb_world_song',
    name: '大宋',
    category: 'historical',
    description:
      '从北宋到南宋，三百一十九年。汴京的瓦舍、临安的湖山、市舶司的海船、士大夫的党争与边患，共同构成一个繁华而脆弱的世界；开局年份决定你身处哪一段宋。',
    tags: ['宋朝', '全宋', '汴京', '临安', '真实历史'],
    builtin: true,
    createdAt: FIXED_TIME,
    era: {
      dynasty: '宋',
      label: '大宋',
      startYear: 960,
      endYear: 1279,
      defaultYear: 1100,
      calendar: '公元',
      periods: [
        { name: '北宋前期', startYear: 960, endYear: 1022, summary: '结束五代割据，重文抑武，科举与文官政治逐渐定型。' },
        { name: '北宋中期', startYear: 1023, endYear: 1085, summary: '庆历新政、熙宁变法，党争与财政危机交织，城市经济繁荣。' },
        { name: '北宋晚期', startYear: 1086, endYear: 1127, summary: '新旧党争反复，徽宗朝奢靡，金军南下，靖康之变终结北宋。' },
        { name: '南宋', startYear: 1128, endYear: 1279, summary: '偏安临安，海贸发达，理学兴盛，最终为蒙古所灭。' },
      ],
      events: [
        { year: 1005, title: '澶渊之盟', content: '宋辽订立盟约，宋以岁币换取北部边境长期和平。' },
        { year: 1043, title: '庆历新政', content: '范仲淹等推行新政，整顿吏治，因阻力过大而失败。' },
        { year: 1069, title: '熙宁变法', content: '王安石在神宗支持下推行青苗、免役、市易等新法，引发长期党争。' },
        { year: 1127, title: '靖康之变', content: '金军攻破东京，徽钦二帝被掳，北宋灭亡。' },
        { year: 1141, title: '绍兴和议', content: '宋金议和，以淮水大散关为界，岳飞等主战派受挫。' },
        { year: 1279, title: '崖山之战', content: '南宋残军在崖山覆灭，宋朝灭亡。' },
      ],
    },
    defaults: {
      currency: '贯',
      startingMoney: 36,
      location: '东京·州桥',
      date: { year: 1100, month: 4, day: 8 },
      time: '辰时',
      weather: '微雨',
    },
    genreRules:
      '严格遵守宋代制度与生活：重文抑武、台谏与党争、科举与差遣、交子与榷场、坊市界限被打破但城门与宵禁仍有管理。不得出现明清才有的服饰、称谓与制度，不得把宋代写成现代商业社会。',
    entries: [
      {
        id: 'sb_song_politics',
        title: '政治与士大夫',
        keywords: ['朝堂', '士大夫', '台谏', '党争', '科举', '皇帝', '变法'],
        content:
          '宋代重文抑武，文官通过科举、恩荫与举荐入仕，台谏官可以激烈批评宰相。新旧党争贯穿中期，贬谪与起复反复发生。武人地位较低但边军仍是实际力量。普通百姓对朝局的影响有限，必须借人情、舆论与制度缝隙行动。',
        pinned: true,
        priority: 100,
      },
      {
        id: 'sb_song_tokyo',
        title: '东京汴梁',
        keywords: ['汴京', '东京', '州桥', '瓦舍', '夜市', '樊楼', '大相国寺'],
        content:
          '汴京水系发达，州桥夜市与瓦舍勾栏彻夜喧闹。大相国寺每月开放万姓交易，樊楼是权贵与商人交际之所。城门与街鼓仍管理夜间秩序，市井中帮派、行会、牙人盘根错节。',
        pinned: true,
        priority: 95,
      },
      {
        id: 'sb_song_economy',
        title: '货币、行会与生活',
        keywords: ['交子', '铜钱', '会子', '行会', '脚店', '茶坊', '物价'],
        content:
          '铜钱是日常货币，大额交易用绢帛、金银或交子。行会控制手艺与货源，脚店、茶坊、香药铺遍布街巷。城市居民讲究时令吃食与衣着，但多数人生活拮据；一场病或一桩官司就能拖垮小户人家。',
        pinned: false,
        priority: 85,
      },
      {
        id: 'sb_song_frontier',
        title: '边患与和议',
        keywords: ['辽', '金', '西夏', '边关', '岁币', '和议', '战事'],
        content:
          '北宋先后面对辽、西夏与金，和议与岁币换来的和平并不稳固。边军缺马，文臣统兵常常掣肘。南宋依托江淮与海贸，水军重要。金、蒙古与地方武装都会改变局势，任何战争都伴随粮道、难民与财政压力。',
        pinned: false,
        priority: 80,
      },
    ],
    scenarios: [
      {
        id: 'sb_scene_song_zhouqiao',
        title: '州桥夜市的小人物',
        description: '在州桥夜市替人跑腿，熟悉三教九流，也欠着行会一笔人情。',
        location: '东京·州桥',
        opening:
          '夜色刚落，州桥两岸的灯火便连成一条河。{player}替脚店送完最后一笼蒸饼，行会的牙人拦住去路，说这个月的份钱还没交。不远处，一位戴着帷帽的女子正在和香药铺掌柜低声争执，袖口露出半张盖着官印的纸。',
        choices: ['先与牙人周旋', '靠近听听香药铺的争执', '趁乱离开，去瓦舍躲一躲'],
        yearStart: 960,
        yearEnd: 1127,
        inventory: [
          { name: '竹篮', qty: 1, note: '送饼用的旧竹篮' },
          { name: '铜钱', qty: 36, note: '全部现钱' },
        ],
        money: 36,
        realm: '市井',
        titleLabel: '州桥帮闲',
      },
      {
        id: 'sb_scene_song_scholar',
        title: '太学外的举子',
        description: '来京应试的寒门举子，文章有名，盘缠不足。',
        location: '东京·太学',
        opening:
          '太学外的槐树落了一地花。{player}在书铺抄了一上午书，换来的钱仍不够下月房租。同舍举子带来一个消息：某位宰相门生正在找人代写一篇策论，酬金丰厚，但若被查出，前程尽毁。',
        choices: ['接下代写策论的活', '去拜访同乡官员求助', '收拾行李，返回乡里'],
        yearStart: 960,
        yearEnd: 1127,
        inventory: [
          { name: '策论草稿', qty: 1, note: '你最有把握的一篇文章' },
          { name: '旧笔砚', qty: 1, note: '用了多年的笔墨' },
        ],
        money: 9,
        realm: '举子',
        titleLabel: '寒门举子',
      },
      {
        id: 'sb_scene_song_hangzhou',
        title: '杭州茶商',
        description: '江南茶行的伙计，跟着商船往来明州与泉州。',
        location: '杭州·清河坊',
        opening:
          '梅雨把清河坊的招牌洗得发亮。{player}刚从明州押船回来，账房却少了一箱上等茶砖。掌柜怀疑是船上的水手做了手脚，而负责查验的市舶司小吏昨晚恰好来过。更麻烦的是，海上传来消息：近岸又出现了没有旗号的黑船。',
        choices: ['先去码头查水手', '拜访市舶司小吏探口风', '亲自沿海南下去追那箱茶'],
        yearStart: 960,
        yearEnd: 1279,
        inventory: [
          { name: '茶引', qty: 1, note: '通行与课税的凭证' },
          { name: '短匕首', qty: 1, note: '海路防身' },
        ],
        money: 42,
        realm: '商人',
        titleLabel: '茶行伙计',
      },
      {
        id: 'sb_scene_song_quanzhou',
        title: '泉州海商',
        description: '南宋泉州市舶司旁的船行伙计，替蕃商与本地船主牵线，也替自己攒一条出海的船。',
        location: '泉州·市舶司',
        opening:
          '海风把泉州港的咸味吹进市舶司的廊下。{player}刚替一位大食蕃商点完货，船行掌柜却告诉你：那艘去三佛齐的船临时换了船主，舱位和货单都要重算。更麻烦的是，一名市舶司吏员正在翻查你上月替人代填的税单。',
        choices: ['先稳住蕃商，重谈舱位', '去市舶司吏员那里探口风', '连夜找另一条船出海'],
        yearStart: 1128,
        yearEnd: 1279,
        inventory: [
          { name: '番货清单', qty: 1, note: '几种香料与琉璃的货名' },
          { name: '短匕首', qty: 1, note: '海路防身' },
        ],
        money: 50,
        realm: '商人',
        titleLabel: '泉州海商',
      },
    ],
  },

  {
    schemaVersion: 1,
    kind: 'warm-isle.sandbox-worldbook',
    id: 'sb_world_ming',
    name: '大明',
    category: 'historical',
    description:
      '从洪武到崇祯，二百七十六年。苏州织户、北京国子监、江南市镇与辽东军镇共同构成一个商品经济繁荣、党争与边患并起的帝国；开局年份决定你身处哪一段明。',
    tags: ['明朝', '全明', '万历', '真实历史'],
    builtin: true,
    createdAt: FIXED_TIME,
    era: {
      dynasty: '明',
      label: '大明',
      startYear: 1368,
      endYear: 1644,
      defaultYear: 1587,
      calendar: '公元',
      periods: [
        { name: '洪武', startYear: 1368, endYear: 1398, summary: '明初重建秩序，重典治吏，里甲与卫所制度确立。' },
        { name: '建文', startYear: 1399, endYear: 1402, summary: '建文帝削藩，靖难之役爆发，南京朝廷与燕王对峙。' },
        { name: '永乐', startYear: 1403, endYear: 1424, summary: '迁都北京，郑和下西洋，北征蒙古，国力强盛。' },
        { name: '明中期', startYear: 1425, endYear: 1521, summary: '仁宣之后内阁与宦官势力交替，土木之变后边防转守，社会逐渐商业化。' },
        { name: '嘉靖', startYear: 1522, endYear: 1566, summary: '倭患与北虏并起，内阁与言官博弈，海禁与走私并存。' },
        { name: '隆庆', startYear: 1567, endYear: 1572, summary: '隆庆开关与俺答封贡，海禁局部解除，明蒙关系短暂缓和。' },
        { name: '万历', startYear: 1573, endYear: 1620, summary: '前期张居正改革，后期国本之争与党争加剧，辽东压力上升。' },
        { name: '晚明', startYear: 1621, endYear: 1644, summary: '财政崩坏、灾荒与农民起义交织，后金崛起，明朝最终灭亡。' },
      ],
      events: [
        { year: 1405, title: '郑和首次下西洋', content: '郑和率船队自刘家港出发，此后七下西洋，规模空前。' },
        { year: 1421, title: '迁都北京', content: '明成祖正式迁都北京，南京仍保留一套中央机构。' },
        { year: 1550, title: '庚戌之变', content: '俺答汗率军逼近北京，暴露北边防务与京营积弊。' },
        { year: 1572, title: '张居正执政', content: '张居正任首辅，推行一条鞭法与考成法，财政短期改善。' },
        { year: 1592, title: '壬辰战争', content: '日本丰臣秀吉入侵朝鲜，明朝出兵援朝，战争持续多年。' },
        { year: 1616, title: '后金建立', content: '努尔哈赤建立后金，辽东局势急剧变化。' },
        { year: 1644, title: '甲申之变', content: '李自成攻入北京，崇祯帝自缢，明亡。' },
      ],
    },
    defaults: {
      currency: '两银',
      startingMoney: 16,
      location: '北京·正阳门外',
      date: { year: 1587, month: 2, day: 18 },
      time: '上午',
      weather: '阴',
    },
    genreRules:
      '严格遵守明代制度与生活：里甲、卫所、内阁与六部、科举与监生、海禁与走私、白银货币化、晚明党争与辽东战事。不得出现清代才有的辫发、旗袍、军机处等元素，也不得用现代平等观念替代明代身份秩序。',
    entries: [
      {
        id: 'sb_ming_politics',
        title: '朝局与制度',
        keywords: ['内阁', '首辅', '言官', '党争', '皇帝', '六部', '宦官'],
        content:
          '明代废丞相，以内阁票拟、司礼监批红与六部执行构成权力结构。万历后期皇帝久不视朝，党争与言官奏疏激烈。地方有布政使、按察使与知府，里甲负责赋役。身份、座师、同年与乡谊构成真实的人情网络。',
        pinned: true,
        priority: 100,
      },
      {
        id: 'sb_ming_economy',
        title: '白银、市镇与海贸',
        keywords: ['白银', '一条鞭法', '市镇', '海贸', '走私', '苏州', '物价'],
        content:
          '一条鞭法后白银成为重要支付手段，但民间仍用铜钱。江南市镇丝织、棉布与航运发达，海禁下走私猖獗。商人地位有限，读书与做官仍是改变门第的主要道路。普通雇工日入不过数分银，一石米价随灾荒剧烈波动。',
        pinned: true,
        priority: 90,
      },
      {
        id: 'sb_ming_society',
        title: '衣食住行与礼法',
        keywords: ['服饰', '礼法', '宗族', '科举', '缠足', '饮食', '路程'],
        content:
          '明人服饰按身份、场合与地域差异明显，士绅与平民不可随意僭越。宗族与乡约约束日常，婚姻多半由家族决定。出行靠步行、骡马、船与驿站，普通人远行需要路引；夜晚城门关闭，旅店需要登记。',
        pinned: false,
        priority: 85,
      },
      {
        id: 'sb_ming_frontier',
        title: '辽东与边患',
        keywords: ['辽东', '后金', '蒙古', '卫所', '军饷', '倭寇', '朝鲜'],
        content:
          '明代卫所制后期废弛，边军依赖募兵与军饷。辽东面对蒙古诸部与建州女真，战和不定。援朝抗倭消耗巨大，军饷拖欠常引发兵变。边镇情报、粮道与马匹往往比个人勇武更重要。',
        pinned: false,
        priority: 80,
      },
    ],
    scenarios: [
      {
        id: 'sb_scene_ming_suzhou',
        title: '苏州织户',
        description: '苏州盛泽镇的织户子弟，机杼声与牙行抽成构成日常。',
        location: '苏州·盛泽镇',
        opening:
          '天还没亮，盛泽镇的机杼声已经响成一片。{player}把最后一匹绸交给牙行，牙人却只肯按上月六成的价收。镇上传言，苏州城里的税课司又要加派；与此同时，一个操着北方口音的客人愿意出双倍价钱，买一批不在市册上的货。',
        choices: ['与牙行理论，争取合理价钱', '接下北方客人的私货差事', '去县衙打听加派的消息'],
        yearStart: 1368,
        yearEnd: 1644,
        inventory: [
          { name: '织梭', qty: 1, note: '用了多年的旧梭子' },
          { name: '碎银', qty: 1, note: '约一两，藏在鞋底' },
        ],
        money: 10,
        realm: '匠户',
        titleLabel: '织户子弟',
      },
      {
        id: 'sb_scene_ming_guozijian',
        title: '国子监生',
        description: '北京国子监的监生，出身中等，文章尚可，前途未定。',
        location: '北京·国子监',
        opening:
          '国子监的晨钟落下，槐荫里还留着昨夜的雨水。{player}刚收到家书：父亲病重，家中希望你能早日授官。然而一位同窗悄悄告诉你，吏部最近在查一批“冒籍”入监的案子，名单里似乎有你的同乡。',
        choices: ['先去吏部打听名单', '请假回乡探望父亲', '按兵不动，继续备考'],
        yearStart: 1421,
        yearEnd: 1644,
        inventory: [
          { name: '监生历', qty: 1, note: '记录在监课业与考勤' },
          { name: '家书', qty: 1, note: '父亲病重的消息' },
        ],
        money: 16,
        realm: '监生',
        titleLabel: '国子监生',
      },
      {
        id: 'sb_scene_ming_border',
        title: '辽东夜不收',
        description: '辽东边镇的一名夜不收，熟悉山林与敌情，也见过太多缺饷的兄弟。',
        location: '辽东·广宁卫',
        opening:
          '雪粒子打在皮甲上，像细小的砂。{player}带着两名夜不收摸回边墙，带回一个消息：建州方面的斥候昨夜越过了界河，人数不详。守备正在城中宴客，军饷已经拖欠三个月。若现在上报，可能被压下；若压着不报，明早也许就没机会了。',
        choices: ['连夜去见守备', '带人跟上去确认敌情', '先找军中同乡商量'],
        yearStart: 1368,
        yearEnd: 1644,
        inventory: [
          { name: '腰刀', qty: 1, note: '边军制式，刀口有缺' },
          { name: '火镰', qty: 1, note: '取火与点烟' },
        ],
        money: 7,
        realm: '夜不收',
        titleLabel: '广宁卫夜不收',
      },
    ],
  },

  {
    schemaVersion: 1,
    kind: 'warm-isle.sandbox-worldbook',
    id: 'sb_world_han',
    name: '东汉',
    category: 'historical',
    description:
      '从光武中兴到汉末，一百九十六年的东汉。洛阳、边郡与丝路、察举与门第、庄园与流民、外戚与宦官共同构成一个强盛又脆弱的大帝国；开局年份决定你身处哪一段汉。',
    tags: ['汉朝', '洛阳', '东汉', '真实历史'],
    builtin: true,
    createdAt: FIXED_TIME,
    era: {
      dynasty: '汉',
      label: '东汉',
      startYear: 25,
      endYear: 220,
      defaultYear: 97,
      calendar: '公元',
      periods: [
        { name: '光武中兴', startYear: 25, endYear: 57, summary: '刘秀重建汉室，定都洛阳，整顿吏治与豪强。' },
        { name: '明章之治', startYear: 58, endYear: 88, summary: '政治相对稳定，儒学兴盛，对匈奴与西域采取进取政策。' },
        { name: '永元之隆', startYear: 89, endYear: 105, summary: '窦宪破北匈奴，班超经营西域，东汉国势达到高峰。' },
        { name: '中后期', startYear: 106, endYear: 220, summary: '外戚宦官交替专权，党锢、羌乱、黄巾与军阀割据接踵而至。' },
      ],
      events: [
        { year: 25, title: '东汉建立', content: '刘秀称帝，定都洛阳，史称东汉。' },
        { year: 73, title: '班超出使西域', content: '班超率三十六人出使西域，重新经营丝路。' },
        { year: 89, title: '窦宪破北匈奴', content: '汉军在稽落山击败北匈奴，勒石燕然。' },
        { year: 105, title: '蔡伦改进造纸', content: '蔡伦改进造纸术，纸张逐渐用于书写。' },
        { year: 166, title: '第一次党锢', content: '宦官集团打击清流士人，党锢之祸开始。' },
        { year: 184, title: '黄巾起义', content: '张角领导黄巾军起事，东汉统治加速瓦解。' },
        { year: 220, title: '汉献帝禅位', content: '曹丕代汉称帝，东汉灭亡。' },
      ],
    },
    defaults: {
      currency: '五铢钱',
      startingMoney: 800,
      location: '洛阳·太学',
      date: { year: 97, month: 5, day: 6 },
      time: '清晨',
      weather: '晴',
    },
    genreRules:
      '严格遵守东汉制度与生活：三公九卿、尚书台、察举征辟、郡县与封国、庄园经济、儒学经学、五铢钱与简牍书写。不得出现科举、纸张普及后的明清书籍制度、桌椅普及等时代错置；门第、乡里清议与经学师承决定上升空间。',
    entries: [
      {
        id: 'sb_han_politics',
        title: '朝局与选官',
        keywords: ['尚书台', '三公', '察举', '清议', '外戚', '宦官', '门第'],
        content:
          '东汉政务多归尚书台，三公位高而权轻。选官以察举、征辟为主，孝廉与经学名声重要，乡里清议能决定一个人的仕途。外戚与宦官轮流掌握内廷，清流士人常以气节对抗，却也可能招来党锢之祸。',
        pinned: true,
        priority: 100,
      },
      {
        id: 'sb_han_luoyang',
        title: '洛阳与太学',
        keywords: ['洛阳', '太学', '南宫', '北宫', '市', '太学', '经学'],
        content:
          '洛阳有南北宫、太学与灵台，太学生来自各郡，清议与经学辩论活跃。城中市肆管理严格，夜间有禁。城外庄园与农田相连，流民常在城门附近聚集。太学生可以议论朝政，但也容易被视为朋党。',
        pinned: true,
        priority: 90,
      },
      {
        id: 'sb_han_society',
        title: '生活与书写',
        keywords: ['简牍', '五铢钱', '粮食', '衣服', '车马', '驿站', '物价'],
        content:
          '日常书写多用简牍与木牍，纸张开始出现但尚未普及。主食以粟、麦、稻为主，肉食多为节庆。五铢钱是常用货币，大额交易也可能用布帛与粮食。远行依靠车马、驿站与乡里住宿，需要名籍或引信。',
        pinned: false,
        priority: 85,
      },
      {
        id: 'sb_han_frontier',
        title: '边郡与西域',
        keywords: ['匈奴', '西域', '班超', '边郡', '羌', '丝路', '烽燧'],
        content:
          '北匈奴、南匈奴、羌人与乌桓构成复杂边防。河西四郡与西域都护府维系丝路，烽燧与驿传传递军情。边郡生活艰苦，军粮、马匹与译语人才极为重要。一场边患会同时牵动朝廷党争与地方豪强。',
        pinned: false,
        priority: 80,
      },
    ],
    scenarios: [
      {
        id: 'sb_scene_han_taixue',
        title: '洛阳太学生',
        description: '从郡国来洛阳游学的寒门士子，经学出众却无门第可依。',
        location: '洛阳·太学',
        opening:
          '太学外的槐树下，士子们正在传抄一篇新出的奏议。{player}把最后一卷竹简捆好，听见有人低声议论：朝廷又要察举孝廉，而名单里多是公卿子弟。同舍的富家子邀你替他写一篇对策，报酬足够半年用度，但署名之后便不再属于你。',
        choices: ['答应代写，换取盘缠', '把自己的对策投到公车门下', '去拜访一位赏识寒门的经师'],
        yearStart: 25,
        yearEnd: 220,
        inventory: [
          { name: '竹简', qty: 1, note: '手抄的《春秋》片段' },
          { name: '五铢钱', qty: 1, note: '约八百钱，装在布囊里' },
        ],
        money: 800,
        realm: '布衣',
        titleLabel: '太学生',
      },
      {
        id: 'sb_scene_han_border',
        title: '河西边吏',
        description: '敦煌郡的一名小吏，负责驿站文书与过往商旅。',
        location: '敦煌·玉门关',
        opening:
          '风从玉门关外卷来，带着沙砾。{player}在驿站清点过所文书，发现一支自称来自疏勒的商队，货物清单和人数对不上。押队的胡商递来一块成色极好的玉，笑着说只是路上多带了几匹骆驼。关外烽燧刚刚升起一道烟。',
        choices: ['收下玉，放商队过关', '扣下商队，仔细查验', '先把消息报给都尉'],
        yearStart: 25,
        yearEnd: 220,
        inventory: [
          { name: '过所文书', qty: 1, note: '查验商旅的凭证' },
          { name: '环首刀', qty: 1, note: '边吏配刀' },
        ],
        money: 600,
        realm: '斗食小吏',
        titleLabel: '敦煌郡边吏',
      },
      {
        id: 'sb_scene_han_manor',
        title: '庄园庶子',
        description: '地方豪族庄园中的庶出子弟，衣食无忧，却没有继承权。',
        location: '南阳·豪族庄园',
        opening:
          '庄园里的麦子已经泛黄。{player}在账簿上看到一笔来路不明的粮食，数额足以养活数百流民。嫡兄刚从洛阳回来，带回了新的察举消息，也带回了一封写给郡府的信。夜里，管家悄悄提醒你：不要多问，也不要多看。',
        choices: ['私下查那批粮食的去向', '向嫡兄示好，争取一个举荐名额', '带着账簿离开庄园'],
        yearStart: 25,
        yearEnd: 220,
        inventory: [
          { name: '私印', qty: 1, note: '庶子的私印，效力有限' },
          { name: '短剑', qty: 1, note: '装饰多于实用' },
        ],
        money: 500,
        realm: '豪族庶子',
        titleLabel: '南阳庄园庶子',
      },
    ],
  },

  {
    schemaVersion: 1,
    kind: 'warm-isle.sandbox-worldbook',
    id: 'sb_world_ashen_crown',
    name: '灰烬王冠',
    category: 'western_fantasy',
    description:
      '旧帝国崩塌后的低魔大陆。王国、教会、自由城邦与北境旧神互相牵制，魔法来自灰烬，也以记忆和生命为代价。',
    tags: ['西幻', '低魔', '政治', '探索'],
    builtin: true,
    createdAt: FIXED_TIME,
    era: null,
    defaults: {
      currency: '银币',
      startingMoney: 28,
      location: '白港·下城区',
      date: { year: 872, month: 10, day: 3 },
      time: '傍晚',
      weather: '海雾',
    },
    genreRules:
      '这是一个低魔、重政治与生存的世界。魔法必须付出记忆、鲜血或寿命的代价，施法不是日常解法。教会、王权、行会、地方领主与旧神信徒互相制衡。旅行需要补给，伤病会拖延，传闻不一定真实。不要让魔法成为无代价的万能工具。',
    entries: [
      {
        id: 'sb_ash_realms',
        title: '王国与权力',
        keywords: ['瓦尔登', '白港', '王权', '领主', '议会', '自由城邦', '旧帝国'],
        content:
          '瓦尔登王国名义上统治大陆西部，实际权力分散在领主、主教与自由城邦议会手中。旧帝国留下的道路与堡垒仍在，但税制与军备崩坏。白港靠海贸与雇佣兵繁荣，王都则被继承争议拖住。',
        pinned: true,
        priority: 100,
      },
      {
        id: 'sb_ash_church',
        title: '圣灰教会',
        keywords: ['教会', '圣灰', '主教', '异端', '旧神', '审判庭'],
        content:
          '圣灰教会崇拜“灰烬圣母”，掌握识字、医疗与丧葬，也控制大部分魔法解释权。审判庭追查未经许可的施法者，但地方教会常与贵族妥协。北境仍有人秘密供奉旧神，教会称其为异端。',
        pinned: true,
        priority: 95,
      },
      {
        id: 'sb_ash_magic',
        title: '灰烬术与代价',
        keywords: ['魔法', '灰烬术', '记忆', '咒印', '代价', '法师', '禁忌'],
        content:
          '灰烬术通过燃烧记忆、血液或寿命改变现实。越强的法术留下的空洞越大；失忆、失明、衰弱与噩梦是常见代价。法师通常被教会登记，未经许可施法可被处以火刑。没有免费的奇迹，也没有随便复活的死者。',
        pinned: false,
        priority: 90,
      },
      {
        id: 'sb_ash_life',
        title: '行会、旅途与生存',
        keywords: ['行会', '雇佣兵', '旅店', '银币', '瘟疫', '海贸', '道路'],
        content:
          '铁匠、织工、船工与盗贼各有行会，雇佣兵按日计酬。道路上有税卡、劫匪与野兽，旅店并不便宜。白港的贫民区拥挤潮湿，瘟疫与火灾常见。银币是通用货币，但地方领主也会发行贬值的铜币。',
        pinned: false,
        priority: 85,
      },
    ],
    scenarios: [
      {
        id: 'sb_scene_ash_mercenary',
        title: '白港佣兵',
        description: '自由城邦白港的落魄佣兵，身上只剩几日饭钱和一把旧剑。',
        location: '白港·下城区',
        opening:
          '海雾把白港的石阶泡得发亮。{player}在酒馆后巷挡下一记刺向债主的刀，换来三枚银币和一句“跟我来”。债主是城里有名的香料商，他愿意出一笔钱，请你去北边废弃的灰烬修道院取回一只箱子。佣金足够还清欠账，但上一个接活的人没有回来。',
        choices: ['先问清楚箱子里是什么', '当晚就出发，抢在别人之前', '去码头找那个失踪佣兵留下的同伴'],
        inventory: [
          { name: '旧长剑', qty: 1, note: '剑刃有缺口，但还能用' },
          { name: '银币', qty: 3, note: '全部现钱' },
        ],
        money: 3,
        realm: '佣兵',
        titleLabel: '白港佣兵',
      },
      {
        id: 'sb_scene_ash_monastery',
        title: '修道院抄写员',
        description: '圣灰修道院的抄写员，识字，能接触被封存的旧卷。',
        location: '圣灰修道院',
        opening:
          '烛火在石墙上摇晃。{player}抄到一页被反复刮改的经文，原文里出现了一个不该存在的名字：旧神“无面者”。院长明天要来检查藏书，而地窖里传来很轻的敲击声。负责看守的修士今晚请假，钥匙却落在你手边。',
        choices: ['下到地窖查看', '把原页藏进自己的抄本', '直接去问院长'],
        inventory: [
          { name: '鹅毛笔', qty: 1, note: '修道院发的书写工具' },
          { name: '小刀', qty: 1, note: '削笔与防身' },
        ],
        money: 18,
        realm: '见习修士',
        titleLabel: '修道院抄写员',
      },
      {
        id: 'sb_scene_ash_caravan',
        title: '北境商队护卫',
        description: '跟随商队穿行北境，见过雪原与旧神遗迹，也知道沉默值多少钱。',
        location: '北境·灰石道',
        opening:
          '风雪把灰石道埋了一半。商队在一座废弃驿站扎营，车上的货物用黑布裹得严严实实。半夜，守夜的雇佣兵看见远处有火光，商队首领却坚持天亮前必须赶路。{player}在雪地里发现了一串不是人的脚印，方向正对着车队。',
        choices: ['叫醒首领，要求说明货物', '独自沿脚印追踪', '守住车队，等天亮再做决定'],
        inventory: [
          { name: '短矛', qty: 1, note: '北境防身武器' },
          { name: '皮水囊', qty: 1, note: '只剩半袋水' },
        ],
        money: 28,
        realm: '商队护卫',
        titleLabel: '北境商队护卫',
      },
    ],
  },
  ...HISTORICAL_DYNASTY_BOOKS,
  ...MODERN_HISTORICAL_BOOKS,
];

for (const book of BUILTIN_SANDBOX_WORLDBOOKS) {
  attachSpecialOpenings(book);
}

export const BUILTIN_SANDBOX_PLUGINS = [
  {
    schemaVersion: 1,
    kind: 'warm-isle.plugin',
    id: 'sb_plugin_hard_consequence',
    name: '硬核因果',
    description: '强化风险、代价与后果，适合希望世界更残酷的玩家。',
    author: '暖屿内置',
    version: '1.0.0',
    prompt:
      '每个行动都应产生可追踪的后果，成功也要付出时间、金钱、体力或人情。不要因为玩家是主角就免除死亡、受伤、羞辱或失去机会；失败可以是可玩的结果，而不是剧情强行拉回。NPC 有自己的利益，不会无条件服从玩家。',
    enabled: false,
    priority: 90,
    builtin: true,
    createdAt: FIXED_TIME,
  },
  {
    schemaVersion: 1,
    kind: 'warm-isle.plugin',
    id: 'sb_plugin_decision_hints',
    name: '辅助决定·思路提示',
    description:
      '在正文末尾单独列出符合人物身份、点数、学识、能力、阅历与资源的几条思路，只作提示，不替玩家选择或推进。',
    author: '暖屿内置',
    version: '1.0.0',
    prompt:
      '在每轮正文之后、<sandbox>状态块之前，另起一栏输出【思路提示】。根据玩家当前的身份、背景、六项点数、年龄与阅历、资源、关系和信息掌握程度，列出 3～5 条“此刻可以考虑的方向或念头”，每条一句话，并简短注明依据，例如“依你的政务经验”“以你目前的兵力”“凭你与宰相的关系”。\n' +
      '【思路提示】只是提示，不是行动选项，不是推荐排序，也不是系统替玩家做出的决定：不得写“你应该”“最佳选择是”“你必须选择”，不得替玩家说出台词、写下心理决定、执行其中任何一条，也不得在正文中替玩家完成选择。\n' +
      '正文必须停在玩家可以自行决定的位置；NPC 可以劝诱、施压、请求、拒绝或沉默，但不得替玩家应允。玩家没有明确说过的行动、话、心理与决定，一律不得代写。\n' +
      '思路必须贴合人物能力与身份：点数低的方向应体现风险或信息不足，点数高的方向才体现专业判断；不符合身份、学识、资源或时代条件的方向不要列出。信息不足时，可以列“先观察/打听/试探”的低风险思路。\n' +
      '不得在思路中泄露隐藏真相、未来事件、NPC 隐秘动机或玩家不该知道的情报；超拟真模式下也只能给出可观察的线索与推测。',
    enabled: true,
    priority: 80,
    builtin: true,
    createdAt: FIXED_TIME,
  },
  {
    schemaVersion: 1,
    kind: 'warm-isle.plugin',
    id: 'sb_plugin_no_anachronism',
    name: '历史防穿帮',
    description: '自动强调时代细节，适合真实历史世界。',
    author: '暖屿内置',
    version: '1.0.0',
    prompt:
      '严格执行所选年代的技术、制度、称谓、服饰、饮食与交通条件。人物不得使用后世才有的词汇、概念与器物；遇到时代知识不足时，用符合时代的信息与误解代替现代解释，而不是直接用现代知识解决问题。',
    enabled: false,
    priority: 95,
    builtin: true,
    createdAt: FIXED_TIME,
  },
];
