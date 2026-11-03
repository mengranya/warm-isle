/**
 * 「辅助决定·思路提示」的本地兜底生成。
 *
 * AI 没有按插件格式返回【思路提示】时，仍按人物点数、身份、资源与当前局势
 * 生成几条思路。它们只显示在提示栏，不进入正文，也不替玩家选择。
 */

import { getHistoricalTemplate, getSandboxAbilities } from './constants.js';

const HIGH_ABILITY_HINTS = {
  statecraft: '依你的治国经验，可以先命人把账目、律令与各方奏报逐条核对，再决定是否表态。',
  governance: '依你的政务经验，可以先分清哪些事有旧例、哪些事需要新办法，再决定从哪一处入手。',
  command: '以你的统兵经验，可以先确认兵力、粮道与对手位置，再决定是否动兵。',
  martial: '凭你的武艺与胆气，可以先判断现场是否真的需要动手，以及动手后如何脱身。',
  tactics: '以你的战术判断，可以先找退路、侧翼与信息缺口，再决定是否冒险。',
  training: '依你的治军经验，可以先查军纪、部曲与粮饷，再决定整军还是先稳住人心。',
  logistics: '以你的后勤经验，可以先算清粮草、军械与转运损耗，再决定能支撑多大的行动。',
  strategy: '依你的谋略，可以先把各方利益与最坏结果列清，再选择代价最小的一步。',
  intrigue: '凭你的权谋判断，可以先分别试探各方底线，不急于当众摊牌。',
  personnel: '以你的识人经验，可以先单独召见关键人物，判断谁可信、谁在观望。',
  culture: '依你的学识，可以先从礼制、先例与文书漏洞入手，寻找不撕破脸的解法。',
  virtue: '以你的名望，可以先公开表明原则，再私下处理具体人事。',
  diplomacy: '依你的交涉经验，可以先确认对方真正要什么，再决定让哪一步。',
  charisma: '以你的威望，可以先公开定调、稳住人心，再处理具体人事。',
  business: '依你的经商经验，可以先核对现银、存货与买家底细，再决定是否出手。',
  finance: '以你的理财判断，可以先算清现金流与最坏亏损，再决定投入多少。',
  appraisal: '凭你的鉴识，可以先验货、比价、查来路，避免被表面成色骗过。',
  network: '以你的人脉，可以先找一两个真正知道内情的人试探，不急着公开站队。',
  management: '依你的组织经验，可以先把人手、账目与责任分开，再决定谁去办。',
  credit: '以你的信誉，可以先稳住债主与老客户，再处理眼前的缺口。',
  livelihood: '依你的生计经验，可以先算清口粮、欠债与近日开销，再决定冒险还是先稳住。',
  craft: '以你的手艺，可以先看材料、工序与买主，再决定接不接这单。',
  endurance: '以你的体魄，可以先判断自己还能撑多久，再决定是否硬扛。',
  social: '依你对人情世故的了解，可以先找邻里或里正探口风，再决定是否出头。',
};

const LOW_ABILITY_HINTS = {
  statecraft: '此事涉及你不熟悉的政务细节，先找懂行的属官核实，避免直接下结论。',
  command: '你对大规模用兵没有把握，先确认兵力与粮道，不要贸然把局势推向战场。',
  intrigue: '你不太擅长权谋试探，先少说多听，避免被在场的人套出底牌。',
  personnel: '你看人容易只看表面，先分别接触、交叉验证，不要只信一个人的话。',
  culture: '此事涉及礼制或典籍细节，先请教熟悉旧例的人，避免说错话。',
  martial: '你没有必胜的武力把握，先判断退路与对方人数，不要轻易动手。',
  business: '你对行情与货品不够熟，先小规模试探，不要一次压上全部本钱。',
  livelihood: '你手头抗风险能力有限，先保住口粮与住处，再考虑冒险。',
};

export function buildLocalDecisionHints(save, { limit = 4 } = {}) {
  const template = getHistoricalTemplate(save?.player?.template || 'commoner');
  const abilities = getSandboxAbilities(
    save?.category || 'historical',
    save?.player?.template || 'commoner',
  );
  const attributes = save?.player?.attributes || {};
  const hints = [];
  const add = (text) => {
    const value = String(text || '').trim();
    if (value && !hints.includes(value)) hints.push(value);
  };

  const ranked = abilities
    .map((ability) => ({ ...ability, score: Number(attributes[ability.key]) || 0 }))
    .sort((a, b) => b.score - a.score);
  for (const ability of ranked.filter((item) => item.score >= 13).slice(0, 2)) {
    add(HIGH_ABILITY_HINTS[ability.key]);
  }
  const weakest = ranked.filter((item) => item.score > 0 && item.score <= 7).at(-1);
  if (weakest) add(LOW_ABILITY_HINTS[weakest.key]);

  const resources = save?.player?.resources || [];
  const keyResource = resources.find((item) =>
    /国库|粮草|兵力|军饷|现银|存货|口粮|欠债|民心/.test(item.name || ''),
  );
  if (keyResource) {
    add(
      `先盘点${keyResource.name}${
        keyResource.value ? `（${keyResource.value}${keyResource.unit || ''}）` : ''
      }，确认它能支撑到什么程度。`,
    );
  }

  if (save?.player?.template === 'emperor') {
    add('以皇帝身份，先区分哪些事必须亲裁、哪些可以交有司，避免把精力耗在细节上。');
  } else if (template.id === 'civil') {
    add('先分清这件事是规矩问题、利益问题，还是信息问题；三种解法不一样。');
  } else if (template.id === 'military') {
    add('先把军中人心、粮道与退路确认一遍，再决定是进、是守，还是先谈。');
  } else if (template.id === 'merchant') {
    add('先把现银、存货与买家底细分开看，避免把一笔生意做成资金链风险。');
  } else {
    add('先把已知信息分成“确定、传闻、未知”，再补最关键的一环。');
  }
  add('先观察在场各人的反应，再决定是否开口；不急于当众表态。');
  return hints.slice(0, limit);
}
