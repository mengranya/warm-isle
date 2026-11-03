/** 沙盒世界大厅：分类、最近历险、世界书与规则入口。 */

import {
  SANDBOX_CATEGORIES,
  getSandboxCategory,
} from '../core/constants.js';
import {
  downloadJson,
  formatNumber,
  truncateText,
} from '../core/utils.js';
import {
  formatGameDate,
  sandboxSaveFilename,
} from '../data/sandbox-schemas.js';
import { pageHeader, tag } from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const state = app.store.state;
  const saves = [...state.sandboxSaves].sort(
    (a, b) =>
      new Date(b.lastPlayedAt || b.updatedAt) - new Date(a.lastPlayedAt || a.updatedAt),
  );
  const active = saves.find((save) => save.id === state.activeSandboxSaveId) || saves[0];

  function worldbookFor(save) {
    return app.store.getSandboxWorldbook(save.worldbookId);
  }

  const page = h(
    'div',
    { class: 'page page-sandbox-home' },
    pageHeader({
      eyebrow: 'Sandbox worlds · independent mode',
      title: '沙盒世界',
      lede: '你不是在和一个人格聊天，而是在进入一个会自行运转的世界。这里的存档、世界书和规则插件与恋爱对话完全分开。',
      actions: [
        h(
          'a',
          { class: 'btn btn-primary', href: '#/sandbox/new' },
          icon('plus'),
          h('span', { text: '创建沙盒世界' }),
        ),
      ],
    }),
    h(
      'section',
      { class: 'sandbox-hero' },
      h(
        'div',
        { class: 'sandbox-hero-copy' },
        h('p', { class: 'eyebrow', text: 'A world that answers back' }),
        h('h2', { text: '自由行动，世界承担后果。' }),
        h('p', {
          text: '你输入任何行动，世界引擎负责 NPC、势力、时间、资源与因果。行动会经过属性判定，失败也会有真实后果；没有固定的恋爱对象，也没有必须走的剧情线。',
        }),
        h(
          'div',
          { class: 'sandbox-hero-actions' },
          h(
            'a',
            { class: 'btn btn-primary', href: '#/sandbox/new' },
            icon('compass'),
            h('span', { text: '选择世界类型' }),
          ),
          h(
            'a',
            { class: 'btn btn-ghost', href: '#/sandbox/worldbooks' },
            icon('scroll'),
            h('span', { text: '浏览世界书' }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'sandbox-hero-stats' },
        h(
          'div',
          {},
          h('strong', { text: formatNumber(state.sandboxSaves.length) }),
          h('span', { text: '个进行中的世界' }),
        ),
        h(
          'div',
          {},
          h('strong', { text: formatNumber(state.sandboxWorldbooks.length) }),
          h('span', { text: '本独立世界书' }),
        ),
        h(
          'div',
          {},
          h('strong', { text: formatNumber(state.sandboxPlugins.filter((plugin) => plugin.enabled).length) }),
          h('span', { text: '条沙盒规则启用' }),
        ),
      ),
    ),
    h('h2', { class: 'section-heading', text: '选择世界类型' }),
    h(
      'div',
      { class: 'sandbox-category-grid' },
      ...SANDBOX_CATEGORIES.map((category) => {
        const books = state.sandboxWorldbooks.filter(
          (worldbook) => worldbook.category === category.id,
        );
        const categorySaves = saves.filter((save) => save.category === category.id);
        return h(
          'a',
          {
            class: 'sandbox-category-card',
            href: `#/sandbox/new?category=${encodeURIComponent(category.id)}`,
            style: { '--sandbox-accent': category.accent },
          },
          h(
            'div',
            { class: 'sandbox-category-card-head' },
            h('span', { class: 'sandbox-category-card-icon' }, icon(category.icon)),
            h('span', { class: 'sandbox-category-arrow' }, icon('arrowRight')),
          ),
          h('h3', { text: category.label }),
          h('p', { text: category.description }),
          h(
            'div',
            { class: 'sandbox-category-card-meta' },
            h('span', { text: `${books.length} 本世界书` }),
            h('span', { text: `${categorySaves.length} 个存档` }),
          ),
        );
      }),
    ),
    h(
      'div',
      { class: 'section-heading-row' },
      h('h2', { class: 'section-heading', text: '最近的历险' }),
      saves.length
        ? h(
            'span',
            { class: 'muted small' },
            `${saves.length} 个世界在等你回去`,
          )
        : null,
    ),
    saves.length
      ? h(
          'div',
          { class: 'sandbox-save-grid' },
          ...saves.slice(0, 6).map((save) => renderSaveCard(app, save, worldbookFor(save))),
        )
      : h(
          'div',
          { class: 'empty-state sandbox-empty' },
          h('span', { class: 'empty-icon' }, icon('compass')),
          h('h3', { class: 'empty-title', text: '还没有沙盒历险' }),
          h('p', {
            class: 'empty-body',
            text: '从修仙、真实历史或西方玄幻中选一个世界，创建你的第一个角色。',
          }),
          h(
            'a',
            { class: 'btn btn-primary', href: '#/sandbox/new' },
            icon('plus'),
            h('span', { text: '开始第一场历险' }),
          ),
        ),
    h(
      'section',
      { class: 'sandbox-quick-links' },
      h(
        'a',
        { class: 'sandbox-quick-link', href: '#/sandbox/worldbooks' },
        h('span', { class: 'quick-link-icon' }, icon('scroll')),
        h(
          'span',
          {},
          h('strong', { text: '沙盒世界书' }),
          h('small', { text: '新增朝代、宗门、城邦、年份史事与开场' }),
        ),
        icon('chevronRight'),
      ),
      h(
        'a',
        { class: 'sandbox-quick-link', href: '#/sandbox/plugins' },
        h('span', { class: 'quick-link-icon' }, icon('plug')),
        h(
          'span',
          {},
          h('strong', { text: '沙盒规则插件' }),
          h('small', { text: '硬核后果、历史防穿帮、低魔限制；不影响恋爱模式' }),
        ),
        icon('chevronRight'),
      ),
      active
        ? h(
            'button',
            {
              class: 'sandbox-quick-link',
              type: 'button',
              onclick: () => app.openSandbox(active.id),
            },
            h('span', { class: 'quick-link-icon' }, icon('play')),
            h(
              'span',
              {},
              h('strong', { text: '继续上次历险' }),
              h('small', { text: `${active.name} · 第 ${active.turn} 回合` }),
            ),
            icon('chevronRight'),
          )
        : null,
    ),
  );

  root.appendChild(page);
  return { cleanup() {} };
}

function renderSaveCard(app, save, worldbook) {
  const category = getSandboxCategory(save.category);
  const scene = save.world.scene;
  const lastNarrative = [...save.messages].reverse().find((message) => message.role === 'assistant');
  return h(
    'article',
    {
      class: 'sandbox-save-card',
      style: { '--sandbox-accent': category.accent },
    },
    h(
      'div',
      { class: 'sandbox-save-head' },
      h('span', { class: 'sandbox-save-icon' }, icon(category.icon)),
      h(
        'div',
        {},
        h(
          'div',
          { class: 'sandbox-save-title-line' },
          h('h3', { text: save.name }),
          tag(category.shortLabel, 'warm'),
          save.status === 'ended' || save.player.health <= 0
            ? tag('已终结', 'neutral')
            : null,
          save.id === app.store.state.activeSandboxSaveId ? tag('当前', 'sage') : null,
        ),
        h('p', {
          text: `${worldbook?.name || '世界书已移除'} · 第 ${save.turn} 回合`,
        }),
      ),
    ),
    h(
      'div',
      { class: 'sandbox-save-location' },
      icon('pin'),
      h('span', { text: save.world.location }),
      h('span', { class: 'dot-sep', text: '·' }),
      h('span', { text: formatGameDate(save.world.date) }),
    ),
    h('p', {
      class: 'sandbox-save-summary',
      text: truncateText(scene.summary || lastNarrative?.content || '还没有新的叙事。', 170),
    }),
    h(
      'div',
      { class: 'sandbox-save-bars' },
      h(
        'span',
        {},
        h('small', { text: '生命' }),
        h('strong', { text: `${save.player.health}` }),
      ),
      h(
        'span',
        {},
        h('small', { text: '精力' }),
        h('strong', { text: `${save.player.energy}` }),
      ),
      h(
        'span',
        {},
        h('small', { text: save.player.currency }),
        h('strong', { text: `${save.player.money}` }),
      ),
    ),
    h(
      'div',
      { class: 'sandbox-save-actions' },
      h(
        'button',
        {
          class: 'btn btn-primary btn-sm',
          type: 'button',
          onclick: () => app.openSandbox(save.id),
        },
        icon('play'),
        h('span', { text: '继续' }),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '导出存档',
          'aria-label': `导出 ${save.name}`,
          onclick: () => exportSave(app, save),
        },
        icon('download'),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '查看世界状态',
          'aria-label': `查看 ${save.name} 的世界状态`,
          onclick: () => viewState(app, save, worldbook),
        },
        icon('eye'),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle danger-hover',
          type: 'button',
          title: '删除存档',
          'aria-label': `删除 ${save.name}`,
          onclick: () => deleteSave(app, save),
        },
        icon('trash'),
      ),
    ),
  );
}

function viewState(app, save, worldbook) {
  const category = getSandboxCategory(save.category);
  openModal({
    title: save.name,
    eyebrow: `${category.label} · 第 ${save.turn} 回合`,
    subtitle: `${worldbook?.name || '世界书已移除'} · ${save.world.location}`,
    size: 'lg',
    body: h(
      'div',
      { class: 'sandbox-state-detail' },
      h(
        'div',
        { class: 'sandbox-state-summary' },
        h('span', {}, h('small', { text: '当前时间' }), h('strong', { text: `${formatGameDate(save.world.date)} ${save.world.time}` })),
        h('span', {}, h('small', { text: '生命 / 精力' }), h('strong', { text: `${save.player.health} / ${save.player.energy}` })),
        h('span', {}, h('small', { text: '货币' }), h('strong', { text: `${save.player.money} ${save.player.currency}` })),
        h('span', {}, h('small', { text: '境界 / 位阶' }), h('strong', { text: save.player.realm })),
      ),
      h('h3', { text: '当前场景' }),
      h('p', { text: save.world.scene.summary || '暂无场景摘要。' }),
      h('h3', { text: '人物' }),
      h('p', { text: `${save.player.name} · ${save.player.identity} · ${save.player.title}` }),
      h('h3', { text: '物品' }),
      save.player.inventory.length
        ? h(
            'ul',
            { class: 'compact-list' },
            ...save.player.inventory.map((item) =>
              h('li', { text: `${item.name} × ${item.qty}${item.note ? ` · ${item.note}` : ''}` }),
            ),
          )
        : h('p', { class: 'muted', text: '空' }),
      h('h3', { text: '关系' }),
      save.world.relationships.length
        ? h(
            'ul',
            { class: 'compact-list' },
            ...save.world.relationships.map((item) =>
              h('li', { text: `${item.name}（${item.attitude >= 0 ? '+' : ''}${item.attitude}）${item.note ? ` · ${item.note}` : ''}` }),
            ),
          )
        : h('p', { class: 'muted', text: '暂无记录' }),
    ),
    actions: [
      {
        label: '导出存档',
        variant: 'ghost',
        icon: 'download',
        onClick: () => exportSave(app, save),
      },
      { label: '关闭', variant: 'primary' },
    ],
  });
}

async function deleteSave(app, save) {
  const ok = await confirmDialog({
    title: `删除沙盒存档「${save.name}」？`,
    message: '这个世界、角色状态、编年史与对话将从本机删除，无法撤销。建议先导出。',
    confirmText: '删除存档',
    danger: true,
  });
  if (!ok) return;
  app.store.removeSandboxSave(save.id);
  app.store.info('sandbox.deleted', `删除了沙盒存档「${save.name}」。`, {
    archiveId: save.id,
  });
  toastSuccess('沙盒存档已删除。');
  app.renderRoute();
}

function exportSave(app, save) {
  downloadJson(sandboxSaveFilename(save), save);
  app.store.info('sandbox.exported', `导出了沙盒存档「${save.name}」。`, {
    archiveId: save.id,
  });
  toastSuccess('沙盒存档已导出。');
}
