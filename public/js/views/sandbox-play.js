/**
 * 沙盒历险页。
 *
 * 关键差异：
 * - 这里是世界引擎，不是恋爱对话；
 * - 玩家输入自由行动，先做本地 d20 判定，再交给 AI 叙事；
 * - AI 必须返回 <sandbox> 状态块，页面据此更新人物、世界、关系和任务；
 * - 所有读写都在 sandboxSaves 内，不触碰恋爱存档。
 */

import {
  SANDBOX_LIMITS,
  getHistoricalOverallLabel,
  getHistoricalTemplate,
  getProvider,
  getSandboxAbilities,
  getSandboxCategory,
  getSandboxDifficulty,
} from '../core/constants.js';
import { describeAging, effectiveAbility } from '../core/sandbox-aging.js';
import { buildSandboxPrompt } from '../core/sandbox-prompt.js';
import {
  buildEventMonitorPrompt,
  collectEndedEventEffects,
  mergeEventUpdates,
  parseEventResponse,
} from '../core/sandbox-events.js';
import { buildLocalDecisionHints } from '../core/sandbox-hints.js';
import {
  buildAgencyRewritePrompt,
  detectPlayerAgency,
  parseAgencyRewrite,
  stripPlayerAgency,
} from '../core/sandbox-agency.js?v=2';
import {
  createSandboxCheck,
  describeSandboxCheck,
  isSandboxDefeated,
} from '../core/sandbox-engine.js';
import { sandboxDemoReply } from '../core/sandbox-demo.js';
import {
  extractSandboxPayload,
  getSandboxStreamingVisibleText,
  splitDecisionHints,
} from '../core/sandbox-parse.js';
import {
  clone,
  countChars,
  createId,
  downloadJson,
  formatNumber,
  formatShortTime,
  isWritingComposition,
  normalizeUsage,
  truncateText,
} from '../core/utils.js';
import {
  applySandboxStatePatch,
  createSandboxChronicle,
  formatGameDate,
  formatHistoricalYear,
  sandboxSaveFilename,
} from '../data/sandbox-schemas.js';
import { richText } from '../ui/components.js';
import {
  autoGrow,
  h,
  icon,
  isNearBottom,
  scrollToBottom,
} from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { completeChat, streamChat } from '../services/ai.js';
import { toast, toastError } from '../ui/toast.js';

export async function render(root, app) {
  const { store } = app;
  const initial = store.getActiveSandboxSave();
  if (!initial) {
    app.navigate('sandbox');
    return { cleanup() {} };
  }

  let save = initial;
  let streaming = false;
  let abortController = null;
  let rawStream = '';
  let pendingElement = null;
  let pendingContent = null;
  let errorCard = null;
  let maxTokenNoticeShown = false;
  let activeTab = 'character';
  let feedAutoScroll = true;
  let eventMonitorQueue = Promise.resolve();
  let eventMonitorRunning = false;

  const worldbook = store.getSandboxWorldbook(save.worldbookId);
  const category = getSandboxCategory(save.category);

  const feed = h('div', { class: 'sandbox-story-feed', id: 'sandbox-story-feed' });
  const choicesBar = h('div', { class: 'sandbox-choices-bar' });
  const statusPanel = h('aside', { class: 'sandbox-status-pane', id: 'sandbox-status-pane' });
  const headerMeta = h('div', { class: 'sandbox-play-meta' });
  const headerTitle = h('h1', { class: 'sandbox-play-title', text: save.name });
  const ruleChip = h('span', { class: 'sandbox-rule-chip' });
  const endedBanner = h('div', { class: 'sandbox-ended-banner', hidden: true });
  const textarea = h('textarea', {
    class: 'textarea sandbox-action-input',
    id: 'sandbox-action-input',
    rows: 1,
    maxLength: SANDBOX_LIMITS.maxActionChars,
    placeholder: '输入你的行动……例如：我先在门外听一会儿，再绕到后院看看。',
    'aria-label': '输入行动',
  });
  const sendButton = h(
    'button',
    { class: 'sandbox-send-btn', type: 'submit', 'aria-label': '执行行动', title: '执行行动' },
    icon('send'),
  );
  const stopButton = h(
    'button',
    {
      class: 'sandbox-stop-btn',
      type: 'button',
      hidden: true,
      'aria-label': '停止生成',
      onclick: () => abortController?.abort(),
    },
    icon('stop'),
    h('span', { text: '停止' }),
  );
  const composerHint = h('div', { class: 'sandbox-composer-hint' });

  const form = h(
    'form',
    {
      class: 'sandbox-action-bar',
      onsubmit: (event) => {
        event.preventDefault();
        sendAction(textarea.value);
      },
    },
    h(
      'div',
      { class: 'sandbox-input-wrap' },
      textarea,
      h('div', { class: 'sandbox-input-side' }, stopButton, sendButton),
    ),
    composerHint,
  );

  const page = h(
    'div',
    { class: 'page page-sandbox-play' },
    h(
      'header',
      { class: 'sandbox-play-header' },
      h(
        'div',
        { class: 'sandbox-play-heading' },
        h('a', { class: 'sandbox-back', href: '#/sandbox', 'aria-label': '返回沙盒大厅' }, icon('arrowLeft')),
        h(
          'div',
          {},
          h(
            'div',
            { class: 'sandbox-play-kicker' },
            h('span', { class: 'sandbox-category-pill' }, icon(category.icon), h('span', { text: category.shortLabel })),
            ruleChip,
            h('span', { class: 'sandbox-demo-pill', text: '独立沙盒' }),
          ),
          headerTitle,
          headerMeta,
        ),
      ),
      h(
        'div',
        { class: 'sandbox-play-actions' },
        h(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: openChronicle,
          },
          icon('journal'),
          h('span', { text: '编年史' }),
        ),
        h(
          'a',
          { class: 'btn btn-ghost btn-sm', href: '#/sandbox/worldbooks' },
          icon('scroll'),
          h('span', { text: '世界书' }),
        ),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: exportSave,
          },
          icon('download'),
          h('span', { text: '导出' }),
        ),
      ),
    ),
    endedBanner,
    h(
      'div',
      { class: 'sandbox-play-layout' },
      h(
        'section',
        { class: 'sandbox-story-pane' },
        feed,
        choicesBar,
        form,
      ),
      statusPanel,
    ),
  );

  root.appendChild(page);
  textarea.addEventListener('input', () => {
    autoGrow(textarea, 150);
    updateComposer();
  });
  textarea.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isWritingComposition(event)
    ) {
      event.preventDefault();
      sendAction(textarea.value);
    }
  });
  feed.addEventListener('scroll', () => {
    feedAutoScroll = isNearBottom(feed, 120);
  });

  renderHeader();
  renderFeed();
  renderChoices();
  renderStatus();
  updateComposer();
  requestAnimationFrame(() => {
    scrollToBottom(feed, 'auto');
    textarea.focus({ preventScroll: true });
    autoGrow(textarea, 150);
  });

  function currentSave() {
    return store.getSandboxSave(save.id) || save;
  }

  function renderHeader() {
    save = currentSave();
    headerTitle.textContent = save.name;
    const yearLabel = worldbook?.era?.enabled
      ? formatHistoricalYear(save.world.date.year)
      : `${save.world.date.year} 年`;
    headerMeta.replaceChildren(
      h('span', {}, icon('scroll'), h('span', { text: worldbook?.name || '世界书已移除' })),
      h('span', {}, icon('clock'), h('span', { text: `${yearLabel} ${save.world.time}` })),
      h('span', {}, icon('pin'), h('span', { text: save.world.location })),
      h('span', {}, icon('dice'), h('span', { text: `第 ${save.turn} 回合 · ${getSandboxDifficulty(save.difficulty).label}` })),
    );
    const enabledRules = store.state.sandboxPlugins.filter((plugin) => plugin.enabled);
    ruleChip.replaceChildren(
      icon('plug'),
      h('span', {
        text: enabledRules.length ? `${enabledRules.length} 条沙盒规则` : '无额外规则',
      }),
    );
    ruleChip.classList.toggle('is-empty', !enabledRules.length);
    const defeated = isSandboxDefeated(save) || save.status === 'ended';
    endedBanner.hidden = !defeated;
    if (defeated) {
      endedBanner.replaceChildren(
        h('span', { class: 'sandbox-ended-icon' }, icon('warning')),
        h(
          'div',
          {},
          h('strong', { text: '本世已终' }),
          h('p', {
            text: '角色的生命已经耗尽。你可以导出这段历程，或回到大厅重新开始一个世界。',
          }),
        ),
        h(
          'a',
          { class: 'btn btn-primary btn-sm', href: '#/sandbox/new' },
          icon('plus'),
          h('span', { text: '开始新历险' }),
        ),
      );
    }
    document.title = `${save.name} · 沙盒历险 · 暖屿`;
    app.updateTokenHud();
  }

  function renderFeed() {
    feed.replaceChildren();
    save = currentSave();
    const messages = save.messages || [];
    if (!messages.length) {
      feed.appendChild(
        h('div', { class: 'sandbox-feed-empty' }, h('p', { text: '这个世界还没有序章。' })),
      );
      return;
    }
    for (const message of messages) {
      feed.appendChild(renderMessage(message));
    }
    if (errorCard) feed.appendChild(errorCard);
    requestAnimationFrame(() => scrollToBottom(feed, 'auto'));
  }

  function renderMessage(message) {
    if (message.role === 'user') {
      return h(
        'article',
        { class: 'sandbox-action-message', 'data-message-id': message.id },
        h(
          'div',
          { class: 'sandbox-action-label' },
          icon('footprints'),
          h('span', { text: '你的行动' }),
          h('time', { text: formatShortTime(message.timestamp) }),
        ),
        h('p', { class: 'sandbox-action-text', text: message.content }),
        message.check ? renderCheckCard(message.check) : null,
      );
    }
    return h(
      'article',
      { class: 'sandbox-narrative-message', 'data-message-id': message.id },
      h(
        'div',
        { class: 'sandbox-narrative-label' },
        h('span', { class: 'sandbox-narrative-mark' }, icon(category.icon)),
        h('span', { text: `${worldbook?.name || category.label} · 世界叙事` }),
        h('time', { text: formatShortTime(message.timestamp) }),
      ),
      h('div', { class: 'sandbox-narrative-body' }, richText(message.content)),
      message.hints?.length
        ? h(
            'div',
            { class: 'sandbox-decision-hints' },
            h(
              'div',
              { class: 'sandbox-decision-hints-head' },
              icon('compass'),
              h('strong', { text: '思路提示' }),
              h('span', { text: '仅供参考，不是选项，不替你做决定' }),
            ),
            h(
              'ol',
              {},
              ...message.hints.map((hint) => h('li', { text: hint })),
            ),
          )
        : null,
    );
  }

  function renderCheckCard(check) {
    const detail = describeSandboxCheck(check);
    return h(
      'details',
      {
        class: `sandbox-check-card outcome-${check.tone || 'neutral'}`,
        open: check.outcome === '失败' || check.outcome === '大失败',
      },
      h(
        'summary',
        {},
        icon('dice'),
        h('strong', { text: detail?.headline || `判定 · ${check.outcome}` }),
        h('span', { class: 'check-formula', text: detail?.formula || '' }),
      ),
      h(
        'div',
        { class: 'sandbox-check-body' },
        h('p', { text: check.instruction }),
        h('p', { class: 'sandbox-check-reason', text: check.explanation || '' }),
        h(
          'div',
          { class: 'sandbox-check-meta' },
          h('span', {
            text: `属性：${check.attributeLabel} ${check.score}${
              check.agingPenalty ? `（原始 ${check.rawScore}，衰老 -${check.agingPenalty}）` : ''
            }`,
          }),
          h('span', { text: `修正 ${check.modifier >= 0 ? '+' : ''}${check.modifier}` }),
          h('span', { text: `DC ${check.dc}` }),
          h('span', { text: getSandboxDifficulty(check.difficulty).label }),
        ),
      ),
    );
  }

  function appendUserMessage(message) {
    feed.appendChild(renderMessage(message));
    if (errorCard) {
      errorCard.remove();
      errorCard = null;
    }
    requestAnimationFrame(() => scrollToBottom(feed));
  }

  function appendAssistantMessage(message) {
    feed.appendChild(renderMessage(message));
    requestAnimationFrame(() => scrollToBottom(feed));
  }

  function pendingBubble() {
    pendingContent = h('div', { class: 'sandbox-narrative-body' }, h('span', { class: 'sandbox-typing' }, h('span'), h('span'), h('span')));
    pendingElement = h(
      'article',
      { class: 'sandbox-narrative-message is-pending' },
      h(
        'div',
        { class: 'sandbox-narrative-label' },
        h('span', { class: 'sandbox-narrative-mark' }, icon(category.icon)),
        h('span', { text: '世界正在回应' }),
      ),
      pendingContent,
    );
    feed.appendChild(pendingElement);
    requestAnimationFrame(() => scrollToBottom(feed));
    return pendingElement;
  }

  function paintPending(text) {
    if (!pendingContent) return;
    pendingContent.replaceChildren(richText(text || ''));
    if (!text) {
      pendingContent.appendChild(
        h('span', { class: 'sandbox-typing' }, h('span'), h('span'), h('span')),
      );
    }
    if (feedAutoScroll) scrollToBottom(feed, 'auto');
  }

  function removePending() {
    pendingElement?.remove();
    pendingElement = null;
    pendingContent = null;
  }

  function renderChoices() {
    save = currentSave();
    choicesBar.replaceChildren();
    if (streaming || isSandboxDefeated(save) || save.status === 'ended') {
      choicesBar.hidden = true;
      return;
    }
    const choices = save.world.scene.choices || [];
    if (!choices.length) {
      choicesBar.hidden = true;
      return;
    }
    choicesBar.hidden = false;
    choicesBar.replaceChildren(
      h('span', { class: 'sandbox-choices-label', text: '可尝试' }),
      ...choices.map((choice) =>
        h(
          'button',
          {
            class: 'sandbox-choice',
            type: 'button',
            onclick: () => {
              textarea.value = choice;
              autoGrow(textarea, 150);
              textarea.focus({ preventScroll: true });
              updateComposer();
            },
          },
          h('span', { text: choice }),
          icon('cornerDownLeft'),
        ),
      ),
      h('span', { class: 'sandbox-choices-free', text: '也可以输入任何其他行动' }),
    );
  }

  function renderStatus() {
    save = currentSave();
    const status = save.status === 'ended' || isSandboxDefeated(save);
    const abilities =
      category.id === 'historical' && save.player.template !== 'legacy'
        ? getSandboxAbilities(category.id, save.player.template)
        : category.attributes;
    const attributes = abilities.map((attribute) => {
      const raw = save.player.attributes?.[attribute.key] ?? 8;
      const effective =
        category.id === 'historical' && save.player.template !== 'legacy'
          ? effectiveAbility(raw, {
              e: save.player.agingE,
              templateId: save.player.template,
              abilityKey: attribute.key,
            }).effective
          : raw;
      return { ...attribute, value: raw, effective };
    });
    const tabs = [
      { id: 'character', label: '人物', icon: 'persona' },
      { id: 'resources', label: '资源', icon: 'bag' },
      { id: 'inventory', label: '行囊', icon: 'bag' },
      { id: 'relations', label: '关系', icon: 'users' },
      { id: 'quests', label: '任务', icon: 'scrollText' },
      { id: 'events', label: '事件', icon: 'compass' },
    ];
    const tabBody = h('div', { class: 'sandbox-status-tab-body' });

    function renderTab() {
      if (activeTab === 'character') {
        tabBody.replaceChildren(
          h(
            'div',
            { class: 'sandbox-tab-inner' },
            ...(category.id === 'historical'
              ? [
                  h(
                    'div',
                    { class: 'sandbox-status-block' },
                    h('h4', { text: '人物模板' }),
                    h('p', {
                      text: `${
                        save.player.template === 'legacy'
                          ? '旧档六维'
                          : getHistoricalTemplate(save.player.template).label
                      } · 总点 ${save.player.totalPoints ?? '—'} / 108 · ${
                        save.player.template === 'legacy'
                          ? '旧档评价'
                          : getHistoricalOverallLabel(
                              save.player.totalPoints,
                              save.player.template,
                            )
                      }`,
                    }),
                    h('p', {
                      text: describeAging(save.player.agingE, save.player.template).text,
                    }),
                  ),
                ]
              : []),
            h(
              'div',
              { class: 'sandbox-attribute-list' },
              ...attributes.map((attribute) =>
                h(
                  'div',
                  { class: 'sandbox-attribute-row' },
                  h('span', { text: attribute.label }),
                  h('strong', { text: String(attribute.value) }),
                  h(
                    'small',
                    {
                      text:
                        attribute.effective !== attribute.value
                          ? `有效 ${attribute.effective} · ${attribute.hint}`
                          : attribute.hint,
                    },
                  ),
                ),
              ),
            ),
            h(
              'div',
              { class: 'sandbox-status-block' },
              h('h4', { text: '身份连带资源' }),
              save.player.resources?.length
                ? h(
                    'div',
                    { class: 'sandbox-resource-list' },
                    ...save.player.resources.map((resource) =>
                      h(
                        'div',
                        { class: 'sandbox-resource-row' },
                        h('span', { text: resource.name }),
                        h('strong', {
                          text: `${resource.value || '未记录'}${
                            resource.unit ? ` ${resource.unit}` : ''
                          }`,
                        }),
                        resource.note ? h('small', { text: resource.note }) : null,
                      ),
                    ),
                  )
                : h('p', {
                    class: 'sandbox-status-empty',
                    text: '尚未记录。完成一轮对话后，系统会按当前身份和局势生成国库、粮草、兵力等资源。',
                  }),
            ),
            save.player.traits?.length
              ? h(
                  'div',
                  { class: 'sandbox-status-block' },
                  h('h4', { text: '特质' }),
                  h(
                    'div',
                    { class: 'sandbox-chip-list' },
                    ...save.player.traits.map((trait) =>
                      h('span', { class: 'sandbox-mini-chip', text: trait }),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { class: 'sandbox-status-block' },
              h('h4', { text: '状态与技能' }),
              h(
                'div',
                { class: 'sandbox-chip-list' },
                ...(save.player.conditions?.length
                  ? save.player.conditions.map((item) =>
                      h('span', { class: 'sandbox-mini-chip is-warn', text: item }),
                    )
                  : [
                      h('span', {
                        class: 'sandbox-mini-chip is-muted',
                        text: '无异常状态',
                      }),
                    ]),
                ...(save.player.skills || []).map((item) =>
                  h('span', { class: 'sandbox-mini-chip', text: item }),
                ),
              ),
            ),
            save.player.background
              ? h(
                  'div',
                  { class: 'sandbox-status-block' },
                  h('h4', { text: '过往' }),
                  h('p', {
                    class: 'sandbox-status-text',
                    text: truncateText(save.player.background, 280),
                  }),
                )
              : null,
          ),
        );
      } else if (activeTab === 'resources') {
        tabBody.replaceChildren(
          h(
            'div',
            { class: 'sandbox-status-block' },
            h('h4', { text: '身份连带资源' }),
            h('p', {
              class: 'sandbox-status-text',
              text: `按「${save.player.identity || save.player.title || '当前身份'}」与当前局势实时生成，不固定。`,
            }),
            save.player.resources?.length
              ? h(
                  'div',
                  { class: 'sandbox-resource-list' },
                  ...save.player.resources.map((resource) =>
                    h(
                      'div',
                      { class: 'sandbox-resource-row' },
                      h('span', { text: resource.name }),
                      h('strong', {
                        text: `${resource.value || '未记录'}${
                          resource.unit ? ` ${resource.unit}` : ''
                        }`,
                      }),
                      resource.note ? h('small', { text: resource.note }) : null,
                    ),
                  ),
                )
              : h('p', {
                  class: 'sandbox-status-empty',
                  text: '尚未记录。完成一轮对话后，系统会按当前身份和局势生成国库、粮草、兵力等资源。',
                }),
          ),
        );
      } else if (activeTab === 'inventory') {
        tabBody.replaceChildren(
          save.player.inventory.length
            ? h(
                'div',
                { class: 'sandbox-inventory-list' },
                ...save.player.inventory.map((item) =>
                  h(
                    'div',
                    { class: 'sandbox-inventory-row' },
                    h('span', { class: 'sandbox-inventory-icon' }, icon('bag')),
                    h(
                      'div',
                      {},
                      h('strong', { text: item.name }),
                      item.note ? h('small', { text: item.note }) : null,
                    ),
                    h('span', { class: 'sandbox-inventory-qty', text: `×${item.qty}` }),
                  ),
                ),
              )
            : h('p', { class: 'sandbox-status-empty', text: '行囊空空。' }),
          h(
            'div',
            { class: 'sandbox-status-block' },
            h('h4', { text: '货币' }),
            h('p', { class: 'sandbox-money-line', text: `${formatNumber(save.player.money)} ${save.player.currency}` }),
          ),
        );
      } else if (activeTab === 'relations') {
        tabBody.replaceChildren(
          save.world.relationships.length
            ? h(
                'div',
                { class: 'sandbox-relationship-list' },
                ...save.world.relationships.map((item) =>
                  h(
                    'div',
                    { class: 'sandbox-relationship-row' },
                    h(
                      'div',
                      { class: 'sandbox-relationship-head' },
                      h('strong', { text: item.name }),
                      h('span', {
                        class: `sandbox-attitude ${item.attitude < -20 ? 'is-hostile' : item.attitude > 20 ? 'is-friendly' : ''}`.trim(),
                        text: `${item.attitude >= 0 ? '+' : ''}${item.attitude}`,
                      }),
                    ),
                    h('div', { class: 'sandbox-attitude-track' }, h('span', { style: { width: `${Math.abs(item.attitude)}%` } })),
                    item.note ? h('small', { text: item.note }) : null,
                  ),
                ),
              )
            : h('p', { class: 'sandbox-status-empty', text: '还没有记录任何关系。' }),
        );
      } else if (activeTab === 'quests') {
        tabBody.replaceChildren(
          save.world.quests.length
            ? h(
                'div',
                { class: 'sandbox-quest-list' },
                ...save.world.quests.map((quest) =>
                  h(
                    'div',
                    { class: 'sandbox-quest-row' },
                    h(
                      'div',
                      { class: 'sandbox-quest-head' },
                      h('strong', { text: quest.title }),
                      h('span', { class: `sandbox-quest-status ${quest.status === '已完成' ? 'is-done' : ''}`.trim(), text: quest.status }),
                    ),
                    quest.note ? h('small', { text: quest.note }) : null,
                  ),
                ),
              )
            : h('p', { class: 'sandbox-status-empty', text: '还没有记录任务。' }),
        );
      } else {
        const visibleEvents = (save.events || []).filter(
          (event) => event.visibility !== 'hidden',
        );
        tabBody.replaceChildren(
          visibleEvents.length
            ? h(
                'div',
                { class: 'sandbox-event-list' },
                ...visibleEvents
                  .slice()
                  .reverse()
                  .map((event) =>
                    h(
                      'div',
                      { class: 'sandbox-event-row' },
                      h(
                        'div',
                        { class: 'sandbox-event-head' },
                        h('strong', { text: event.title }),
                        h('span', {
                          class: `sandbox-event-status ${
                            event.status === 'ended' ? 'is-ended' : ''
                          }`.trim(),
                          text: event.status === 'ended' ? '已结束' : '进行中',
                        }),
                      ),
                      event.summary ? h('p', { text: event.summary }) : null,
                      event.participants?.length
                        ? h('small', {
                            text: `参与者：${event.participants.join('、')}`,
                          })
                        : null,
                      event.developments?.length
                        ? h('small', {
                            text: `最新进展：${event.developments.at(-1)}`,
                          })
                        : null,
                    ),
                  ),
              )
            : h('p', {
                class: 'sandbox-status-empty',
                text: '暂无公开事件。后台仍会在每次对话后检测事件进展。',
              }),
        );
      }
    }

    statusPanel.replaceChildren(
      h(
        'div',
        { class: 'sandbox-character-card' },
        h(
          'div',
          { class: 'sandbox-character-head' },
          h('span', { class: 'sandbox-character-avatar' }, icon(category.icon)),
          h(
            'div',
            {},
            h('h2', { text: save.player.name }),
            h('p', { text: `${save.player.title} · ${save.player.realm}` }),
            h('small', {
              text:
                save.player.identity &&
                save.player.identity !== save.player.title
                  ? save.player.identity
                  : save.player.origin || '身份未定',
            }),
          ),
          h(
            'button',
            { class: 'icon-btn subtle', type: 'button', title: '校正状态', 'aria-label': '校正状态', onclick: openStateEditor },
            icon('edit'),
          ),
        ),
        h(
          'div',
          { class: 'sandbox-vitals' },
          vitalBar('生命', save.player.health, 100, 'health'),
          vitalBar('精力', save.player.energy, 100, 'energy'),
          vitalBar('危险', save.world.danger, 100, 'danger'),
        ),
        h(
          'div',
          { class: 'sandbox-character-facts' },
          h('span', {}, icon('pin'), h('span', { text: save.world.location })),
          h('span', {}, icon('clock'), h('span', { text: `${formatGameDate(save.world.date)} ${save.world.time}` })),
          h('span', {}, icon('bag'), h('span', { text: `${formatNumber(save.player.money)} ${save.player.currency}` })),
          h('span', {}, icon('star'), h('span', { text: `声望 ${save.player.reputation} · 恶名 ${save.player.notoriety}` })),
        ),
        status
          ? h('div', { class: 'sandbox-status-dead', text: '角色已倒下。可校正状态或开始新的历险。' })
          : null,
      ),
      h(
        'div',
        { class: 'sandbox-scene-card' },
        h(
          'div',
          { class: 'sandbox-scene-head' },
          h('span', { class: 'sandbox-scene-label', text: '当前场景' }),
          h('span', { class: 'sandbox-scene-turn', text: `第 ${save.turn} 回合` }),
        ),
        h('h3', { text: save.world.scene.title || '未命名场景' }),
        h('p', { text: save.world.scene.summary || '世界还没有给出新的场景摘要。' }),
        h(
          'div',
          { class: 'sandbox-scene-weather' },
          h('span', {}, icon('sun'), h('span', { text: save.world.weather })),
          save.checksEnabled
            ? h('span', {}, icon('dice'), h('span', { text: '行动判定已开启' }))
            : h('span', {}, icon('info'), h('span', { text: '自由叙事，无判定' })),
        ),
      ),
      h(
        'div',
        { class: 'sandbox-status-tabs', role: 'tablist' },
        ...tabs.map((tab) =>
          h(
            'button',
            {
              class: `sandbox-status-tab ${activeTab === tab.id ? 'is-active' : ''}`.trim(),
              type: 'button',
              role: 'tab',
              'aria-selected': activeTab === tab.id ? 'true' : 'false',
              onclick: () => {
                activeTab = tab.id;
                renderStatus();
              },
            },
            icon(tab.icon),
            h('span', { text: tab.label }),
          ),
        ),
      ),
      tabBody,
    );
    renderTab();
  }

  function vitalBar(label, value, max, kind) {
    const safeValue = Math.max(0, Math.min(max, Number(value) || 0));
    return h(
      'div',
      { class: `sandbox-vital ${kind}` },
      h('div', { class: 'sandbox-vital-head' }, h('span', { text: label }), h('strong', { text: `${safeValue}` })),
      h('div', { class: 'sandbox-vital-track' }, h('span', { style: { width: `${(safeValue / max) * 100}%` } })),
    );
  }

  function updateComposer() {
    const defeated = isSandboxDefeated(currentSave()) || currentSave().status === 'ended';
    const empty = !textarea.value.trim();
    sendButton.disabled = streaming || empty || defeated;
    stopButton.hidden = !streaming;
    textarea.disabled = streaming || defeated;
    composerHint.replaceChildren(
      h('span', { text: streaming ? '世界正在推演，本轮结束后才能继续行动。' : 'Enter 执行 · Shift+Enter 换行 · 自由输入任何行动' }),
      h(
        'span',
        { class: 'sandbox-composer-tokens' },
        streaming ? '生成中…' : `${countChars(textarea.value)} / ${SANDBOX_LIMITS.maxActionChars}`,
      ),
    );
    form.classList.toggle('is-streaming', streaming);
    sendButton.classList.toggle('is-stop', streaming);
  }

  function queueEventMonitor(saveId) {
    if (store.state.settings.eventTracking === false) return;
    eventMonitorQueue = eventMonitorQueue
      .then(() => monitorEventTurn(saveId))
      .catch((error) => {
        store.warn(
          'sandbox.event.monitor.failed',
          '后台事件监控失败，本轮不改动人物点数。',
          {
            archiveId: saveId,
            detail: { message: String(error?.message || error) },
          },
        );
      });
  }

  async function monitorEventTurn(saveId) {
    const current = store.state.sandboxSaves.find((item) => item.id === saveId);
    if (!current || current.player?.template === 'legacy') return;
    const settings = clone(store.state.settings);
    if (settings.demoMode) return;
    const difficulty = getSandboxDifficulty(current.difficulty);
    const worldbook = store.getSandboxWorldbook(current.worldbookId);
    const prompt = buildEventMonitorPrompt({
      save: current,
      worldbook,
      difficulty,
      messages: current.messages.slice(-12),
      events: current.events || [],
    });
    eventMonitorRunning = true;
    try {
      const result = await completeChat({
        settings: {
          ...settings,
          maxTokens: 700,
          temperature: 0.2,
          stream: false,
        },
        messages: prompt.messages,
        apiKey: app.getEffectiveApiKey(settings.provider),
        useCache: false,
      });
      const parsed = parseEventResponse(result.text);
      if (!parsed.events.length) return;
      const merged = mergeEventUpdates(current.events || [], parsed.events, {
        turn: current.turn,
        ultra: difficulty.eventMode === 'ultra',
      });
      const settlement = collectEndedEventEffects(
        { ...current, events: merged },
        merged,
      );
      let nextPlayer = current.player;
      if (Object.keys(settlement.attributeDeltas).length) {
        const attributes = { ...current.player.attributes };
        for (const [key, delta] of Object.entries(settlement.attributeDeltas)) {
          attributes[key] = Math.max(
            3,
            Math.min(18, Number(attributes[key] || 3) + delta),
          );
        }
        nextPlayer = applySandboxStatePatch(current, { attributes }).player;
      }
      const usage = normalizeUsage(
        result.usage,
        prompt.messages.map((message) => message.content).join('\n'),
        result.text,
      );
      store.update(
        (state) => {
          const target = state.sandboxSaves.find((item) => item.id === saveId);
          if (!target) return;
          target.events = settlement.events;
          target.player = nextPlayer;
          target.updatedAt = new Date().toISOString();
        },
        { reason: 'sandbox-event-monitor', archiveId: saveId },
      );
      if (usage?.totalTokens) {
        store.recordUsage({ archiveId: saveId, provider: settings.provider, usage });
        app.updateTokenHud();
      }
      store.info(
        'sandbox.event.monitor',
        `后台事件监控：${parsed.events.length} 条更新，${
          settlement.settled ? '已结算事件效果' : '暂无结束事件'
        }。`,
        {
          archiveId: saveId,
          detail: {
            ultra: difficulty.eventMode === 'ultra',
            updates: parsed.events.length,
            settled: settlement.settled,
            deltas: settlement.attributeDeltas,
          },
        },
      );
      if (currentSave()?.id === saveId && document.querySelector('.page-sandbox-play')) {
        save = currentSave();
        renderStatus();
        renderHeader();
      }
    } catch (error) {
      store.warn(
        'sandbox.event.monitor.failed',
        `后台事件监控失败：${error.message}`,
        { archiveId: saveId },
      );
    } finally {
      eventMonitorRunning = false;
    }
  }

  async function enforcePlayerAgency(narrative, action, saveState) {
    const risk = detectPlayerAgency(narrative, saveState.player?.name);
    if (!risk.risky) return narrative;
    const settings = clone(store.state.settings);
    if (settings.demoMode || settings.agencyGuard === false) return narrative;
    const prompt = buildAgencyRewritePrompt({
      narrative,
      playerName: saveState.player?.name,
      action,
    });
    const apiKey = app.getEffectiveApiKey(settings.provider);
    if (!apiKey && !settings.useServerKey) {
      store.warn(
        'sandbox.agency.guard.fallback',
        '检测到玩家代行叙事，但没有可用 AI，已本地裁剪玩家动作。',
        { archiveId: saveState.id, detail: { evidence: risk.evidence } },
      );
      return stripPlayerAgency(narrative, saveState.player?.name);
    }
    try {
      const result = await completeChat({
        settings: {
          ...settings,
          maxTokens: Math.max(900, Number(settings.maxTokens) || 1_200),
          temperature: 0.25,
          stream: false,
        },
        messages: prompt.messages,
        apiKey,
        useCache: false,
      });
      const rewritten = parseAgencyRewrite(result.text);
      const usage = normalizeUsage(
        result.usage,
        prompt.messages.map((message) => message.content).join('\n'),
        result.text,
      );
      if (usage?.totalTokens) {
        store.recordUsage({ archiveId: saveState.id, provider: settings.provider, usage });
        app.updateTokenHud();
      }
      if (!rewritten) {
        return stripPlayerAgency(narrative, saveState.player?.name);
      }
      const stillRisky = detectPlayerAgency(rewritten, saveState.player?.name);
      if (stillRisky.risky) {
        store.warn(
          'sandbox.agency.guard.still.risky',
          '玩家自主权校正后仍检测到代行叙事，已再次本地裁剪。',
          { archiveId: saveState.id, detail: { evidence: stillRisky.evidence } },
        );
        return stripPlayerAgency(rewritten, saveState.player?.name);
      }
      store.info(
        'sandbox.agency.guard.rewritten',
        '检测到 AI 替玩家行动，已重写为世界与 NPC 视角。',
        { archiveId: saveState.id, detail: { evidence: risk.evidence } },
      );
      return rewritten;
    } catch (error) {
      store.warn(
        'sandbox.agency.guard.failed',
        `玩家自主权校正失败，已本地裁剪：${error.message}`,
        { archiveId: saveState.id, detail: { evidence: risk.evidence } },
      );
      return stripPlayerAgency(narrative, saveState.player?.name);
    }
  }

  async function sendAction(rawAction) {
    if (streaming) return;
    const action = String(rawAction || '').trim();
    if (!action) {
      textarea.focus();
      return;
    }
    save = currentSave();
    if (isSandboxDefeated(save) || save.status === 'ended') {
      toastError('这段历险已经结束。请开始新的世界，或校正状态。');
      return;
    }
    if (action.length > SANDBOX_LIMITS.maxActionChars) {
      toastError(`行动过长，请控制在 ${SANDBOX_LIMITS.maxActionChars} 字以内。`);
      return;
    }
    const check = createSandboxCheck({
      action,
      save,
      danger: save.world.danger,
    });
    const now = new Date().toISOString();
    const userMessage = {
      id: createId('sbmsg'),
      role: 'user',
      content: action,
      timestamp: now,
      check,
      opening: false,
    };
    const previousCheck = save.lastCheck;
    store.update(
      (state) => {
        const target = state.sandboxSaves.find((item) => item.id === save.id);
        if (!target) return;
        target.messages.push(userMessage);
        target.lastCheck = check;
        target.updatedAt = now;
        target.lastPlayedAt = now;
      },
      { reason: 'sandbox-action', archiveId: save.id },
    );
    textarea.value = '';
    autoGrow(textarea, 150);
    appendUserMessage(userMessage);
    renderChoices();
    renderHeader();
    updateComposer();
    await runGeneration({ action, check, userMessage, previousCheck });
  }

  async function runGeneration({ action, check, userMessage, previousCheck }) {
    const current = currentSave();
    const promptPlugins = store.getEnabledSandboxPlugins();
    const settingsSnapshot = clone(store.state.settings);
    let prompt;
    try {
      prompt = buildSandboxPrompt({
        save: current,
        worldbook: store.getSandboxWorldbook(current.worldbookId),
        plugins: promptPlugins,
        settings: settingsSnapshot,
        action,
        check,
      });
    } catch (error) {
      store.logError('sandbox.prompt.failed', error, { archiveId: current.id });
      rollbackAction(userMessage, previousCheck, action);
      toastError(`无法构建这一轮的世界：${error.message}`);
      return;
    }

    const configuredMaxTokens = Number(settingsSnapshot.maxTokens) || 800;
    const effectiveMaxTokens = Math.min(
      SANDBOX_LIMITS.hardMaxTokens,
      Math.max(
        SANDBOX_LIMITS.defaultMaxTokens,
        configuredMaxTokens,
        Number(prompt.meta.suggestedMaxTokens) || 0,
      ),
    );
    const requestSettings = { ...settingsSnapshot, maxTokens: effectiveMaxTokens };
    if (
      effectiveMaxTokens > configuredMaxTokens &&
      !settingsSnapshot.demoMode &&
      !maxTokenNoticeShown
    ) {
      maxTokenNoticeShown = true;
      toast(
        `沙盒需要更长的结构化输出：本轮上限临时提高到 ${effectiveMaxTokens} tokens（设置值 ${configuredMaxTokens}）。`,
        { type: 'info', duration: 6_000 },
      );
    }
    if (prompt.meta.pluginExcluded?.length) {
      store.warn(
        'sandbox.plugin.runtime.excluded',
        `部分沙盒规则因预算未注入：${prompt.meta.pluginExcluded.join('、')}。`,
        { archiveId: current.id },
      );
      toast(
        `部分沙盒规则因预算未注入：${prompt.meta.pluginExcluded.join('、')}。`,
        { type: 'warn', duration: 5_000 },
      );
    }

    const promptText = prompt.messages.map((message) => message.content).join('\n');
    const providerId = settingsSnapshot.provider;
    const providerMeta = getProvider(providerId);
    streaming = true;
    abortController = new AbortController();
    rawStream = '';
    pendingBubble();
    updateComposer();
    textarea.focus({ preventScroll: true });

    const requestLog = {
      mode: 'sandbox',
      category: current.category,
      worldbook: store.getSandboxWorldbook(current.worldbookId)?.name || null,
      year: current.world.date.year,
      turn: current.turn,
      actionChars: action.length,
      check: check ? { roll: check.roll, total: check.total, dc: check.dc, outcome: check.outcome } : null,
      provider: providerId,
      model: settingsSnapshot.model,
      demo: settingsSnapshot.demoMode,
      promptChars: prompt.meta.charCount,
      estimatedPromptTokens: prompt.meta.estimatedTokens,
      historyMessages: prompt.meta.historyMessages,
      worldEntries: prompt.meta.worldEntries,
      pluginCount: prompt.meta.pluginCount,
      pluginNames: prompt.meta.pluginNames,
      pluginChars: prompt.meta.pluginChars,
      maxTokensConfigured: configuredMaxTokens,
      maxTokensEffective: effectiveMaxTokens,
    };
    store.info(
      'sandbox.turn',
      settingsSnapshot.demoMode
        ? `演示模式推演沙盒第 ${current.turn} 回合。`
        : `向 ${providerMeta.label} · ${settingsSnapshot.model} 推演沙盒第 ${current.turn} 回合。`,
      { archiveId: current.id, detail: requestLog },
    );

    let resultText = '';
    let resultModel = settingsSnapshot.model;
    let resultProvider = providerId;
    let requestId = '';
    let usage = null;
    const startedAt = performance.now();

    try {
      if (settingsSnapshot.demoMode) {
        const demo = sandboxDemoReply({
          save: current,
          action,
          check,
          worldbook: store.getSandboxWorldbook(current.worldbookId),
        });
        resultText = demo.raw;
        resultModel = 'demo';
        resultProvider = 'demo';
        usage = demo.usage;
        rawStream = resultText;
        paintPending(getSandboxStreamingVisibleText(rawStream));
        await new Promise((resolve) => setTimeout(resolve, 180));
      } else if (settingsSnapshot.stream === false) {
        const result = await completeChat({
          settings: requestSettings,
          messages: prompt.messages,
          apiKey: app.getEffectiveApiKey(providerId),
          signal: abortController.signal,
          useCache: false,
        });
        resultText = result.text;
        resultModel = result.model || settingsSnapshot.model;
        requestId = result.requestId || '';
        usage = normalizeUsage(result.usage, promptText, resultText);
        rawStream = resultText;
        paintPending(getSandboxStreamingVisibleText(rawStream));
        app.markAIStatus('online');
      } else {
        const result = await streamChat({
          settings: requestSettings,
          messages: prompt.messages,
          apiKey: app.getEffectiveApiKey(providerId),
          signal: abortController.signal,
          onDelta: (_delta, fullText) => {
            rawStream = fullText;
            paintPending(getSandboxStreamingVisibleText(rawStream));
          },
        });
        resultText = result.text;
        resultModel = result.model || settingsSnapshot.model;
        requestId = result.requestId || '';
        usage = normalizeUsage(result.usage, promptText, resultText);
        rawStream = resultText;
        app.markAIStatus('online');
      }

      const parsed = extractSandboxPayload(resultText);
      const hintResult = splitDecisionHints(parsed.narrative);
      let narrative = hintResult.narrative.trim();
      const decisionHints = hintResult.hints;
      let statePatch = parsed.state;
      if (!narrative && statePatch) {
        narrative = '世界向前推进，但这一轮的叙事没有完整返回。你可以查看状态变化，再继续行动。';
      }
      if (!narrative) throw new Error('模型没有返回可显示的沙盒正文。');
      narrative = await enforcePlayerAgency(narrative, action, current);
      if (!statePatch) {
        store.warn(
          'sandbox.state.missing',
          '模型没有返回合法的 <sandbox> 状态块，本轮只保存叙事，世界状态保持不变。',
          { archiveId: current.id, detail: { rawChars: resultText.length } },
        );
        toast('本轮没有返回世界状态块，状态没有更新。可以继续行动，或校正状态。', {
          type: 'warn',
          duration: 5_000,
        });
      }

      const nonce = new Date().toISOString();
      const assistantMessage = {
        id: createId('sbmsg'),
        role: 'assistant',
        content: narrative,
        timestamp: nonce,
        check: null,
        opening: false,
        hints: decisionHints,
      };
      if (statePatch && current.player?.template !== 'legacy') {
        statePatch = { ...statePatch };
        delete statePatch.attributes;
        delete statePatch.agingE;
      }
      const nextState = statePatch
        ? applySandboxStatePatch(current, statePatch)
        : { player: current.player, world: current.world };
      const hintsEnabled = store
        .getEnabledSandboxPlugins()
        .some((plugin) => plugin.id === 'sb_plugin_decision_hints');
      const effectiveHints = decisionHints.length
        ? decisionHints
        : hintsEnabled
          ? buildLocalDecisionHints({
              ...current,
              player: nextState.player,
              world: nextState.world,
            })
          : [];
      assistantMessage.hints = effectiveHints;
      const defeated = Number(nextState.player.health) <= 0;
      store.update(
        (state) => {
          const target = state.sandboxSaves.find((item) => item.id === current.id);
          if (!target) return;
          target.player = nextState.player;
          target.world = nextState.world;
          target.messages.push(assistantMessage);
          target.turn += 1;
          target.lastCheck = check;
          target.updatedAt = nonce;
          target.lastPlayedAt = nonce;
          target.status = defeated ? 'ended' : 'active';
        },
        { reason: 'sandbox-turn', archiveId: current.id },
      );
      if (usage?.totalTokens && resultProvider !== 'demo') {
        store.recordUsage({ archiveId: current.id, provider: resultProvider, usage });
      }
      removePending();
      appendAssistantMessage(assistantMessage);
      save = currentSave();
      renderHeader();
      renderStatus();
      renderChoices();
      updateComposer();
      app.updateTokenHud();
      queueEventMonitor(current.id);
      store.info(
        'sandbox.turn.complete',
        `沙盒第 ${current.turn} 回合完成${defeated ? '，角色倒下' : ''}。`,
        {
          archiveId: current.id,
          detail: {
            durationMs: Math.round(performance.now() - startedAt),
            tokens: usage?.totalTokens || 0,
            provider: resultProvider,
            model: resultModel,
            requestId,
            hadState: Boolean(statePatch),
            turn: current.turn,
          },
        },
      );
    } catch (error) {
      const aborted =
        abortController?.signal.aborted ||
        error?.name === 'AbortError' ||
        error?.code === 'ABORTED';
      removePending();
      rollbackAction(userMessage, previousCheck, action);
      if (aborted) {
        store.info('sandbox.aborted', '已停止本轮沙盒生成。', { archiveId: current.id });
        toast('已停止生成，行动已放回输入框。', { type: 'info', duration: 2_500 });
      } else {
        store.logError('sandbox.ai.failed', error, { archiveId: current.id });
        errorCard = h(
          'div',
          { class: 'sandbox-error-card' },
          h('span', { class: 'sandbox-error-icon' }, icon('warning')),
          h(
            'div',
            {},
            h('strong', { text: '这一轮没有成功推演' }),
            h('p', { text: error?.message || 'AI 请求失败。' }),
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () => {
                errorCard?.remove();
                errorCard = null;
                textarea.value = action;
                sendAction(action);
              },
            },
            icon('refresh'),
            h('span', { text: '重试' }),
          ),
        );
        feed.appendChild(errorCard);
        toastError(error?.message || '沙盒生成失败。');
      }
      save = currentSave();
      renderStatus();
      renderChoices();
      updateComposer();
    } finally {
      streaming = false;
      abortController = null;
      updateComposer();
      textarea.focus({ preventScroll: true });
    }
  }

  function rollbackAction(userMessage, previousCheck, action) {
    save = currentSave();
    if (userMessage?.id) {
      store.update(
        (state) => {
          const target = state.sandboxSaves.find((item) => item.id === save.id);
          if (!target) return;
          target.messages = target.messages.filter((item) => item.id !== userMessage.id);
          target.lastCheck = previousCheck || null;
          target.updatedAt = new Date().toISOString();
        },
        { reason: 'sandbox-action-rolled-back', archiveId: save.id },
      );
      feed.querySelector(`[data-message-id="${userMessage.id}"]`)?.remove();
    }
    textarea.value = action;
    autoGrow(textarea, 150);
    updateComposer();
  }

  function openStateEditor() {
    save = currentSave();
    const health = h('input', { class: 'input', type: 'number', min: 0, max: 100, value: save.player.health });
    const energy = h('input', { class: 'input', type: 'number', min: 0, max: 100, value: save.player.energy });
    const money = h('input', { class: 'input', type: 'number', min: 0, value: save.player.money });
    const title = h('input', { class: 'input', maxLength: 80, value: save.player.title });
    const realm = h('input', { class: 'input', maxLength: 60, value: save.player.realm });
    const summary = h('textarea', { class: 'input textarea', rows: 3, maxLength: 600, value: save.world.scene.summary });
    const conditions = h('input', { class: 'input', maxLength: 300, value: (save.player.conditions || []).join('、'), placeholder: '用顿号分隔' });
    openModal({
      title: '校正世界状态',
      eyebrow: '手动修正',
      subtitle: '仅用于修正模型没有正确更新的数值与场景；不会伪造剧情。',
      size: 'md',
      body: h(
        'div',
        { class: 'form-stack' },
        h(
          'div',
          { class: 'form-grid three' },
          h('label', { class: 'form-field' }, h('span', { class: 'input-label', text: '生命' }), health),
          h('label', { class: 'form-field' }, h('span', { class: 'input-label', text: '精力' }), energy),
          h(
            'label',
            { class: 'form-field' },
            h('span', { class: 'input-label', text: `货币（${save.player.currency}）` }),
            money,
          ),
        ),
        h('label', { class: 'form-field' }, h('span', { class: 'input-label', text: '名号' }), title),
        h('label', { class: 'form-field' }, h('span', { class: 'input-label', text: '境界 / 位阶' }), realm),
        h('label', { class: 'form-field' }, h('span', { class: 'input-label', text: '状态（顿号分隔）' }), conditions),
        h('label', { class: 'form-field' }, h('span', { class: 'input-label', text: '当前场景摘要' }), summary),
      ),
      actions: [
        {
          label: '保存校正',
          variant: 'primary',
          onClick: () => {
            const next = applySandboxStatePatch(save, {
              health: Number(health.value),
              energy: Number(energy.value),
              money: Number(money.value),
              title: title.value,
              realm: realm.value,
              conditions: conditions.value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
              scene: { summary: summary.value },
            });
            store.update(
              (state) => {
                const target = state.sandboxSaves.find((item) => item.id === save.id);
                if (!target) return;
                target.player = next.player;
                target.world = next.world;
                target.status = next.player.health <= 0 ? 'ended' : 'active';
                target.updatedAt = new Date().toISOString();
              },
              { reason: 'sandbox-state-edited', archiveId: save.id },
            );
            store.info('sandbox.state.edited', '手动校正了沙盒状态。', { archiveId: save.id });
            save = currentSave();
            renderHeader();
            renderStatus();
            updateComposer();
            toast('世界状态已校正。', { type: 'success' });
          },
        },
        { label: '取消' },
      ],
    });
  }

  function openChronicle() {
    save = currentSave();
    const list = h('div', { class: 'sandbox-chronicle-list' });
    const renderList = () => {
      list.replaceChildren(
        ...(save.chronicles.length
          ? save.chronicles.map((chronicle) =>
              h(
                'article',
                { class: 'sandbox-chronicle-entry' },
                h('div', { class: 'sandbox-chronicle-head' }, h('strong', { text: `纪要 · 第 ${chronicle.rangeStart}–${chronicle.rangeEnd} 条` }), h('time', { text: new Date(chronicle.createdAt).toLocaleString('zh-CN') })),
                h('p', { text: chronicle.content }),
              ),
            )
          : [h('p', { class: 'sandbox-status-empty', text: '还没有编年史。游戏回合较多时，可以把旧剧情压缩成纪要，减少 token 消耗。' })]),
      );
    };
    renderList();
    const status = h('p', { class: 'muted small', text: `当前未压缩消息：${save.messages.length - save.summarizedUntil} 条` });
    openModal({
      title: '编年史',
      eyebrow: 'Long memory',
      subtitle: '把已经发生的剧情压缩成第三人称纪要，之后只把纪要放进提示词。',
      size: 'lg',
      body: h('div', {}, list, status),
      actions: [
        {
          label: '生成编年史',
          variant: 'primary',
          icon: 'journal',
          closeAfter: false,
          onClick: async () => {
            try {
              await generateChronicle(save, { list, status, renderList });
              return false;
            } catch (error) {
              toastError(`编年史生成失败：${error.message}`);
              return false;
            }
          },
        },
        { label: '关闭' },
      ],
    });
  }

  async function generateChronicle(current, { list, status, renderList }) {
    const start = Math.max(0, current.summarizedUntil);
    const messages = current.messages.slice(start);
    if (!messages.length) {
      toast('没有新的未压缩内容。', { type: 'info' });
      return;
    }
    const settings = clone(store.state.settings);
    const sourceText = messages
      .map((message) => `${message.role === 'user' ? '玩家行动' : '世界叙事'}：${message.content}`)
      .join('\n')
      .slice(0, 20_000);
    let summary = '';
    let usage = null;
    let model = settings.model;
    if (settings.demoMode) {
      summary = sourceText
        .split('\n')
        .filter((line) => line.startsWith('玩家行动'))
        .slice(-8)
        .map((line) => line.replace(/^玩家行动：/, '').slice(0, 40))
        .join('；');
      summary = `本阶段，玩家先后采取的行动包括：${summary || '继续探索世界'}。世界局势因此发生了变化。`;
    } else {
      const result = await completeChat({
        settings: { ...settings, maxTokens: 500, temperature: 0.3 },
        messages: [
          {
            role: 'system',
            content:
              '你是文字游戏编年史编辑。把给定章节压缩成 180–320 字的第三人称世界纪要。必须保留关键地点、人物、玩家的重要选择、后果、未解决线索与损失；不要编造未发生的事，不要写建议，不要用第二人称。',
          },
          { role: 'user', content: `世界：${worldbook?.name || current.category}\n请压缩以下剧情：\n${sourceText}` },
        ],
        apiKey: app.getEffectiveApiKey(settings.provider),
        useCache: false,
      });
      summary = result.text.trim();
      usage = normalizeUsage(result.usage, sourceText, summary);
      model = result.model || settings.model;
    }
    if (!summary) throw new Error('没有返回编年史内容。');
    const end = current.messages.length;
    const chronicle = createSandboxChronicle({
      content: summary,
      messageCount: messages.length,
      rangeStart: start,
      rangeEnd: end,
      model,
      usage,
    });
    store.update(
      (state) => {
        const target = state.sandboxSaves.find((item) => item.id === current.id);
        if (!target) return;
        target.chronicles.push(chronicle);
        target.summarizedUntil = end;
        target.updatedAt = new Date().toISOString();
      },
      { reason: 'sandbox-chronicle', archiveId: current.id },
    );
    if (usage?.totalTokens) {
      store.recordUsage({ archiveId: current.id, provider: settings.provider, usage });
    }
    store.info('sandbox.chronicle.created', '生成了一段沙盒编年史。', {
      archiveId: current.id,
      detail: { rangeStart: start, rangeEnd: end, chars: summary.length },
    });
    save = currentSave();
    status.textContent = `当前未压缩消息：${save.messages.length - save.summarizedUntil} 条`;
    renderList();
    app.updateTokenHud();
    toast('编年史已生成，后续提示词会优先使用它。', { type: 'success' });
  }

  function exportSave() {
    save = currentSave();
    downloadJson(sandboxSaveFilename(save), save);
    store.info('sandbox.exported', `导出了沙盒存档「${save.name}」。`, { archiveId: save.id });
    toast('沙盒存档已导出。', { type: 'success' });
  }

  return {
    cleanup() {
      abortController?.abort();
      abortController = null;
      pendingElement = null;
      pendingContent = null;
    },
  };
}
