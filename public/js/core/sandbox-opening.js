/**
 * 历史固定人物的 AI 专属开场。
 *
 * 目标不是给每个皇帝套一段“有人等你犯错”的模板，而是根据：
 * - 具体年份与在位阶段
 * - 即位合法性、支持基础、朝局与外部压力
 * - 当年之前已经发生的历史事件
 * 推演出一个符合因果、可以行动的开场。
 */

import {
  getHistoricalTemplate,
  getSandboxCategory,
} from './constants.js';
import { parseLooseJson, truncateText } from './utils.js';

export function buildHistoricalOpeningPrompt({
  worldbook,
  scenario,
  year,
  player,
  difficulty,
}) {
  const category = getSandboxCategory(worldbook?.category || 'historical');
  const fixed = scenario?.fixedFigure || {};
  const template = getHistoricalTemplate(fixed.template || player?.template || 'commoner');
  const events = (worldbook?.events || [])
    .filter((event) => Number(event.year) <= Number(year))
    .slice(-10)
    .map((event) => `${event.year}：${event.title || event.summary || ''}`)
    .join('\n');
  const system = [
    '你是历史沙盒的「开场推演器」，只负责为一个固定历史人物生成开场，不写后续剧情。',
    '必须严格贴近该人物所在年份的真实处境，不能把不同年代、不同年龄、不同朝局套进同一模板。',
    '先判断：在位第几年、即位是否合法稳固、支持者与反对者是谁、财政与军力如何、当前最大的真实议题是什么。',
    '不要为了制造困难而制造困难。太子地位稳固、继位合法、支持者占优时，登基后的常态是朝臣服从与政务运转，不是人人阴谋。',
    '不臣、逼宫、政变、大规模阳奉阴违必须有前置矛盾、利益冲突、把柄或外部压力，并在开场中留下可追溯线索。',
    '如果年份处于稳定期，开场可以是一次真实的朝议、任命、财政、边防、礼仪或人事抉择，不必强行写成危机。',
    '如果年份处于战乱、政变、权臣当国或财政崩溃期，则按真实因果呈现压力，不要凭空加码。',
    '开场只写 250～500 字，第二人称或第三人称均可；不要替玩家决定行动、台词、同意或心理。',
    '不要写“你决定”“你选择”“你同意”“你下令”“你最终……”；只能写局面、NPC 的言行与可见信息，停在玩家可以自行行动的位置。',
    '只输出 JSON，不要 Markdown、解释或代码围栏。',
    '',
    '输出结构：',
    '{"title":"场景标题","summary":"一句话局势摘要","opening":"开场正文","location":"具体地点","choices":["可行动提示1","可行动提示2","可行动提示3"]}',
  ].join('\n');
  const user = [
    `【世界书】${worldbook?.name || category.label}`,
    `【人物】${fixed.name || player?.name || '未定'}`,
    `【身份】${fixed.title || player?.identity || '未定'}；模板：${template.label}`,
    `【年份】${year}${year < 0 ? '（公元前）' : ''}`,
    `【年龄】${fixed.age || player?.age || '未知'}`,
    `【难度】${difficulty?.label || '标准'}`,
    `【人物简介】${truncateText(fixed.description || player?.background || '', 300)}`,
    '',
    '【该年份之前的历史事件】',
    events || '暂无具体事件记录；请只依据该人物与年份的通行史实推演，不要虚构大事件。',
    '',
    '请给出这一年份、这一人物真正可能面对的开场。不要复用“有人等你犯错”之类通用句子。',
  ].join('\n');
  return {
    system,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    meta: {
      year,
      figure: fixed.name || player?.name || '',
      template: template.id,
    },
  };
}

export function parseHistoricalOpening(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let parsed = parseLooseJson(text);
  if (!parsed || typeof parsed !== 'object') {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = parseLooseJson(match[0]);
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const opening = String(parsed.opening || parsed.text || '').trim();
  if (opening.length < 40) return null;
  const choices = Array.isArray(parsed.choices)
    ? parsed.choices.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
    : [];
  return {
    title: String(parsed.title || '序章').trim().slice(0, 40),
    summary: String(parsed.summary || '').trim().slice(0, 200),
    opening: opening.slice(0, 1_200),
    location: String(parsed.location || '').trim().slice(0, 60),
    choices,
  };
}
