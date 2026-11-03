/** 存档总览：并列展示所有故事，支持切换、复制、导出与删除。 */

import {
  clone,
  createId,
  formatCompactNumber,
  formatRelative,
  safeColor,
  truncateText,
} from '../core/utils.js';
import { createDemoArchive } from '../data/schemas.js';
import {
  deleteArchiveWithConfirm,
  exportArchiveBundle,
  openProtagonistEditor,
} from '../ui/archive-dialogs.js';
import {
  avatar,
  emptyState,
  pageHeader,
  tag,
} from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { toast, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const { store } = app;
  const state = store.state;

  if (!state.archives.length) {
    root.appendChild(renderWelcome(app));
    return { cleanup() {} };
  }

  const archives = [...state.archives].sort(
    (a, b) => new Date(b.lastChatAt || b.updatedAt) - new Date(a.lastChatAt || a.updatedAt),
  );
  const diaryCount = archives.reduce((sum, archive) => sum + archive.diaries.length, 0);

  const page = h(
    'div',
    { class: 'page page-archives' },
    pageHeader({
      eyebrow: '你的故事书架',
      title: '我的存档',
      lede: `${archives.length} 段故事，${diaryCount} 篇日记。每个人格都有自己的世界与记忆，互不打扰。`,
      actions: [
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onclick: () => app.navigate('archives/new'),
          },
          icon('plus'),
          h('span', { text: '创建新存档' }),
        ),
      ],
    }),
    h(
      'div',
      { class: 'archive-overview-strip' },
      overviewItem('archive', `${archives.length}`, '段故事'),
      overviewItem('brain', `${diaryCount}`, '篇压缩日记'),
      overviewItem('spark', formatCompactNumber(state.stats.totalTokens), '累计 tokens'),
      overviewItem('persona', `${state.personas.length}`, '个人格'),
    ),
    h(
      'div',
      { class: 'archive-grid' },
      ...archives.map((archive) => renderCard(app, archive)),
      renderNewCard(app),
    ),
  );

  root.appendChild(page);
  return { cleanup() {} };
}

function overviewItem(iconName, value, label) {
  return h(
    'div',
    { class: 'overview-item' },
    h('span', { class: 'overview-icon' }, icon(iconName)),
    h(
      'span',
      { class: 'overview-copy' },
      h('strong', { text: value }),
      h('span', { text: label }),
    ),
  );
}

function renderCard(app, archive) {
  const persona = app.store.getPersona(archive.personaId);
  const worldbook = app.store.getWorldbook(archive.worldbookId);
  const lastMessage = archive.messages.at(-1);
  const accent = safeColor(persona?.dialogue?.color, '#c56b57');
  const isActive = archive.id === app.store.state.activeArchiveId;

  return h(
    'article',
    {
      class: `archive-card ${isActive ? 'is-current' : ''}`.trim(),
      style: { '--archive-accent': accent },
    },
    h('span', { class: 'archive-card-wash', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'archive-card-head' },
      avatar(persona, { size: 'lg' }),
      h(
        'div',
        { class: 'archive-card-title-wrap' },
        h(
          'div',
          { class: 'archive-card-kicker' },
          h('span', { text: persona?.name || '未知人格' }),
          isActive ? h('span', { class: 'current-badge', text: '当前' }) : null,
        ),
        h('h2', { class: 'archive-card-title', text: archive.name }),
        h('p', {
          class: 'archive-card-sub',
          text: `${archive.protagonist.name} × ${persona?.name || '未知'}${
            worldbook ? ` · ${worldbook.name}` : ''
          }`,
        }),
      ),
      h(
        'button',
        {
          class: 'icon-btn card-open-btn',
          type: 'button',
          title: '打开存档',
          'aria-label': `打开存档 ${archive.name}`,
          onclick: () => app.openChat(archive.id),
        },
        icon('arrowRight'),
      ),
    ),
    h(
      'p',
      { class: 'archive-card-excerpt' },
      lastMessage
        ? truncateText(lastMessage.content.replace(/\s+/g, ' '), 96)
        : '这一段故事还没有开始说话。',
    ),
    h(
      'div',
      { class: 'archive-card-meta' },
      tag(`${archive.messages.length} 条对话`, 'neutral'),
      tag(`${archive.diaries.length} 篇日记`, archive.diaries.length ? 'warm' : 'neutral'),
      tag(`${formatCompactNumber(archive.tokenStats.totalTokens)} tokens`, 'neutral'),
    ),
    h(
      'div',
      { class: 'archive-card-foot' },
      h(
        'span',
        { class: 'archive-updated' },
        icon('clock'),
        h('span', {
          text: `上次对话 ${formatRelative(archive.lastChatAt || archive.updatedAt)}`,
        }),
      ),
      h(
        'div',
        { class: 'archive-card-actions' },
        h(
          'button',
          {
            class: 'btn btn-primary btn-sm',
            type: 'button',
            onclick: () => app.openChat(archive.id),
          },
          h('span', { text: '进入故事' }),
        ),
        h(
          'button',
          {
            class: 'icon-btn subtle',
            type: 'button',
            title: '编辑主人公',
            'aria-label': '编辑主人公',
            onclick: () => {
              openProtagonistEditor(app, archive.id, {
                onSaved: () => app.renderRoute(),
              });
            },
          },
          icon('user'),
        ),
        h(
          'button',
          {
            class: 'icon-btn subtle',
            type: 'button',
            title: '创建副本',
            'aria-label': '创建存档副本',
            onclick: () => duplicateArchive(app, archive),
          },
          icon('copy'),
        ),
        h(
          'button',
          {
            class: 'icon-btn subtle',
            type: 'button',
            title: '导出存档',
            'aria-label': '导出存档',
            onclick: () => exportArchiveBundle(app, archive.id),
          },
          icon('download'),
        ),
        h(
          'button',
          {
            class: 'icon-btn subtle danger-hover',
            type: 'button',
            title: '删除存档',
            'aria-label': '删除存档',
            onclick: async () => {
              const deleted = await deleteArchiveWithConfirm(app, archive.id);
              if (deleted) app.renderRoute();
            },
          },
          icon('trash'),
        ),
      ),
    ),
  );
}

function renderNewCard(app) {
  return h(
    'button',
    {
      class: 'archive-card archive-card-new',
      type: 'button',
      onclick: () => app.navigate('archives/new'),
    },
    h('span', { class: 'new-card-orbit', 'aria-hidden': 'true' }),
    h('span', { class: 'new-card-icon' }, icon('plus')),
    h('strong', { text: '开始一段新故事' }),
    h('span', { text: '选择人格与世界书，写下你的主人公。' }),
  );
}

function duplicateArchive(app, archive) {
  const copy = clone(archive);
  const now = new Date().toISOString();
  copy.id = createId('archive');
  copy.name = `${archive.name} · 副本`;
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.lastChatAt = now;
  copy.messages = archive.messages.map((message) => ({
    ...message,
    id: createId('msg'),
  }));
  copy.diaries = archive.diaries.map((diary) => ({
    ...diary,
    id: createId('diary'),
  }));
  copy.npcs = archive.npcs.map((npc) => ({ ...npc, id: createId('npc') }));
  copy.tokenStats = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimated: 0,
    last: null,
  };

  app.store.update(
    (state) => {
      state.archives.unshift(copy);
    },
    { reason: 'archive-duplicated', archiveId: copy.id },
  );
  app.store.info('archive.duplicated', `从「${archive.name}」创建了存档副本。`, {
    archiveId: copy.id,
  });
  toastSuccess('存档副本已创建。');
  app.renderRoute();
}

function renderWelcome(app) {
  return h(
    'div',
    { class: 'welcome-page' },
    h(
      'section',
      { class: 'welcome-hero' },
      h(
        'div',
        { class: 'welcome-copy' },
        h('p', { class: 'eyebrow', text: '一间属于你的故事小屋' }),
        h(
          'h1',
          { class: 'welcome-title' },
          '把想见的人，',
          h('br'),
          h('em', { text: '安放在一座暖岛上。' }),
        ),
        h('p', {
          class: 'welcome-lede',
          text: '选择一个人格，设定你和 TA 的世界。每次长对话结束后，暖屿会把故事折成一篇日记，让记忆更轻，也让下次重逢更自然。',
        }),
        h(
          'div',
          { class: 'welcome-actions' },
          h(
            'button',
            {
              class: 'btn btn-primary btn-lg',
              type: 'button',
              onclick: () => app.navigate('archives/new'),
            },
            icon('plus'),
            h('span', { text: '创建第一个存档' }),
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-lg',
              type: 'button',
              onclick: () => {
                const demo = createDemoArchive(app.store.state);
                app.store.update(
                  (state) => {
                    state.archives.unshift(demo);
                    state.activeArchiveId = demo.id;
                    // 没有密钥也能完整体验流程；真实模型可在设置中随时启用。
                    state.settings.demoMode = true;
                  },
                  { reason: 'archive-created', archiveId: demo.id },
                );
                app.store.info(
                  'archive.demo-created',
                  '创建了示例存档「雾屿的初见」，并开启离线演示模式。',
                  { archiveId: demo.id },
                );
                toast('示例存档已创建，并开启演示模式。无需密钥即可体验；可在设置中关闭。', {
                  type: 'success',
                  duration: 5_500,
                });
                app.openChat(demo.id);
              },
            },
            icon('spark'),
            h('span', { text: '快速体验' }),
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-lg',
              type: 'button',
              onclick: () => app.navigate('sandbox'),
            },
            icon('compass'),
            h('span', { text: '进入沙盒世界' }),
          ),
        ),
        h(
          'div',
          { class: 'welcome-note' },
          h('span', { class: 'privacy-dot' }),
          h('span', { text: '存档、日记与密钥只保存在本机；无需注册。' }),
        ),
      ),
      h(
        'div',
        { class: 'welcome-art', 'aria-hidden': 'true' },
        h('span', { class: 'art-sun' }),
        h('span', { class: 'art-cloud art-cloud-one' }),
        h('span', { class: 'art-cloud art-cloud-two' }),
        h('span', { class: 'art-island art-island-back' }),
        h('span', { class: 'art-island art-island-front' }),
        h('span', { class: 'art-house' }),
        h('span', { class: 'art-tree' }),
        h('span', { class: 'art-water art-water-one' }),
        h('span', { class: 'art-water art-water-two' }),
        h('span', { class: 'art-star art-star-one' }),
        h('span', { class: 'art-star art-star-two' }),
        h('span', { class: 'art-caption', text: 'warm isle · est. 2026' }),
      ),
    ),
    h(
      'section',
      { class: 'welcome-features' },
      feature('persona', '人格独立存档', '每个人格都有自己的对话、主人公、状态与日记。'),
      feature('brain', '日记代替记忆', '结束一章时压缩成 100–200 字日记，大幅减少后续 token。'),
      feature('book', '世界书与插件', '用世界书托住背景，用高优先级插件调整叙事规则。'),
      feature('shield', '本地优先', '数据在 IndexedDB，API Key 加密保存在本机，不经过第三方服务器。'),
    ),
    h(
      'div',
      { class: 'welcome-start' },
      emptyState({
        iconName: 'sun',
        title: '准备好后，从一个人格开始',
        body: '已有内置人格：沈知夏、江屿、苏晚。也可以创建属于你的人格。',
        actions: [
          h(
            'a',
            { class: 'btn btn-soft', href: '#/personas' },
            icon('persona'),
            h('span', { text: '浏览人格' }),
          ),
          h(
            'a',
            { class: 'btn btn-ghost', href: '#/worldbooks' },
            icon('book'),
            h('span', { text: '浏览世界书' }),
          ),
        ],
      }),
    ),
  );
}

function feature(iconName, title, body) {
  return h(
    'article',
    { class: 'welcome-feature' },
    h('span', { class: 'feature-icon' }, icon(iconName)),
    h('h3', { text: title }),
    h('p', { text: body }),
  );
}
