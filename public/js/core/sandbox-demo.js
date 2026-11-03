/**
 * 沙盒演示模式：不调用模型，只用于第一次体验或离线展示界面。
 * 它不会伪装成真实模型；顶栏会显示“演示”。
 */

import { getSandboxCategory } from './constants.js';

function outcomeNarrative(outcome, category) {
  const base = {
    大成功: '局面意外地向你倾斜，你抓住了一个原本不属于你的机会。',
    成功: '你的行动奏效了，周围的世界给出了明确的回应。',
    勉强成功: '你达到了目的，但过程并不干净，留下了一个需要收拾的小尾巴。',
    部分成功: '你只拿到了想要的一部分，代价已经发生，无法当作没看见。',
    失败: '事情没有按你的预想发展。世界不会为了你停下来。',
    大失败: '局势迅速失控，你的判断或运气在关键处背叛了你。',
  }[outcome] || '世界继续运转，你的行动留下了痕迹。';
  const flavor = {
    xianxia: '灵机在空气里轻轻一震，远处有修士的神识扫过。',
    historical: '街巷里人声照旧，衙门与行会却在暗处重新计算这件事的得失。',
    western_fantasy: '海雾贴着石墙爬行，教堂的钟声比往常晚了一刻。',
  }[category];
  return `${flavor} ${base}`;
}

export function sandboxDemoReply({ save, action, check, worldbook }) {
  const category = getSandboxCategory(save.category);
  const outcome = check?.outcome || '未判定';
  const hour = new Date().getHours();
  const nextTime = hour < 12 ? '午后' : hour < 18 ? '黄昏' : '夜晚';
  const penalty = outcome.includes('失败') ? 14 : outcome.includes('部分') ? 8 : 4;
  const narrative = [
    `${save.world.location}。${action}`,
    outcomeNarrative(outcome, save.category),
    `${worldbook?.name ? `这是${worldbook.name}的一天。` : ''}你听见不远处有人压低了声音，像是在议论刚才发生的事。`,
  ].join('\n\n');

  const state = {
    ...save.world,
    time: nextTime,
    energy: Math.max(0, save.player.energy - penalty),
    health: Math.max(0, save.player.health - (outcome === '大失败' ? 12 : 0)),
    relationships: save.world.relationships,
    quests: save.world.quests,
    scene: {
      title: save.world.scene.title || '新的岔路',
      summary: '刚才的行动已经改变了一些事情，下一步仍由你决定。',
      choices: [
        '先观察周围是否有人跟踪',
        '去找一个能提供消息的人',
        '检查自己的伤势和随身物品',
      ],
    },
  };

  const raw = `${narrative}\n\n<sandbox>${JSON.stringify(state)}</sandbox>`;
  return {
    raw,
    narrative,
    state,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimated: false,
      demo: true,
    },
    model: 'demo',
    provider: 'demo',
  };
}
