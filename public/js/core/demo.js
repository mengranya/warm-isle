/**
 * 离线演示模式。
 *
 * 不调用任何模型，也不消耗 token；用于第一次打开应用时体验界面。
 * 演示回复明确标注在顶栏状态里，不会伪装成真实模型输出。
 */

import { STORY_SEEDS } from './constants.js';
import { countChars, pickBySeed, safeColor } from './utils.js';

function detectIntent(text) {
  const value = String(text || '');
  if (/饿|吃|饭|咖啡|茶|甜|宵夜|喝/.test(value)) return 'food';
  if (/累|难过|哭|压力|烦|失眠|害怕|疼|不舒服/.test(value)) return 'comfort';
  if (/喜欢|爱|想你了|心动|抱|亲/.test(value)) return 'tender';
  if (/雨|天气|冷|风|夜|晚/.test(value)) return 'weather';
  if (/你好|在吗|嗨|早|晚上好|哈喽/.test(value)) return 'hello';
  return 'daily';
}

const RESPONSES = {
  food: [
    '「先吃点东西再说话。」{name}把杯子往你手边推了推，杯壁还留着刚好的温度，「不是敷衍你——空腹的时候，人很容易把一件小事想得很糟。」',
    '{name}低头笑了一下，转身去翻柜子：「正好，我藏了一包不太甜的饼干。你坐里面一点，别挡着风口。」',
  ],
  comfort: [
    '{name}没有立刻劝你。{ta}只是把旁边的位置让出来，等你坐下，才轻声问：「今天最难受的是哪一段？从那里开始说也可以。」',
    '「不用现在就振作。」{name}把声音放得很低，像是怕惊动什么，「你可以先在这里待一会儿。剩下的，等你想说的时候再说。」',
  ],
  tender: [
    '{name}的动作停了一瞬，耳根慢慢红起来。{ta}别开视线，却还是把话说得很清楚：「这种话，你只可以对我说。」',
    '{name}看着你，眼里有一点很浅的笑：「我听见了。先别急着收回去，让我再高兴一会儿。」',
  ],
  weather: [
    '{name}望了一眼窗外。雨丝斜斜地擦过玻璃，{ta}伸手把窗关小了一点：「今晚大概不会停了。你要是不急着走，就多坐一会儿。」',
    '风从门缝里钻进来，{name}把外套搭到椅背上，顺手替你挡了一下：「冷就说，别硬撑。这里又不是外面。」',
  ],
  hello: [
    '{name}抬起眼，像是已经等了一会儿：「嗯，我在。今天过得怎么样？」',
    '「来了。」{name}把手边的事放下，给你留出完整的注意力，「先坐吧，慢慢说。」',
  ],
  daily: [
    '{name}安静地听你说完，指尖在杯沿轻轻敲了一下，像是在想怎么回答。片刻后，{ta}抬起眼：「那你是怎么想的？我想听听你自己的答案。」',
    '「原来是这样。」{name}把你说过的某个细节重复了一遍，语气认真得不像随口一问，「那件事对你来说，应该比表面上更重要吧。」',
  ],
};

function pronounFor(persona) {
  if (persona?.pronouns === '他') return '他';
  if (persona?.pronouns === '她') return '她';
  return 'TA';
}

export function demoReply({ persona, archive, text }) {
  const intent = detectIntent(text);
  const template = pickBySeed(RESPONSES[intent], `${text}:${persona?.name}`, 0);
  const content = template
    .replaceAll('{name}', persona?.name || '对方')
    .replaceAll('{ta}', pronounFor(persona))
    .replaceAll('{address}', persona?.address || '你');

  const previous = archive?.status || {};
  const player = archive?.protagonist?.name || '你';
  const npc = archive?.npcs?.[0];
  const sceneSeed = pickBySeed(STORY_SEEDS, `${text}:${intent}`, 0);
  const status = {
    health:
      intent === 'comfort'
        ? '情绪平稳，注意力一直放在你身上'
        : previous.health || '气色很好，呼吸平稳',
    outfit: previous.outfit || '舒适柔软的日常衣着',
    environment: previous.environment || '一间光线温暖的小房间',
    action: `正看着${player}，手边的动作刚刚停下`,
    notes: `${sceneSeed}${npc ? ` ${npc.name}在不远处，偶尔看向这边。` : ''}`.slice(0, 1_000),
    updatedAt: new Date().toISOString(),
    source: 'ai',
  };

  return {
    content,
    status,
    raw: `${content}\n<status>${JSON.stringify(status)}</status>`,
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

export function demoDiary({ persona, archive }) {
  const player = archive?.protagonist?.name || '玩家';
  const status = archive?.status || {};
  const recent = (archive?.messages || []).slice(-6);
  const userLine = recent.filter((message) => message.role === 'user').at(-1)?.content || '';
  const action = status.action || '与对方安静地待在一起';
  const environment = status.environment || '熟悉的场景';
  const gist = userLine
    ? `这一日，${player}向${persona?.name || '对方'}提起了「${userLine.slice(0, 42)}」`
    : `这一日，${player}与${persona?.name || '对方'}在${environment}重逢`;
  const text = `${gist}。${persona?.name || '对方'}没有急着给出答案，只是${action}，把注意力留在对方身上。气氛比先前更近了一些，${player}的情绪也慢慢松开。两人没有把话说尽，但某个尚未命名的约定已经留在了${environment}里。`;
  return text.slice(0, 220);
}

export function demoNpc({ persona, archive }) {
  const names = ['程野', '许青禾', '温迟', '陆闻'];
  const existing = new Set((archive?.npcs || []).map((npc) => npc.name));
  const name = names.find((candidate) => !existing.has(candidate)) || '程野';
  return {
    name,
    identity: '恰好在附近停留的旧识',
    style: '说话不急不缓，习惯先观察再开口，偶尔露出一点不动声色的幽默。',
    appearance: '衣着简洁，手里拿着一把还没收起的伞，像是刚从雨里走进来。',
    color: safeColor('#a98367'),
    source: 'ai',
  };
}

export function demoDiaryCharCount(text) {
  return countChars(text);
}
