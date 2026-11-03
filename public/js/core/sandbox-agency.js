/**
 * 玩家自主权守卫。
 *
 * 主叙事模型仍可能用玩家姓名/“你”作主语，替玩家决定、下令、同意或推进下一步。
 * 这里做两件事：
 * 1. 检测明显的代行叙事；
 * 2. 只用一次校正调用重写叙事，保留 NPC 与世界事实，删除玩家未说过的行动与决定。
 *
 * 校正失败时使用本地保守裁剪，绝不把“玩家已经决定”的叙事原样放出。
 */

import { normalizeWhitespace } from './utils.js';

const ACTION_WORDS =
  /(抬手|示意|开口|起身|接过|接下|按下|分派|吩咐|命令|下令|决定|同意|应允|点头|摇头|走向|坐下|站起|召见|召来|派人|安排|选择|定下|算定|不再争|命人|传令|批复|下令|签押|用印|起身|看了|说道|问道|答道)/;
const DECISION_WORDS =
  /(便算定了|算定了|已经决定|已经同意|已经下令|将话头按下|不再争拗|分派下去)/;

function splitSentences(text) {
  const source = String(text || '');
  const result = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if ('。！？!?；;\n'.includes(source[index])) {
      const sentence = source.slice(start, index + 1);
      if (sentence.trim()) result.push(sentence);
      start = index + 1;
    }
  }
  if (start < source.length) {
    const sentence = source.slice(start);
    if (sentence.trim()) result.push(sentence);
  }
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectPlayerAgency(narrative, playerName = '') {
  const text = String(narrative || '');
  if (!text) return { risky: false, evidence: [] };
  const evidence = [];
  const name = String(playerName || '').trim();
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    const hasName = name && sentence.includes(name);
    const hasYou = /(^|[，。！？；;\s])你(?=[^，。！？；;\s])/.test(sentence);
    if ((hasName || hasYou) && ACTION_WORDS.test(sentence)) {
      evidence.push(sentence.trim().slice(0, 120));
    } else if (DECISION_WORDS.test(sentence)) {
      evidence.push(sentence.trim().slice(0, 120));
    }
  }
  return { risky: evidence.length > 0, evidence: evidence.slice(0, 5) };
}

export function buildAgencyRewritePrompt({ narrative, playerName, action }) {
  const system = [
    '你是沙盒叙事的「玩家自主权校正器」，只做一件事：把叙事中替玩家新增的行动、台词、心理、同意与决定删掉或改写。',
    '保留所有世界事实、NPC 言行、环境变化、行动结果与已知线索；不要改变判定结果，不要新增剧情，不要替玩家选择。',
    '玩家已经明确输入的行动可以保留为既成事实；但叙事不得继续替玩家安排下一步、下令、应允、分派、总结决定或写玩家心理。',
    '删除以下模式：玩家姓名/“你”作主语的新动作；抬手、示意、起身、接过、按下、分派、吩咐、下令、决定、同意、应允、点头、安排、选择、算定、将话头按下。',
    '正文必须停在玩家可以自行决定的位置；如果原叙事几乎全是玩家动作，就改写为“局面、NPC 反应、可见后果”，不要用新的玩家动作填补。',
    '只输出校正后的正文，不要输出解释、Markdown、<sandbox> 状态块或【思路提示】。',
  ].join('\n');
  const user = [
    `【玩家姓名】${playerName || '玩家角色'}`,
    `【玩家本轮明确行动】${action || '未记录'}`,
    '',
    '【原叙事】',
    String(narrative || '').slice(0, 8_000),
    '',
    '请只输出校正后的正文。',
  ].join('\n');
  return {
    system,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

export function parseAgencyRewrite(raw) {
  let text = String(raw || '');
  const stateIndex = text.search(/<\s*(?:sandbox|world_state)\b/i);
  if (stateIndex >= 0) text = text.slice(0, stateIndex);
  const hintIndex = text.lastIndexOf('【思路提示】');
  if (hintIndex >= 0) text = text.slice(0, hintIndex);
  text = normalizeWhitespace(
    text
      .replace(/^```(?:text|markdown)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim(),
  );
  return text.length >= 40 ? text : '';
}

/** 校正调用失败时的保守兜底：删除明显的玩家代行句，保留世界与 NPC 信息。 */
export function stripPlayerAgency(narrative, playerName = '') {
  const text = String(narrative || '');
  const sentences = splitSentences(text);
  const name = String(playerName || '').trim();
  const kept = sentences.filter((sentence) => {
    const hasName = name && sentence.includes(name);
    const hasYou = /(^|[，。！？；;\s])你(?=[^，。！？；;\s])/.test(sentence);
    if (hasName || hasYou) return false;
    if (DECISION_WORDS.test(sentence)) return false;
    return true;
  });
  const result = kept.join('').trim();
  return result.length >= 40
    ? result
    : '局面继续向前，压力与线索都还在。下一步由你决定。';
}
