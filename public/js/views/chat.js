/**
 * 主对话页。
 *
 * 布局：左侧 2/3 主对话，右侧 1/3 角色状态。
 * 输入体验：回车发送、Shift+Enter 换行、发送后输入框保持焦点。
 * 记忆：右侧显示日记；结束本章后，后续提示词只使用日记与最近未压缩对话。
 */

import {
  DIALOGUE_ANIMATIONS,
  LIMITS,
  STATUS_FIELDS,
  getProvider,
} from '../core/constants.js';
import { demoReply } from '../core/demo.js';
import {
  appendEmojiTail,
  extractAssistantPayload,
  getStreamingVisibleText,
} from '../core/parse.js';
import { buildChatPrompt } from '../core/prompt.js';
import {
  clone,
  countChars,
  formatCompactNumber,
  formatNumber,
  formatRelative,
  formatShortTime,
  isWritingComposition,
  normalizeUsage,
  safeColor,
  truncateText,
} from '../core/utils.js';
import { normalizeStatus } from '../data/schemas.js';
import { completeChat, streamChat } from '../services/ai.js';
import {
  exportArchiveBundle,
  exportArchivePersona,
  openDiaryGenerator,
  openDiaryViewer,
  openNpcEditor,
  openProtagonistEditor,
  openStatusEditor,
} from '../ui/archive-dialogs.js';
import { avatar, richText } from '../ui/components.js';
import {
  autoGrow,
  copyText,
  h,
  icon,
  isNearBottom,
  scrollToBottom,
} from '../ui/dom.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';

function combineUsage(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return {
    promptTokens: (left.promptTokens || 0) + (right.promptTokens || 0),
    completionTokens: (left.completionTokens || 0) + (right.completionTokens || 0),
    totalTokens: (left.totalTokens || 0) + (right.totalTokens || 0),
    estimated: Boolean(left.estimated || right.estimated),
  };
}

const STATUS_KEYS = STATUS_FIELDS.map((field) => field.key);

function fakeAbortError() {
  const error = new Error('已停止生成。');
  error.name = 'AbortError';
  error.code = 'ABORTED';
  return error;
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(fakeAbortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(fakeAbortError());
      },
      { once: true },
    );
  });
}

function mergeAIStatus(existing, patch) {
  if (!patch) return existing;
  const merged = { ...existing };
  for (const key of STATUS_KEYS) {
    if (typeof patch[key] === 'string' && patch[key].trim()) {
      merged[key] = patch[key].trim();
    }
  }
  if (!STATUS_KEYS.some((key) => merged[key])) return existing;
  merged.updatedAt = patch.updatedAt || new Date().toISOString();
  merged.source = 'ai';
  return normalizeStatus(merged, existing);
}

function animationLabel(id) {
  return DIALOGUE_ANIMATIONS.find((animation) => animation.id === id)?.label || '自然';
}

export async function render(root, app) {
  const { store } = app;
  const initialArchive = store.getActiveArchive();
  if (!initialArchive) {
    app.navigate('archives', { replace: true });
    return { cleanup() {} };
  }

  const persona = store.getPersona(initialArchive.personaId);
  const worldbook = store.getWorldbook(initialArchive.worldbookId);
  if (!persona) {
    root.appendChild(
      h(
        'div',
        { class: 'fatal-state' },
        h('h1', { text: '这个存档的人格不见了' }),
        h('p', { text: '请回到存档书架，为该存档选择可用的预设人格。' }),
        h('a', { class: 'btn btn-primary', href: '#/archives' }, h('span', { text: '返回存档' })),
      ),
    );
    return { cleanup() {} };
  }

  let streaming = false;
  let abortController = null;
  let pending = null;
  let rawStream = '';
  let paintFrame = 0;
  let lastErrorCard = null;
  let pluginTokenNoticeShown = false;
  let historyNoticeShown = false;

  const page = h('div', { class: 'page page-chat' });
  root.appendChild(page);

  /* ------------------------------------------------------------------ */
  /* 顶部                                                                */
  /* ------------------------------------------------------------------ */

  const npcCountChip = h('span', { class: 'chat-meta-chip' });
  const diaryCountChip = h('span', { class: 'chat-meta-chip' });
  const pluginChip = h('span', { class: 'chat-meta-chip plugin-active-chip', hidden: true });
  const statusToggleButton = h(
    'button',
    {
      class: 'btn btn-soft btn-sm status-toggle-btn',
      type: 'button',
      'aria-controls': 'chat-status-panel',
      'aria-expanded': 'false',
    },
    icon('persona'),
    h('span', { text: '状态' }),
  );

  const header = h(
    'header',
    { class: 'chat-head' },
    h(
      'div',
      { class: 'chat-head-copy' },
      h(
        'p',
        { class: 'eyebrow chat-eyebrow' },
        h('span', { class: 'chat-eyebrow-dot' }),
        h('span', { text: initialArchive.name }),
      ),
      h(
        'h1',
        { class: 'chat-title' },
        h('span', { text: persona.name }),
        h('span', { class: 'chat-title-x', text: '×' }),
        h('span', { class: 'chat-title-player', text: initialArchive.protagonist.name }),
      ),
      h(
        'div',
        { class: 'chat-meta-line' },
        worldbook
          ? h(
              'span',
              { class: 'chat-meta-chip' },
              icon('book'),
              h('span', { text: worldbook.name }),
            )
          : h(
              'span',
              { class: 'chat-meta-chip muted' },
              icon('moon'),
              h('span', { text: '无世界书' }),
            ),
        npcCountChip,
        diaryCountChip,
        pluginChip,
        h(
          'span',
          { class: 'chat-meta-chip subtle' },
          icon('spark'),
          h('span', { text: animationLabel(persona.dialogue?.animation) }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'chat-head-actions' },
      statusToggleButton,
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => {
            if (streaming) {
              toast('等这一轮结束，再邀请新角色。', { type: 'info' });
              return;
            }
            openNpcEditor(app, initialArchive.id, {
              onSaved: () => {
                refreshParticipants();
                refreshHeaderMeta();
              },
            });
          },
        },
        icon('users'),
        h('span', { text: '邀请 NPC' }),
      ),
      h(
        'button',
        {
          class: 'btn btn-soft btn-sm end-chapter-btn',
          type: 'button',
          onclick: () => {
            if (streaming) {
              toast('请等这一轮生成结束。', { type: 'info' });
              return;
            }
            openDiaryGenerator(app, initialArchive.id, {
              onSaved: (diary) => {
                refreshMemory();
                refreshHeaderMeta();
                if (diary) appendMemoryFold();
                updateComposerHint();
              },
            });
          },
        },
        icon('brain'),
        h('span', { text: '结束本章' }),
      ),
      buildStoryMenu(),
    ),
  );

  /* ------------------------------------------------------------------ */
  /* 对话区                                                              */
  /* ------------------------------------------------------------------ */

  const banner = h('div', { class: 'chat-banner-wrap' });
  const messagesWrap = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  const chatScroll = h(
    'div',
    { class: 'chat-scroll', id: 'chat-scroll', tabindex: '0' },
    messagesWrap,
  );
  const jumpButton = h(
    'button',
    {
      class: 'jump-bottom',
      type: 'button',
      'aria-label': '回到最新对话',
      hidden: true,
      onclick: () => scrollToBottom(chatScroll, 'smooth'),
    },
    icon('chevronDown'),
  );

  const textarea = h('textarea', {
    class: 'composer-input',
    id: 'chat-input',
    rows: 1,
    maxlength: LIMITS.maxInputChars,
    placeholder: `和${persona.name}说点什么…`,
    'aria-label': `给${persona.name}发送消息`,
  });
  const charCounter = h('span', { class: 'composer-count', text: '0' });
  const sendButton = h(
    'button',
    { class: 'send-button', type: 'submit', disabled: true, 'aria-label': '发送消息' },
    icon('send'),
    h('span', { text: '发送' }),
  );
  const stopButton = h(
    'button',
    {
      class: 'stop-button',
      type: 'button',
      hidden: true,
      'aria-label': '停止生成',
      onclick: () => stopGeneration(),
    },
    icon('stop'),
    h('span', { text: '停止' }),
  );
  const composerHint = h('span', { class: 'composer-hint' });
  const composer = h(
    'form',
    { class: 'composer', id: 'chat-composer' },
    h(
      'div',
      { class: 'composer-box' },
      textarea,
      h(
        'div',
        { class: 'composer-foot' },
        h(
          'div',
          { class: 'composer-help' },
          composerHint,
          h(
            'span',
            { class: 'composer-keys' },
            h('kbd', { text: 'Enter' }),
            h('span', { text: '发送' }),
            h('span', { class: 'key-sep', text: '·' }),
            h('kbd', { text: 'Shift + Enter' }),
            h('span', { text: '换行' }),
          ),
        ),
        h(
          'div',
          { class: 'composer-actions' },
          charCounter,
          stopButton,
          sendButton,
        ),
      ),
    ),
  );

  const starterStrip = h('div', { class: 'starter-strip' });
  const chatMain = h(
    'section',
    { class: 'chat-main', 'aria-label': '主对话' },
    chatScroll,
    jumpButton,
    starterStrip,
    composer,
  );

  /* ------------------------------------------------------------------ */
  /* 状态栏                                                              */
  /* ------------------------------------------------------------------ */

  const statusValues = {};
  const statusRows = STATUS_FIELDS.map((field) => {
    const value = h('p', {
      class: 'status-value',
      text: initialArchive.status?.[field.key] || '尚未记录',
    });
    statusValues[field.key] = value;
    return h(
      'div',
      { class: `status-row status-row-${field.key}` },
      h('span', { class: 'status-row-icon' }, icon(field.icon)),
      h(
        'div',
        { class: 'status-row-copy' },
        h('span', { class: 'status-label', text: field.label }),
        value,
      ),
    );
  });
  const statusUpdated = h('span', {
    class: 'status-updated-at',
    text: `更新于 ${formatRelative(initialArchive.status?.updatedAt)}`,
  });
  const statusCard = h(
    'section',
    { class: 'side-card status-card' },
    h(
      'div',
      { class: 'side-card-head' },
      h(
        'div',
        { class: 'side-card-title' },
        h('span', { class: 'side-kicker', text: '此刻' }),
        h('h2', { text: '角色状态' }),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '手动编辑状态',
          'aria-label': '手动编辑状态',
          onclick: () => {
            if (streaming) {
              toast('等这一轮结束，再修改状态。', { type: 'info' });
              return;
            }
            openStatusEditor(app, initialArchive.id, {
              onSaved: (next) => updateStatusPanel(next),
            });
          },
        },
        icon('edit'),
      ),
    ),
    ...statusRows,
    h('div', { class: 'status-foot' }, statusUpdated),
  );

  const participantsList = h('div', { class: 'participant-list' });
  const participantCount = h('span', { class: 'side-count' });
  const participantsCard = h(
    'section',
    { class: 'side-card participants-card' },
    h(
      'div',
      { class: 'side-card-head' },
      h(
        'div',
        { class: 'side-card-title' },
        h('span', { class: 'side-kicker', text: '在场' }),
        h('h2', {}, h('span', { text: '角色' }), participantCount),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '邀请 NPC',
          'aria-label': '邀请 NPC',
          onclick: () =>
            openNpcEditor(app, initialArchive.id, {
              onSaved: () => {
                refreshParticipants();
                refreshHeaderMeta();
              },
            }),
        },
        icon('plus'),
      ),
    ),
    participantsList,
  );

  const strongMemoryList = h('div', { class: 'strong-memory-list' });
  const strongMemoryCount = h('span', { class: 'side-count' });
  const strongMemoryInput = h('textarea', {
    class: 'input strong-memory-input',
    rows: 3,
    placeholder: '写下必须记住的事。可长可短，可自由换行；Ctrl+Enter 添加。',
    'aria-label': '填写必须记住的事情',
  });
  const strongMemoryCard = h(
    'section',
    { class: 'side-card strong-memory-card' },
    h(
      'div',
      { class: 'side-card-head' },
      h(
        'div',
        { class: 'side-card-title' },
        h('span', { class: 'side-kicker', text: '强记忆' }),
        h('h2', {}, h('span', { text: '必须记住' }), strongMemoryCount),
      ),
    ),
    h('p', {
      class: 'strong-memory-hint',
      text: '由你手动维护，分点分条；每一条都会优先写入 AI 提示词。',
    }),
    strongMemoryList,
    h(
      'div',
      { class: 'strong-memory-compose' },
      strongMemoryInput,
      h(
        'button',
        {
          class: 'btn btn-soft btn-sm',
          type: 'button',
          title: '添加一条强记忆',
          'aria-label': '添加强记忆',
          onclick: () => addStrongMemory(),
        },
        icon('plus'),
        h('span', { text: '添加' }),
      ),
    ),
  );

  const memoryBody = h('div', { class: 'memory-body' });
  const memoryCount = h('span', { class: 'side-count' });
  const memoryCard = h(
    'section',
    { class: 'side-card memory-card' },
    h(
      'div',
      { class: 'side-card-head' },
      h(
        'div',
        { class: 'side-card-title' },
        h('span', { class: 'side-kicker', text: '记忆' }),
        h('h2', {}, h('span', { text: '日记' }), memoryCount),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '查看全部日记',
          'aria-label': '查看全部日记',
          onclick: () => openDiaryViewer(app, initialArchive.id),
        },
        icon('journal'),
      ),
    ),
    memoryBody,
    h(
      'div',
      { class: 'memory-actions' },
      h(
        'button',
        {
          class: 'btn btn-soft btn-sm btn-block',
          type: 'button',
          onclick: () => {
            if (streaming) {
              toast('请等这一轮生成结束。', { type: 'info' });
              return;
            }
            openDiaryGenerator(app, initialArchive.id, {
              onSaved: (diary) => {
                refreshMemory();
                refreshHeaderMeta();
                if (diary) appendMemoryFold();
                updateComposerHint();
              },
            });
          },
        },
        icon('brain'),
        h('span', { text: '结束本章并生成日记' }),
      ),
    ),
  );

  const archiveStats = h('div', { class: 'archive-side-stats' });
  const profileCard = h(
    'section',
    { class: 'side-profile' },
    avatar(persona, { size: 'xl' }),
    h(
      'div',
      { class: 'side-profile-copy' },
      h('span', { class: 'side-kicker', text: persona.identity }),
      h('h2', { text: persona.name }),
      h(
        'p',
        {},
        h('span', { text: '称呼你为 ' }),
        h('strong', { text: `「${persona.address || '你'}」` }),
      ),
    ),
    h(
      'button',
      {
        class: 'icon-btn subtle',
        type: 'button',
        title: '导出当前人格',
        'aria-label': '导出当前人格',
        onclick: () => exportArchivePersona(app, initialArchive.id),
      },
      icon('download'),
    ),
  );

  const statusPanel = h(
    'aside',
    { class: 'status-panel', id: 'chat-status-panel', 'aria-label': '角色状态栏' },
    h(
      'div',
      { class: 'status-panel-head-mobile' },
      h('strong', { text: '这一页的 TA' }),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          'aria-label': '关闭状态栏',
          onclick: () => toggleStatusPanel(false),
        },
        icon('x'),
      ),
    ),
    profileCard,
    statusCard,
    participantsCard,
    strongMemoryCard,
    memoryCard,
    h('div', { class: 'side-foot' }, archiveStats),
  );

  const backdrop = h('button', {
    class: 'status-backdrop',
    type: 'button',
    tabindex: '-1',
    'aria-label': '关闭状态栏',
    onclick: () => toggleStatusPanel(false),
  });

  const layout = h(
    'div',
    { class: 'chat-layout' },
    chatMain,
    statusPanel,
    backdrop,
  );

  page.append(header, banner, layout);
  statusToggleButton.addEventListener('click', () => {
    const isOpen = statusPanel.classList.contains('is-open');
    toggleStatusPanel(!isOpen);
  });

  /* ------------------------------------------------------------------ */
  /* 渲染辅助                                                            */
  /* ------------------------------------------------------------------ */

  function getArchive() {
    return store.getArchive(initialArchive.id);
  }

  function getPersona() {
    return store.getPersona(getArchive()?.personaId) || persona;
  }

  function latestDiaries() {
    return getArchive()?.diaries || [];
  }

  function refreshBanner() {
    app.refreshAIStatus();
    const status = app.runtime.aiStatus;
    banner.replaceChildren();
    if (store.state.settings.demoMode) {
      banner.appendChild(
        h(
          'div',
          { class: 'chat-banner demo-banner' },
          icon('spark'),
          h(
            'p',
            {},
            h('strong', { text: '演示模式' }),
            h('span', {
              text: '回复由本地演示逻辑生成，不调用模型，也不消耗 token。可在设置中关闭。',
            }),
          ),
          h('a', { class: 'text-link', href: '#/settings' }, '设置'),
        ),
      );
    } else if (status === 'unconfigured') {
      banner.appendChild(
        h(
          'div',
          { class: 'chat-banner warn-banner' },
          icon('key'),
          h(
            'p',
            {},
            h('strong', { text: '还没有连接模型' }),
            h('span', {
              text: '填写 API Key，或在服务端 .env 中配置后，再回来开始对话。',
            }),
          ),
          h('a', { class: 'text-link', href: '#/settings' }, '去设置'),
        ),
      );
    } else if (status === 'offline') {
      banner.appendChild(
        h(
          'div',
          { class: 'chat-banner error-banner' },
          icon('warning'),
          h(
            'p',
            {},
            h('strong', { text: '模型连接异常' }),
            h('span', { text: app.runtime.callDetail || '请检查本地服务与网络。' }),
          ),
          h(
            'button',
            {
              class: 'text-link',
              type: 'button',
              onclick: async () => {
                await app.refreshHealth();
                refreshBanner();
              },
            },
            '重新检查',
          ),
        ),
      );
    }
  }

  function refreshHeaderMeta() {
    const current = getArchive();
    if (!current) return;
    npcCountChip.replaceChildren(icon('users'), h('span', { text: `${current.npcs.length} 位 NPC` }));
    diaryCountChip.replaceChildren(
      icon('brain'),
      h('span', {
        text: current.diaries.length ? `${current.diaries.length} 篇记忆` : '记忆待生成',
      }),
    );
    const activePlugins = store.getEnabledPlugins();
    pluginChip.hidden = activePlugins.length === 0;
    if (activePlugins.length) {
      pluginChip.replaceChildren(
        icon('plug'),
        h('span', {
          text: `${activePlugins.length} 个插件启用`,
        }),
      );
      pluginChip.title = `已启用：${activePlugins.map((plugin) => plugin.name).join('、')}。插件为本轮最高优先级硬约束。`;
    }
    archiveStats.replaceChildren(
      h('span', { class: 'side-stat' }, icon('spark'), h('span', { text: `${formatCompactNumber(current.tokenStats.totalTokens)} tokens` })),
      h('span', { class: 'side-stat' }, icon('chat'), h('span', { text: `${current.messages.length} 轮` })),
      h('span', { class: 'side-stat' }, icon('clock'), h('span', { text: formatRelative(current.lastChatAt) })),
    );
  }

  function updateStatusPanel(status) {
    if (!status) return;
    for (const field of STATUS_FIELDS) {
      const target = statusValues[field.key];
      if (!target) continue;
      const value = status[field.key] || '尚未记录';
      target.textContent = value;
      target.classList.toggle('is-empty', !status[field.key]);
    }
    statusUpdated.textContent = `更新于 ${formatRelative(status.updatedAt)}`;
    refreshBanner();
  }

  function refreshParticipants() {
    const current = getArchive();
    if (!current) return;
    participantCount.textContent = ` · ${current.npcs.length + 1}`;
    const nodes = [
      participant('你', current.protagonist.name, current.protagonist.identity || '主人公', true),
      participant(getPersona().name, getPersona().identity, `叫你「${getPersona().address || '你'}」`, false),
      ...current.npcs.map((npc) =>
        participant(npc.name, npc.identity, npc.style || '场景中的新角色', false, npc),
      ),
    ];
    participantsList.replaceChildren(...nodes);
  }

  function participant(name, subtitle, description, isPlayer, npc = null) {
    const accent = npc?.color || (isPlayer ? '#b98f78' : getPersona().dialogue?.color);
    return h(
      'div',
      { class: 'participant-row' },
      h(
        'span',
        { class: 'participant-avatar', style: { '--participant-color': safeColor(accent) } },
        h('span', { text: Array.from(name)[0] || '?' }),
      ),
      h(
        'span',
        { class: 'participant-copy' },
        h('strong', { text: name }),
        h('span', { text: subtitle || description }),
        subtitle && description ? h('small', { text: description }) : null,
      ),
      npc
        ? h(
            'button',
            {
              class: 'icon-btn subtle small',
              type: 'button',
              title: '让这个 NPC 离开场景',
              'aria-label': `移除 ${npc.name}`,
              onclick: async () => {
                const ok = await confirmDialog({
                  title: `让 ${npc.name} 离开场景？`,
                  message: '之后 AI 将不再收到这位 NPC 的设定；之前的对话仍会保留。',
                  confirmText: '离开场景',
                });
                if (!ok) return;
                const archiveId = getArchive()?.id;
                if (!archiveId) return;
                store.update(
                  (state) => {
                    const target = state.archives.find((item) => item.id === archiveId);
                    if (target) {
                      target.npcs = target.npcs.filter((item) => item.id !== npc.id);
                      target.updatedAt = new Date().toISOString();
                    }
                  },
                  { reason: 'npc-removed', archiveId },
                );
                store.info('npc.removed', `NPC「${npc.name}」离开了场景。`, {
                  archiveId,
                });
                refreshParticipants();
                refreshHeaderMeta();
              },
            },
            icon('x'),
          )
        : null,
    );
  }

  function refreshStrongMemory() {
    const current = getArchive();
    if (!current) return;
    const memories = current.strongMemories || [];
    strongMemoryCount.textContent = memories.length ? ` · ${memories.length}` : '';
    if (!memories.length) {
      strongMemoryList.replaceChildren(
        h('p', {
          class: 'strong-memory-empty',
          text: '还没有强记忆。把绝不能忘的约定、事实或偏好写在这里。',
        }),
      );
      return;
    }
    strongMemoryList.replaceChildren(
      ...memories.map((memory, index) =>
        h(
          'div',
          { class: 'strong-memory-row' },
          h('span', { class: 'strong-memory-index', text: String(index + 1) }),
          h('span', { class: 'strong-memory-text', text: memory }),
          h(
            'button',
            {
              class: 'icon-btn subtle small',
              type: 'button',
              title: '删除这条强记忆',
              'aria-label': `删除强记忆：${memory}`,
              onclick: () => removeStrongMemory(memory),
            },
            icon('x'),
          ),
        ),
      ),
    );
  }

  function addStrongMemory() {
    const current = getArchive();
    if (!current) return;
    const text = strongMemoryInput.value.trim();
    if (!text) {
      strongMemoryInput.focus();
      return;
    }
    const memories = [...(current.strongMemories || [])];
    if (memories.includes(text)) {
      toast('这条强记忆已经存在。', { type: 'info' });
      return;
    }
    memories.push(text);
    store.update(
      (state) => {
        const target = state.archives.find((item) => item.id === current.id);
        if (!target) return;
        target.strongMemories = memories;
        target.updatedAt = new Date().toISOString();
      },
      { reason: 'strong-memory-added', archiveId: current.id },
    );
    store.info('archive.strong-memory.added', '添加了一条强记忆。', {
      archiveId: current.id,
      detail: { chars: text.length },
    });
    strongMemoryInput.value = '';
    refreshStrongMemory();
    strongMemoryInput.focus();
  }

  function removeStrongMemory(memory) {
    const current = getArchive();
    if (!current) return;
    store.update(
      (state) => {
        const target = state.archives.find((item) => item.id === current.id);
        if (!target) return;
        target.strongMemories = (target.strongMemories || []).filter(
          (item) => item !== memory,
        );
        target.updatedAt = new Date().toISOString();
      },
      { reason: 'strong-memory-removed', archiveId: current.id },
    );
    store.info('archive.strong-memory.removed', '删除了一条强记忆。', {
      archiveId: current.id,
    });
    refreshStrongMemory();
  }

  strongMemoryInput.addEventListener('input', () => autoGrow(strongMemoryInput));
  strongMemoryInput.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      !isWritingComposition(event)
    ) {
      event.preventDefault();
      addStrongMemory();
    }
  });

  function refreshMemory() {
    const current = getArchive();
    if (!current) return;
    const diaries = current.diaries;
    memoryCount.textContent = diaries.length ? ` · ${diaries.length}` : '';
    if (!diaries.length) {
      memoryBody.replaceChildren(
        h(
          'div',
          { class: 'memory-empty' },
          icon('brain'),
          h('p', { text: '还没有日记。结束一章后，对话会被折叠成更轻的记忆。' }),
        ),
      );
      return;
    }
    const latest = diaries.at(-1);
    memoryBody.replaceChildren(
      h(
        'div',
        { class: 'memory-latest' },
        h(
          'div',
          { class: 'memory-latest-head' },
          h('span', { text: formatRelative(latest.createdAt) }),
          h('span', {
            text: `${diaries.length} 篇 · 已压缩 ${
              current.summarizedUntil || 0
            } 条`,
          }),
        ),
        h('p', { text: truncateText(latest.content, 190) }),
        h(
          'button',
          {
            class: 'text-link',
            type: 'button',
            onclick: () => openDiaryViewer(app, current.id),
          },
          '翻开全部日记 →',
        ),
      ),
    );
  }

  function appendMemoryFold() {
    const current = getArchive();
    if (!current) return;
    const fold = h(
      'div',
      { class: 'memory-fold' },
      h('span', { class: 'memory-fold-line' }),
      h('span', { class: 'memory-fold-copy' }, icon('brain'), h('span', { text: '这一章已被收进日记' })),
      h('span', { class: 'memory-fold-line' }),
    );
    messagesWrap.appendChild(fold);
    scrollToBottom(chatScroll, 'smooth');
  }

  function updateComposerHint() {
    const current = getArchive();
    if (!current) return;
    const diaryCount = current.diaries.length;
    composerHint.textContent = diaryCount
      ? `记忆已折叠 · ${diaryCount} 篇日记参与下一轮`
      : '第一章 · 完整对话仅在日记生成前参与上下文';
    charCounter.textContent = String(countChars(textarea.value));
  }

  function updateComposerState() {
    const hasText = Boolean(textarea.value.trim());
    sendButton.disabled = streaming || !hasText;
    stopButton.hidden = !streaming;
    sendButton.hidden = streaming;
    composer.classList.toggle('is-streaming', streaming);
    textarea.setAttribute('aria-busy', String(streaming));
  }

  function renderChapterMarker() {
    const date = new Date(initialArchive.createdAt);
    messagesWrap.appendChild(
      h(
        'div',
        { class: 'chapter-marker' },
        h('span', { class: 'chapter-rule' }),
        h(
          'span',
          { class: 'chapter-copy' },
          h('span', { class: 'chapter-kicker', text: '第一章' }),
          h('strong', { text: initialArchive.name }),
          h('span', {
            text: date.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
          }),
        ),
        h('span', { class: 'chapter-rule' }),
      ),
    );
  }

  function messageElement(message, { pending: isPending = false, animate = true } = {}) {
    const isAssistant = message.role === 'assistant';
    const personaNow = getPersona();
    const color = safeColor(personaNow.dialogue?.color, '#c56b57');
    const animation = personaNow.dialogue?.animation || 'none';
    const contentBox = h('div', { class: 'message-text' });
    const bubble = h(
      'div',
      {
        class: `bubble ${isAssistant ? `assistant-bubble anim-${animation}` : 'user-bubble'} ${
          isPending ? 'is-pending' : ''
        }`.trim(),
        style: isAssistant ? { '--persona-color': color } : undefined,
      },
    );
    bubble.appendChild(contentBox);

    const meta = h(
      'div',
      { class: 'message-meta' },
      h('strong', { class: 'message-speaker', text: isAssistant ? personaNow.name : '你' }),
      h('span', { class: 'message-time', text: formatShortTime(message.timestamp) }),
      isAssistant && message.provider === 'demo'
        ? h('span', { class: 'message-demo-tag', text: '演示' })
        : null,
    );

    const actionButtons = [];
    if (isAssistant) {
      actionButtons.push(
        h(
          'button',
          {
            class: 'message-action',
            type: 'button',
            title: '复制这段回复',
            'aria-label': '复制这段回复',
            onclick: async () => {
              const ok = await copyText(message.content);
              toast(ok ? '已复制。' : '复制失败，请手动选择文本。', {
                type: ok ? 'success' : 'error',
                duration: 1_800,
              });
            },
          },
          icon('copy'),
        ),
      );
    }
    if (!isPending) {
      actionButtons.push(
        h(
          'button',
          {
            class: 'message-action message-delete-action',
            type: 'button',
            title: '删除这条对话',
            'aria-label': '删除这条对话',
            onclick: () => openDeleteMessageDialog(message),
          },
          icon('trash'),
        ),
      );
    }
    const actions = h('div', { class: 'message-actions' }, ...actionButtons);

    if (isPending) {
      contentBox.appendChild(
        h(
          'span',
          { class: 'typing-dots', 'aria-label': `${personaNow.name}正在输入` },
          h('i'),
          h('i'),
          h('i'),
        ),
      );
    } else {
      const formatted = richText(message.content);
      if (isAssistant) {
        const decorated = appendEmojiTail(message.content, personaNow, message.id);
        const tail = decorated.slice(message.content.trimEnd().length).trim();
        if (tail) {
          const target =
            formatted.querySelector('.rich-paragraph:last-child') ||
            formatted.querySelector('.rich-list:last-child') ||
            formatted;
          target.appendChild(
            h('span', { class: 'emoji-tail', text: tail, 'aria-hidden': 'true' }),
          );
        }
      }
      contentBox.appendChild(formatted);
    }

    const wrapper = h(
      'article',
      {
        class: `message ${isAssistant ? 'message-assistant' : 'message-user'} ${
          animate ? 'message-enter' : ''
        }`.trim(),
        'data-message-id': message.id,
      },
      avatar(isAssistant ? personaNow : null, {
        size: 'sm',
        user: !isAssistant,
        name: isAssistant ? personaNow.name : getArchive()?.protagonist.name,
      }),
      h(
        'div',
        { class: 'message-body' },
        h(
          'div',
          { class: 'message-head' },
          meta,
          actions,
        ),
        bubble,
      ),
    );

    return { wrapper, bubble, contentBox, meta, time: meta.querySelector('.message-time') };
  }

  function deleteMessages(start, requestedCount) {
    const archive = getArchive();
    if (!archive || start < 0 || start >= archive.messages.length) return false;
    const summarizedUntil = archive.summarizedUntil || 0;
    if (start < summarizedUntil) {
      toast('这条消息已经进入日记记忆，不能单独删除。', { type: 'warn' });
      return false;
    }
    const available = archive.messages.length - start;
    const count =
      requestedCount === Infinity
        ? available
        : Math.max(1, Math.min(Number(requestedCount) || 1, available));
    const removed = archive.messages.slice(start, start + count);
    if (!removed.length) return false;
    const removedIds = new Set(removed.map((message) => message.id));
    const now = new Date().toISOString();

    store.update(
      (state) => {
        const target = state.archives.find((item) => item.id === archive.id);
        if (!target) return;
        target.messages.splice(start, count);
        target.updatedAt = now;
      },
      { reason: 'messages-deleted', archiveId: archive.id },
    );

    for (const node of messagesWrap.querySelectorAll('.message[data-message-id]')) {
      if (removedIds.has(node.dataset.messageId)) node.remove();
    }

    const next = getArchive();
    const scrollTop = chatScroll.scrollTop;
    if (!next?.messages.length) {
      starterStrip.hidden = false;
    }
    refreshHeaderMeta();
    refreshMemory();
    updateComposerHint();
    updateComposerState();
    requestAnimationFrame(() => {
      if (isNearBottom(chatScroll)) chatScroll.scrollTop = chatScroll.scrollHeight;
      else chatScroll.scrollTop = Math.min(scrollTop, chatScroll.scrollHeight);
    });

    store.info(
      'messages.deleted',
      count > 1
        ? `删除了 ${count} 条对话记录。`
        : '删除了一条对话记录。',
      {
        archiveId: archive.id,
        detail: {
          start,
          count,
          roles: removed.map((message) => message.role),
        },
      },
    );
    toast(count > 1 ? `已删除 ${count} 条对话。` : '已删除这条对话。', {
      type: 'success',
      duration: 2_000,
    });
    return true;
  }

  function openDeleteMessageDialog(message) {
    const archive = getArchive();
    if (!archive) return null;
    if (streaming) {
      toast('请等这一轮生成结束，再删除对话。', { type: 'info' });
      return null;
    }
    const index = archive.messages.findIndex((item) => item.id === message.id);
    if (index < 0) return null;
    const summarizedUntil = archive.summarizedUntil || 0;
    if (index < summarizedUntil) {
      return openModal({
        title: '这条消息已进入记忆',
        eyebrow: archive.name,
        size: 'sm',
        body: h(
          'div',
          { class: 'message-delete-dialog' },
          h('p', { text: '这条消息已经被折叠进章节日记。单独删除会让日记与对话顺序不一致。' }),
          h('p', { class: 'muted small', text: '可以删除当前章节日记之后、尚未折叠的消息。' }),
        ),
        actions: [{ label: '知道了', variant: 'primary' }],
      });
    }

    const isUser = message.role === 'user';
    const nextMessage = archive.messages[index + 1];
    const previousMessage = archive.messages[index - 1];
    const deleteTurn = isUser
      ? nextMessage?.role === 'assistant'
      : previousMessage?.role === 'user';
    const turnStart = deleteTurn && !isUser ? index - 1 : index;
    if (deleteTurn && turnStart < summarizedUntil) {
      return openModal({
        title: '这条回复依附于已折叠消息',
        eyebrow: archive.name,
        size: 'sm',
        body: h(
          'div',
          { class: 'message-delete-dialog' },
          h('p', { text: '它的上一条玩家消息已经进入章节日记，不能单独删除这一轮。' }),
          h('p', { class: 'muted small', text: '可以删除当前章节中尚未折叠的对话。' }),
        ),
        actions: [{ label: '知道了', variant: 'primary' }],
      });
    }
    const preview = truncateText(
      String(message.content || '').replace(/\s+/g, ' ').trim(),
      160,
    );
    const body = h(
      'div',
      { class: 'message-delete-dialog' },
      h(
        'div',
        { class: 'message-delete-preview' },
        h('strong', { text: isUser ? '你的消息' : getPersona().name }),
        h('p', { text: preview || '（空消息）' }),
      ),
      h('p', {
        text: deleteTurn
          ? isUser
            ? '会同时删除这条消息和紧随其后的角色回复，避免留下孤立的回复。'
            : '会同时删除你上一条消息和这条角色回复，避免留下没有提问的回复。'
          : '只会删除这一条消息。',
      }),
      h('p', {
        class: 'muted small',
        text: '删除无法撤回；右侧状态栏不会自动回退，如需要请手动校正。',
      }),
    );

    return openModal({
      title: '删除这条对话？',
      eyebrow: archive.name,
      size: 'sm',
      body,
      actions: [
        { label: '取消', variant: 'ghost' },
        {
          label: deleteTurn ? '删除这一轮' : '只删这条',
          variant: 'danger',
          onClick: () => deleteMessages(deleteTurn ? turnStart : index, deleteTurn ? 2 : 1),
        },
        {
          label: '删除此条及之后',
          variant: 'danger',
          onClick: () => deleteMessages(index, Infinity),
        },
      ],
    });
  }

  function appendMessage(message, options = {}) {
    const shouldScroll = options.forceScroll ?? isNearBottom(chatScroll);
    const element = messageElement(message, options);
    messagesWrap.appendChild(element.wrapper);
    if (shouldScroll) {
      requestAnimationFrame(() => {
        chatScroll.scrollTop = chatScroll.scrollHeight;
      });
    }
    return element;
  }

  function createPending() {
    const now = new Date().toISOString();
    const element = messageElement(
      {
        id: `pending_${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: now,
      },
      { pending: true, animate: true },
    );
    element.bubble.classList.add('is-streaming');
    messagesWrap.appendChild(element.wrapper);
    element.meta.querySelector('.message-time').textContent = '正在输入…';
    if (isNearBottom(chatScroll)) {
      requestAnimationFrame(() => {
        chatScroll.scrollTop = chatScroll.scrollHeight;
      });
    }
    return element;
  }

  function paintPending() {
    paintFrame = 0;
    if (!pending) return;
    const visible = getStreamingVisibleText(rawStream);
    pending.contentBox.replaceChildren();
    if (visible) {
      if (visible.length > 1_200) {
        // 长文本流式阶段用纯文本更新，避免每帧解析整段富文本造成卡顿；
        // 生成完成后 commitAssistant 会恢复完整富文本格式。
        const plain = h('div', { class: 'rich-text stream-plain-text' });
        plain.textContent = visible;
        pending.contentBox.appendChild(plain);
      } else {
        pending.contentBox.appendChild(richText(visible));
      }
    } else {
      pending.contentBox.appendChild(
        h('span', { class: 'typing-dots' }, h('i'), h('i'), h('i')),
      );
    }
    pending.contentBox.appendChild(h('span', { class: 'stream-caret', 'aria-hidden': 'true' }));
    if (isNearBottom(chatScroll)) {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }
  }

  function schedulePaint() {
    if (paintFrame) return;
    paintFrame = requestAnimationFrame(paintPending);
  }

  function removePending() {
    if (paintFrame) cancelAnimationFrame(paintFrame);
    paintFrame = 0;
    pending?.wrapper.remove();
    pending = null;
  }

  function clearErrorCards() {
    lastErrorCard?.remove();
    lastErrorCard = null;
  }

  function showErrorCard(error, { allowRetry = true } = {}) {
    clearErrorCards();
    const needsSetup =
      ['MISSING_API_KEY', 'MISSING_LOCAL_KEY'].includes(error?.code) ||
      error?.status === 401 ||
      error?.status === 403;
    const card = h(
      'div',
      { class: 'chat-error-card', role: 'alert' },
      h('span', { class: 'chat-error-icon' }, icon('warning')),
      h(
        'div',
        { class: 'chat-error-copy' },
        h('strong', { text: needsSetup ? '模型还没有准备好' : '这一轮没有送达' }),
        h('p', { text: error?.message || '发生未知错误。' }),
        h('small', {
          text: error?.requestId
            ? `详情已写入运行日记 · ${error.requestId.slice(0, 8)}`
            : '详细错误类型、堆栈与时间戳已写入运行日记。',
        }),
      ),
      h(
        'div',
        { class: 'chat-error-actions' },
        allowRetry
          ? h(
              'button',
              {
                class: 'btn btn-soft btn-sm',
                type: 'button',
                onclick: () => {
                  card.remove();
                  if (lastErrorCard === card) lastErrorCard = null;
                  runGeneration({ retry: true }).catch(() => {});
                },
              },
              icon('refresh'),
              h('span', { text: '重试' }),
            )
          : null,
        needsSetup
          ? h(
              'a',
              { class: 'btn btn-ghost btn-sm', href: '#/settings' },
              icon('settings'),
              h('span', { text: '去设置' }),
            )
          : null,
      ),
    );
    lastErrorCard = card;
    messagesWrap.appendChild(card);
    scrollToBottom(chatScroll, 'smooth');
  }

  /* ------------------------------------------------------------------ */
  /* 消息提交                                                            */
  /* ------------------------------------------------------------------ */

  function commitAssistant({
    content,
    status,
    usage,
    provider,
    model,
    requestId,
    durationMs,
    demo = false,
    partial = false,
  }) {
    const current = getArchive();
    if (!current) return null;
    const now = new Date().toISOString();
    const message = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'assistant',
      content: content.trim(),
      timestamp: now,
      provider,
      model,
      usage: usage || null,
    };

    store.update(
      (state) => {
        const target = state.archives.find((item) => item.id === current.id);
        if (!target) return;
        target.messages.push(message);
        target.status = mergeAIStatus(target.status, status);
        target.updatedAt = now;
        target.lastChatAt = now;
        if (target.messages.length > LIMITS.maxMessages) {
          target.messages.splice(0, target.messages.length - LIMITS.maxMessages);
        }
      },
      { reason: 'chat-assistant', archiveId: current.id },
    );

    if (usage?.totalTokens && !demo) {
      store.recordUsage({ archiveId: current.id, provider, usage });
    }

    removePending();
    appendMessage(message, { forceScroll: isNearBottom(chatScroll), animate: true });
    const nextArchive = getArchive();
    updateStatusPanel(nextArchive.status);
    refreshHeaderMeta();
    refreshMemory();
    app.updateTokenHud();
    updateComposerHint();

    if (!status && !partial) {
      store.warn('ai.status.missing', '模型回复中没有可解析的状态块，已保留上一轮状态。', {
        archiveId: current.id,
      });
    }

    if (!demo) app.markAIStatus('online');
    store.info(
      partial ? 'ai.response.partial' : 'ai.response',
      partial
        ? '保留了中断前已生成的回复。'
        : `收到 ${getPersona().name} 的回复 · ${formatNumber(usage?.totalTokens || 0)} tokens。`,
      {
        archiveId: current.id,
        detail: {
          provider,
          model,
          requestId,
          durationMs,
          tokens: usage?.totalTokens || 0,
          estimated: Boolean(usage?.estimated),
        },
      },
    );
    return message;
  }

  /* ------------------------------------------------------------------ */
  /* 生成                                                                */
  /* ------------------------------------------------------------------ */

  async function runGeneration({ retry = false } = {}) {
    if (streaming) return;
    const current = getArchive();
    if (!current) return;
    const lastMessage = current.messages.at(-1);
    if (!lastMessage || lastMessage.role !== 'user') {
      toastError('没有可重试的玩家消息。');
      return;
    }

    clearErrorCards();
    const settingsSnapshot = clone(store.state.settings);
    const personaNow = getPersona();
    const worldbookNow = store.getWorldbook(current.worldbookId);
    const promptPlugins = store.getEnabledPlugins();
    let prompt;

    try {
      prompt = buildChatPrompt({
        archive: current,
        persona: personaNow,
        worldbook: worldbookNow,
        plugins: promptPlugins,
        settings: settingsSnapshot,
      });
    } catch (error) {
      store.logError('prompt.build.failed', error, { archiveId: current.id });
      toastError(`无法构建提示词：${error.message}`);
      return;
    }

    const configuredMaxTokens = Number(settingsSnapshot.maxTokens) || 800;
    const suggestedMaxTokens = Number(prompt.meta.suggestedMaxTokens) || configuredMaxTokens;
    const effectiveMaxTokens = Math.min(
      4_096,
      Math.max(configuredMaxTokens, suggestedMaxTokens),
    );
    const maxTokensRaised = effectiveMaxTokens > configuredMaxTokens;
    const requestSettings = { ...settingsSnapshot, maxTokens: effectiveMaxTokens };

    if (prompt.meta.pluginExcluded?.length) {
      const names = prompt.meta.pluginExcluded.join('、');
      store.warn('plugin.runtime.excluded', `部分插件因预算或数量限制未注入：${names}`, {
        archiveId: current.id,
      });
      toast(`部分插件未注入：${names}。请精简插件或停用其他插件。`, {
        type: 'warn',
        duration: 6_000,
      });
    }
    if (maxTokensRaised && !settingsSnapshot.demoMode && !pluginTokenNoticeShown) {
      pluginTokenNoticeShown = true;
      toast(
        `插件要求长篇幅：本轮输出上限已临时提高到 ${effectiveMaxTokens} tokens（设置值 ${configuredMaxTokens}）。`,
        { type: 'info', duration: 6_500 },
      );
    }
    if (prompt.meta.historyDropped > 0 && !historyNoticeShown) {
      historyNoticeShown = true;
      toast(
        `上下文预算已满，本轮省略了 ${prompt.meta.historyDropped} 条较早对话。可在设置提高上下文预算，或用「强记忆」固定关键细节。`,
        { type: 'info', duration: 7_000 },
      );
    }

    const promptText = prompt.messages.map((message) => message.content).join('\n');
    streaming = true;
    abortController = new AbortController();
    rawStream = '';
    pending = createPending();
    updateComposerState();
    textarea.focus({ preventScroll: true });

    const providerId = settingsSnapshot.provider;
    const providerMeta = getProvider(providerId);
    const startedAt = performance.now();
    const requestLog = {
      provider: providerId,
      model: settingsSnapshot.model,
      demo: settingsSnapshot.demoMode,
      promptChars: prompt.meta.charCount,
      estimatedPromptTokens: prompt.meta.estimatedTokens,
      historyMessages: prompt.meta.historyMessages,
      worldEntries: prompt.meta.worldEntries,
      diaryCount: prompt.meta.diaryIds.length,
      pluginCount: prompt.meta.pluginIds.length,
      pluginNames: prompt.meta.pluginNames || [],
      pluginChars: prompt.meta.pluginChars || 0,
      pluginLength: prompt.meta.pluginLength || null,
      maxTokensConfigured: configuredMaxTokens,
      maxTokensEffective: effectiveMaxTokens,
      retry,
    };
    store.info(
      'ai.request',
      settingsSnapshot.demoMode
        ? `演示模式生成一轮回复（${prompt.meta.historyMessages} 条上下文）。`
        : `向 ${providerMeta.label} · ${settingsSnapshot.model} 发送一轮对话。`,
      { archiveId: current.id, detail: requestLog },
    );

    let resultModel = settingsSnapshot.model;
    let resultProvider = providerId;
    let requestId = '';
    let usage = null;
    let demoStatus = null;
    let resultText = '';
    let finishReason = '';

    try {
      if (settingsSnapshot.demoMode) {
        const demo = demoReply({
          persona: personaNow,
          archive: current,
          text: lastMessage.content,
        });
        demoStatus = demo.status;
        resultModel = 'demo';
        resultProvider = 'demo';
        resultText = demo.content;
        finishReason = 'stop';
        const chars = Array.from(demo.content);
        const chunkSize = 3;
        for (let index = 0; index < chars.length; index += chunkSize) {
          if (abortController.signal.aborted) throw fakeAbortError();
          rawStream = chars.slice(0, index + chunkSize).join('');
          schedulePaint();
          // 演示流速度随文本长度自适应，避免等待过久。
          await abortableDelay(16, abortController.signal);
        }
        rawStream = demo.content;
        schedulePaint();
        usage = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimated: false,
          demo: true,
        };
      } else if (settingsSnapshot.stream === false) {
        const result = await completeChat({
          settings: requestSettings,
          messages: prompt.messages,
          apiKey: app.getEffectiveApiKey(providerId),
          signal: abortController.signal,
          useCache: false,
        });
        rawStream = result.text;
        resultModel = result.model || settingsSnapshot.model;
        resultProvider = providerId;
        requestId = result.requestId || '';
        resultText = result.text;
        finishReason = result.finishReason || '';
        usage = normalizeUsage(result.usage, promptText, resultText);
        schedulePaint();
        app.markAIStatus('online');
      } else {
        const result = await streamChat({
          settings: requestSettings,
          messages: prompt.messages,
          apiKey: app.getEffectiveApiKey(providerId),
          signal: abortController.signal,
          onDelta: (_delta, fullText) => {
            rawStream = fullText;
            schedulePaint();
          },
        });
        rawStream = result.text;
        resultModel = result.model || settingsSnapshot.model;
        resultProvider = providerId;
        requestId = result.requestId || '';
        resultText = result.text;
        finishReason = result.finishReason || '';
        usage = normalizeUsage(result.usage, promptText, resultText);
        app.markAIStatus('online');
      }

      // 达到模型输出上限时自动用更大的上限重发一次，避免长文在句中断开。
      if (
        !settingsSnapshot.demoMode &&
        (finishReason === 'length' || finishReason === 'max_tokens') &&
        requestSettings.maxTokens < 8_192
      ) {
        const previousRaw = rawStream;
        const firstUsage = usage;
        requestSettings.maxTokens = 8_192;
        rawStream = '';
        updateComposerHint?.();
        toast('内容达到输出上限，正在自动提高上限补全本轮。', {
          type: 'info',
          duration: 4_000,
        });
        try {
          if (settingsSnapshot.stream === false) {
            const retried = await completeChat({
              settings: requestSettings,
              messages: prompt.messages,
              apiKey: app.getEffectiveApiKey(providerId),
              signal: abortController.signal,
              useCache: false,
            });
            rawStream = retried.text;
            resultModel = retried.model || resultModel;
            requestId = retried.requestId || requestId;
            resultText = retried.text;
            finishReason = retried.finishReason || '';
            usage = combineUsage(
              firstUsage,
              normalizeUsage(retried.usage, promptText, retried.text),
            );
          } else {
            const retried = await streamChat({
              settings: requestSettings,
              messages: prompt.messages,
              apiKey: app.getEffectiveApiKey(providerId),
              signal: abortController.signal,
              onDelta: (_delta, fullText) => {
                rawStream = fullText;
                schedulePaint();
              },
            });
            rawStream = retried.text;
            resultModel = retried.model || resultModel;
            requestId = retried.requestId || requestId;
            resultText = retried.text;
            finishReason = retried.finishReason || '';
            usage = combineUsage(
              firstUsage,
              normalizeUsage(retried.usage, promptText, retried.text),
            );
          }
          app.store.info('ai.continued', '输出达到上限后自动提高上限并补全。', {
            archiveId: current.id,
            detail: { maxTokens: 8_192, finishReason },
          });
        } catch (retryError) {
          rawStream = previousRaw;
          usage = firstUsage;
          app.store.warn('ai.continue.failed', '自动补全失败，保留第一次生成内容。', {
            archiveId: current.id,
            detail: { message: retryError?.message || '' },
          });
        }
      }

      if (
        !settingsSnapshot.demoMode &&
        (finishReason === 'length' || finishReason === 'max_tokens')
      ) {
        toast('已达到模型最大输出上限，正文可能仍未写完；请让对方继续或分段生成。', {
          type: 'warn',
          duration: 6_000,
        });
      }

      const parsed = extractAssistantPayload(rawStream);
      const content = parsed.content.trim();
      if (!content) {
        throw new Error('模型没有返回可显示的正文。');
      }
      const durationMs = Math.round(performance.now() - startedAt);
      commitAssistant({
        content,
        status: parsed.status || demoStatus,
        usage,
        provider: resultProvider,
        model: resultModel,
        requestId,
        durationMs,
        demo: settingsSnapshot.demoMode,
      });
    } catch (error) {
      const aborted =
        abortController?.signal.aborted ||
        error?.code === 'ABORTED' ||
        error?.name === 'AbortError';
      const partial = extractAssistantPayload(rawStream).content.trim();
      const durationMs = Math.round(performance.now() - startedAt);

      if (partial) {
        commitAssistant({
          content: partial,
          status: extractAssistantPayload(rawStream).status || demoStatus,
          usage,
          provider: resultProvider,
          model: resultModel,
          requestId: error?.requestId || '',
          durationMs,
          demo: settingsSnapshot.demoMode,
          partial: true,
        });
        removePending();
      } else {
        removePending();
      }

      if (aborted) {
        store.info('ai.aborted', retry ? '重试已取消。' : '生成已停止。', {
          archiveId: current.id,
          detail: { partial: Boolean(partial) },
        });
        if (!partial) toast('已停止生成。', { type: 'info', duration: 1_800 });
      } else {
        store.logError('ai.request.failed', error, {
          archiveId: current.id,
          detail: {
            provider: providerId,
            model: settingsSnapshot.model,
            requestId: error?.requestId || '',
            ...requestLog,
          },
        });
        app.markAIStatus('offline', error?.message || '模型调用失败');
        refreshBanner();
        showErrorCard(error, { allowRetry: !partial });
        if (!partial) {
          toastError(error?.message || '这一轮没有送达，详情见运行日记。');
        }
      }
    } finally {
      streaming = false;
      abortController = null;
      updateComposerState();
      updateComposerHint();
      refreshHeaderMeta();
      app.updateTokenHud();
      requestAnimationFrame(() => textarea.focus({ preventScroll: true }));
    }
  }

  async function sendMessage() {
    if (streaming) {
      textarea.focus();
      return;
    }
    const text = textarea.value.trim();
    if (!text) {
      textarea.focus();
      return;
    }
    if (countChars(text) > LIMITS.maxInputChars) {
      toastError(`单条消息不能超过 ${LIMITS.maxInputChars} 字。`);
      return;
    }
    const current = getArchive();
    if (!current) return;

    const message = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      provider: '',
      model: '',
      usage: null,
    };

    store.update(
      (state) => {
        const target = state.archives.find((item) => item.id === current.id);
        if (!target) return;
        target.messages.push(message);
        target.updatedAt = message.timestamp;
        target.lastChatAt = message.timestamp;
      },
      { reason: 'chat-user', archiveId: current.id },
    );
    store.info('chat.user', '发送了一条玩家消息。', {
      archiveId: current.id,
      detail: { chars: countChars(text) },
    });

    appendMessage(message, { forceScroll: true, animate: true });
    clearErrorCards();
    textarea.value = '';
    autoGrow(textarea);
    charCounter.textContent = '0';
    starterStrip.hidden = true;
    updateComposerState();
    textarea.focus({ preventScroll: true });
    scrollToBottom(chatScroll, 'smooth');
    await runGeneration();
  }

  function stopGeneration() {
    if (!streaming || !abortController) return;
    abortController.abort();
  }

  /* ------------------------------------------------------------------ */
  /* 故事菜单 / 输入事件                                                 */
  /* ------------------------------------------------------------------ */

  function buildStoryMenu() {
    const details = h('details', { class: 'story-menu' });
    const summary = h(
      'summary',
      {
        class: 'icon-btn more-btn',
        title: '更多故事选项',
        'aria-label': '更多故事选项',
      },
      icon('more'),
    );
    const items = [
      {
        icon: 'user',
        title: '编辑主人公',
        desc: '修改姓名、身份、喜好与自定义字段',
        onClick: () =>
          openProtagonistEditor(app, initialArchive.id, {
            onSaved: (next) => {
              // 就地更新对话页，不在弹窗关闭瞬间重建整个视图。
              const titlePlayer = page.querySelector('.chat-title-player');
              if (titlePlayer) titlePlayer.textContent = next.name;
              refreshParticipants();
            },
          }),
      },
      {
        icon: 'persona',
        title: '编辑此刻状态',
        desc: '手动校准右侧的身体、衣着与环境',
        onClick: () => {
          if (streaming) {
            toast('等这一轮结束，再修改状态。', { type: 'info' });
            return;
          }
          openStatusEditor(app, initialArchive.id, {
            onSaved: (next) => updateStatusPanel(next),
          });
        },
      },
      {
        icon: 'brain',
        title: '查看记忆日记',
        desc: `${latestDiaries().length} 篇日记`,
        onClick: () => openDiaryViewer(app, initialArchive.id),
      },
      {
        icon: 'download',
        title: '导出当前人格',
        desc: `将 ${persona.name} 导出为 JSON`,
        onClick: () => exportArchivePersona(app, initialArchive.id),
      },
      {
        icon: 'archive',
        title: '导出完整存档',
        desc: '包含对话、状态、日记、人格与世界书',
        onClick: () => exportArchiveBundle(app, initialArchive.id),
      },
      {
        icon: 'arrowLeft',
        title: '回到存档书架',
        desc: '稍后可以从书架继续这段故事',
        onClick: () => app.navigate('archives'),
      },
    ];

    const closeAndRun = (fn) => () => {
      details.open = false;
      // 先 focus 回仍然可见的 trigger，再打开原生 dialog；
      // 否则 dialog 关闭时可能尝试恢复焦点到已隐藏的菜单项。
      summary.focus({ preventScroll: true });
      setTimeout(fn, 20);
    };

    details.append(
      summary,
      h(
        'div',
        { class: 'story-menu-popover' },
        h('p', {
          class: 'story-menu-caption',
          text: '故事选项 · 可随时导出备份',
        }),
        h(
          'div',
          { class: 'story-menu-list' },
          ...items.map((item) =>
            h(
              'button',
              {
                class: 'story-menu-item',
                type: 'button',
                onclick: closeAndRun(item.onClick),
              },
              h('span', { class: 'story-menu-icon' }, icon(item.icon)),
              h(
                'span',
                { class: 'story-menu-copy' },
                h('strong', { text: item.title }),
                h('small', { text: item.desc }),
              ),
              icon('chevronRight'),
            ),
          ),
        ),
      ),
    );
    return details;
  }

  function handleOutsideStoryMenu(event) {
    const openMenu = document.querySelector('.story-menu[open]');
    if (openMenu && !openMenu.contains(event.target)) openMenu.open = false;
  }

  function toggleStatusPanel(open) {
    statusPanel.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-open', open);
    statusToggleButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('status-open', open);
    if (open) {
      statusPanel.querySelector('.status-panel-head-mobile .icon-btn')?.focus();
    } else {
      statusToggleButton.focus({ preventScroll: true });
    }
  }

  let composerGrowFrame = 0;
  let composerComposing = false;
  const queueComposerGrow = () => {
    if (composerGrowFrame) return;
    composerGrowFrame = requestAnimationFrame(() => {
      composerGrowFrame = 0;
      autoGrow(textarea);
    });
  };

  textarea.addEventListener('compositionstart', () => {
    composerComposing = true;
  });
  textarea.addEventListener('compositionend', () => {
    composerComposing = false;
    queueComposerGrow();
  });

  textarea.addEventListener('input', () => {
    // 输入联想/中文候选阶段不强制测量高度，避免每个 composition 事件触发整页重排。
    charCounter.textContent = String(countChars(textarea.value));
    updateComposerState();
    if (!composerComposing) queueComposerGrow();
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || isWritingComposition(event)) return;
    event.preventDefault();
    if ("ontouchstart" in window && window.innerWidth < 700) {
      // 移动端软键盘上按 Enter 仍然发送；用户可以用 Shift+Enter 换行。
    }
    if (!streaming) composer.requestSubmit();
  });

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage().catch((error) => {
      console.error(error);
      store.logError('chat.send.failed', error, { archiveId: initialArchive.id });
      toastError(error?.message || '发送失败，请重试。');
      streaming = false;
      abortController = null;
      updateComposerState();
    });
  });

  chatScroll.addEventListener('scroll', () => {
    const near = isNearBottom(chatScroll);
    jumpButton.hidden = near;
  });

  jumpButton.addEventListener('click', () => {
    jumpButton.hidden = true;
  });

  document.addEventListener('keydown', handleStatusEscape);
  document.addEventListener('pointerdown', handleOutsideStoryMenu);
  function handleStatusEscape(event) {
    if (event.key !== 'Escape') return;
    const openMenu = document.querySelector('.story-menu[open]');
    if (openMenu) {
      openMenu.open = false;
      return;
    }
    if (statusPanel.classList.contains('is-open')) toggleStatusPanel(false);
  }

  /* ------------------------------------------------------------------ */
  /* 初始渲染                                                            */
  /* ------------------------------------------------------------------ */

  renderChapterMarker();
  for (const message of initialArchive.messages) {
    appendMessage(message, { animate: false });
  }
  if (initialArchive.messages.length <= 1 && !initialArchive.diaries.length) {
    starterStrip.replaceChildren(
      h('span', { class: 'starter-label', text: '不知道从哪一句开始？' }),
      ...buildStarters().map((text) =>
        h(
          'button',
          {
            class: 'starter-chip',
            type: 'button',
            onclick: () => {
              textarea.value = text;
              autoGrow(textarea);
              charCounter.textContent = String(countChars(text));
              updateComposerState();
              textarea.focus();
            },
          },
          icon('spark'),
          h('span', { text }),
        ),
      ),
    );
  } else {
    starterStrip.hidden = true;
  }

  refreshParticipants();
  refreshStrongMemory();
  refreshMemory();
  refreshHeaderMeta();
  updateComposerHint();
  updateComposerState();
  refreshBanner();

  requestAnimationFrame(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
    // 不自动聚焦：避免移动端一进入就弹起键盘；发送后一定会重新聚焦。
  });

  return {
    cleanup() {
      if (abortController) abortController.abort();
      if (paintFrame) cancelAnimationFrame(paintFrame);
      if (composerGrowFrame) cancelAnimationFrame(composerGrowFrame);
      document.removeEventListener('keydown', handleStatusEscape);
      document.removeEventListener('pointerdown', handleOutsideStoryMenu);
      document.body.classList.remove('status-open');
    },
  };
}

function buildStarters() {
  return [
    '我推开门，先看了看四周。',
    '今天过得怎么样？',
    '我有一件事，想慢慢告诉你。',
  ];
}
