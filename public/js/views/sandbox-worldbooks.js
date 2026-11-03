/** 沙盒世界书：与恋爱世界书分开的设定库，支持历史年份与独立导入导出。 */

import {
  SANDBOX_CATEGORIES,
  getSandboxCategory,
} from '../core/constants.js';
import {
  downloadJson,
  readTextFile,
  sanitizeFileName,
  truncateText,
} from '../core/utils.js';
import {
  exportSandboxWorldbookPayload,
  formatHistoricalYearMonth,
  formatHistoricalYearRange,
  prepareSandboxWorldbookImport,
  sandboxWorldbookFilename,
} from '../data/sandbox-schemas.js';
import { mergeImportedItems } from '../data/schemas.js';
import { pageHeader, tag } from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const { store } = app;
  let activeCategory = 'all';

  const importTextarea = h('textarea', {
    class: 'input textarea import-textarea',
    rows: 8,
    placeholder: '粘贴沙盒世界书 JSON…',
    spellcheck: 'false',
    'aria-label': '沙盒世界书 JSON',
  });
  const importFile = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'sr-only',
    id: 'sandbox-worldbook-file',
  });
  const grid = h('div', { class: 'sandbox-worldbook-grid' });
  const filterBar = h('div', { class: 'sandbox-category-tabs' });

  async function loadFile(file) {
    try {
      importTextarea.value = await readTextFile(file);
      importTextarea.focus();
      toast(`已读取「${file.name}」，确认后导入。`, { type: 'info' });
    } catch (error) {
      toastError(error.message);
    }
  }

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (file) await loadFile(file);
    importFile.value = '';
  });

  function doImport() {
    const raw = importTextarea.value.trim();
    if (!raw) {
      toastError('请先粘贴沙盒世界书 JSON 或选择文件。');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const incoming = prepareSandboxWorldbookImport(parsed);
      if (!incoming.length) throw new Error('没有找到可导入的沙盒世界书。');
      const merged = mergeImportedItems(
        store.state.sandboxWorldbooks,
        incoming,
        'sbworld',
      );
      store.update(
        (state) => {
          state.sandboxWorldbooks = merged.list;
        },
        { reason: 'sandbox-worldbook-imported' },
      );
      store.info(
        'sandbox.worldbook.imported',
        `导入了 ${merged.imported} 本沙盒世界书。`,
        { detail: { names: incoming.map((worldbook) => worldbook.name) } },
      );
      toastSuccess(`已导入 ${merged.imported} 本沙盒世界书。`, '导入成功');
      app.renderRoute();
    } catch (error) {
      store.logError('sandbox.worldbook.import.failed', error, {
        detail: { length: raw.length },
      });
      toastError(`导入失败：${error.message}`, '无法导入');
    }
  }

  function renderFilters() {
    const entries = [
      { id: 'all', label: '全部', count: store.state.sandboxWorldbooks.length },
      ...SANDBOX_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.shortLabel,
        count: store.state.sandboxWorldbooks.filter(
          (worldbook) => worldbook.category === category.id,
        ).length,
      })),
    ];
    filterBar.replaceChildren(
      ...entries.map((entry) =>
        h(
          'button',
          {
            class: `sandbox-filter ${activeCategory === entry.id ? 'is-active' : ''}`.trim(),
            type: 'button',
            onclick: () => {
              activeCategory = entry.id;
              renderFilters();
              renderGrid();
            },
          },
          h('span', { text: entry.label }),
          h('span', { class: 'filter-count', text: String(entry.count) }),
        ),
      ),
    );
  }

  function renderGrid() {
    const worldbooks = [...store.state.sandboxWorldbooks]
      .filter(
        (worldbook) =>
          activeCategory === 'all' || worldbook.category === activeCategory,
      )
      .sort(
        (a, b) =>
          Number(b.builtin) - Number(a.builtin) ||
          SANDBOX_CATEGORIES.findIndex((category) => category.id === a.category) -
            SANDBOX_CATEGORIES.findIndex((category) => category.id === b.category) ||
          (a.era?.startYear ?? 0) - (b.era?.startYear ?? 0),
      );

    if (!worldbooks.length) {
      grid.replaceChildren(
        h(
          'div',
          { class: 'empty-state' },
          h('span', { class: 'empty-icon' }, icon('scroll')),
          h('h3', { class: 'empty-title', text: '这个分类还没有世界书' }),
          h('p', {
            class: 'empty-body',
            text: '创建一本世界书，或导入其他人分享的 JSON。',
          }),
          h(
            'a',
            { class: 'btn btn-primary', href: '#/sandbox/worldbooks/new' },
            icon('plus'),
            h('span', { text: '创建世界书' }),
          ),
        ),
      );
      return;
    }

    grid.replaceChildren(
      ...worldbooks.map((worldbook) => renderCard(app, worldbook)),
      h(
        'a',
        { class: 'sandbox-worldbook-new', href: '#/sandbox/worldbooks/new' },
        h('span', { class: 'new-card-icon' }, icon('plus')),
        h('strong', { text: '写一本沙盒世界书' }),
        h('span', { text: '可以设定修仙、真实历史年份或西方玄幻。' }),
      ),
    );
  }

  const page = h(
    'div',
    { class: 'page page-sandbox-worldbooks' },
    pageHeader({
      eyebrow: 'Sandbox world library',
      title: '沙盒世界书',
      lede: '世界书决定沙盒里的制度、年代、势力、资源与生活常识。它与恋爱模式的世界书互不影响。',
      actions: [
        h(
          'a',
          {
            class: 'btn btn-primary',
            href: '#/sandbox/worldbooks/new',
          },
          icon('plus'),
          h('span', { text: '创建沙盒世界书' }),
        ),
      ],
    }),
    h(
      'div',
      { class: 'sandbox-mode-note' },
      icon('compass'),
      h(
        'div',
        {},
        h('strong', { text: '真实历史年份可以直接映射' }),
        h('p', {
          text: '历史类世界书带有起止年份；创建存档时选择年份，会注入该年份对应的时代阶段与已经发生的史事，未来事件不会提前剧透。',
        }),
      ),
    ),
    filterBar,
    grid,
    h(
      'section',
      { class: 'import-section' },
      h(
        'div',
        { class: 'import-section-head' },
        h('span', { class: 'section-index', text: 'IMPORT' }),
        h(
          'div',
          {},
          h('h2', { text: '导入沙盒世界书' }),
          h('p', {
            text: '支持单本、数组，或包含 sandboxWorldbooks / worldbooks 数组的导出文件。',
          }),
        ),
      ),
      h(
        'div',
        { class: 'import-grid' },
        h(
          'label',
          {
            class: 'drop-zone',
            for: 'sandbox-worldbook-file',
            ondragover: (event) => {
              event.preventDefault();
              event.currentTarget.classList.add('is-dragging');
            },
            ondragleave: (event) => event.currentTarget.classList.remove('is-dragging'),
            ondrop: async (event) => {
              event.preventDefault();
              event.currentTarget.classList.remove('is-dragging');
              const file = event.dataTransfer?.files?.[0];
              if (file) await loadFile(file);
            },
          },
          icon('upload'),
          h('strong', { text: '拖入沙盒世界书 JSON' }),
          h('span', { text: '或点击选择文件' }),
        ),
        h(
          'div',
          { class: 'import-editor' },
          importTextarea,
          h(
            'div',
            { class: 'import-actions' },
            h(
              'button',
              {
                class: 'btn btn-ghost',
                type: 'button',
                onclick: () => {
                  importTextarea.value = '';
                  importTextarea.focus();
                },
              },
              h('span', { text: '清空' }),
            ),
            h(
              'button',
              { class: 'btn btn-primary', type: 'button', onclick: doImport },
              icon('upload'),
              h('span', { text: '导入沙盒世界书' }),
            ),
          ),
        ),
      ),
    ),
  );

  page.querySelector('.drop-zone')?.appendChild(importFile);
  root.appendChild(page);
  renderFilters();
  renderGrid();
  return { cleanup() {} };
}

function renderCard(app, worldbook) {
  const category = getSandboxCategory(worldbook.category);
  const usedBy = app.store.state.sandboxSaves.filter(
    (save) => save.worldbookId === worldbook.id,
  ).length;
  const eraText = worldbook.era?.enabled
    ? `${worldbook.era.label || worldbook.era.dynasty} · 可选择 ${formatHistoricalYearRange(
        worldbook.era.startYear,
        worldbook.era.endYear,
      )} 年`
    : '无固定历史年份';

  return h(
    'article',
    {
      class: 'sandbox-worldbook-card',
      style: { '--sandbox-accent': category.accent },
    },
    h(
      'div',
      { class: 'sandbox-worldbook-head' },
      h('span', { class: 'sandbox-worldbook-emblem' }, icon(category.icon)),
      h(
        'div',
        {},
        h(
          'div',
          { class: 'sandbox-worldbook-title-line' },
          h('h2', { text: worldbook.name }),
          tag(category.shortLabel, 'warm'),
          worldbook.builtin ? tag('预设', 'sage') : tag('自定义', 'neutral'),
        ),
        h('p', { text: truncateText(worldbook.description, 140) || '暂无简介。' }),
      ),
    ),
    h(
      'div',
      { class: 'sandbox-worldbook-meta' },
      h('span', {}, icon('map'), h('span', { text: eraText })),
      h('span', {}, icon('journal'), h('span', { text: `${worldbook.entries.length} 个设定条目` })),
      h(
        'span',
        {},
        icon('play'),
        h('span', { text: `${worldbook.scenarios.length} 个开场` }),
      ),
      usedBy ? h('span', {}, icon('archive'), h('span', { text: `${usedBy} 个存档` })) : null,
    ),
    h(
      'div',
      { class: 'sandbox-worldbook-tags' },
      ...(worldbook.tags || []).slice(0, 5).map((text) => tag(text, 'neutral')),
    ),
    h(
      'div',
      { class: 'sandbox-worldbook-foot' },
      h(
        'a',
        {
          class: 'btn btn-primary btn-sm',
          href: `#/sandbox/new?worldbook=${encodeURIComponent(worldbook.id)}`,
        },
        icon('play'),
        h('span', { text: '以此开始' }),
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => viewWorldbook(app, worldbook),
        },
        icon('book'),
        h('span', { text: '查看设定' }),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '导出世界书',
          'aria-label': `导出 ${worldbook.name}`,
          onclick: () => exportWorldbook(app, worldbook),
        },
        icon('download'),
      ),
      !worldbook.builtin
        ? h(
            'button',
            {
              class: 'icon-btn subtle danger-hover',
              type: 'button',
              title: '删除世界书',
              'aria-label': `删除 ${worldbook.name}`,
              onclick: () => deleteWorldbook(app, worldbook),
            },
            icon('trash'),
          )
        : null,
    ),
  );
}

function viewWorldbook(app, worldbook) {
  const category = getSandboxCategory(worldbook.category);
  const era = worldbook.era?.enabled ? worldbook.era : null;
  openModal({
    title: worldbook.name,
    eyebrow: `${category.label}${worldbook.builtin ? ' · 预设' : ''}`,
    subtitle: worldbook.description,
    size: 'xl',
    body: h(
      'div',
      { class: 'sandbox-worldbook-detail' },
      era
        ? h(
            'div',
            { class: 'sandbox-era-overview' },
            h('span', { class: 'sandbox-era-badge' }, icon('scroll'), h('span', { text: era.label || era.dynasty })),
            h('p', {
              text: `可选择年份：${formatHistoricalYearRange(
                era.startYear,
                era.endYear,
              )} 年；推荐开局：${formatHistoricalYearMonth(
                era.defaultYear,
                worldbook.defaults?.date?.month || 1,
              )}。`,
            }),
            h(
              'div',
              { class: 'sandbox-era-periods' },
              ...era.periods.map((period) =>
                h(
                  'span',
                  { class: 'sandbox-period-chip' },
                  h('strong', { text: period.name }),
                  h('small', {
                    text: formatHistoricalYearRange(period.startYear, period.endYear),
                  }),
                ),
              ),
            ),
          )
        : null,
      h('h3', { class: 'sandbox-detail-title', text: '世界规则' }),
      h('p', { class: 'sandbox-detail-rule', text: worldbook.genreRules || '无额外规则。' }),
      h('h3', { class: 'sandbox-detail-title', text: '设定条目' }),
      ...worldbook.entries.map((entry) =>
        h(
          'article',
          { class: 'sandbox-entry-detail' },
          h(
            'div',
            { class: 'sandbox-entry-head' },
            h('strong', { text: entry.title }),
            entry.pinned ? tag('常驻', 'warm') : null,
            h('span', { class: 'entry-priority', text: `优先级 ${entry.priority}` }),
          ),
          h('p', { text: entry.content }),
        ),
      ),
      worldbook.scenarios.length
        ? h('h3', { class: 'sandbox-detail-title', text: '可用开场' })
        : null,
      ...worldbook.scenarios.map((scenario) =>
        h(
          'div',
          { class: 'sandbox-scenario-detail' },
          h('strong', { text: scenario.title }),
          h('small', { text: scenario.location }),
          h('p', { text: scenario.description || scenario.opening }),
        ),
      ),
      era?.events?.length
        ? h('h3', { class: 'sandbox-detail-title', text: '年份史事' })
        : null,
      ...(era?.events || []).slice(-12).map((event) =>
        h(
          'div',
          { class: 'sandbox-event-detail' },
          h('span', { class: 'entry-index', text: String(event.year) }),
          h('div', {}, h('strong', { text: event.title }), h('p', { text: event.content })),
        ),
      ),
    ),
    actions: [
      {
        label: '导出 JSON',
        variant: 'ghost',
        icon: 'download',
        onClick: () => exportWorldbook(app, worldbook),
      },
      { label: '关闭', variant: 'primary' },
    ],
  });
}

function exportWorldbook(app, worldbook) {
  downloadJson(
    sandboxWorldbookFilename(worldbook),
    exportSandboxWorldbookPayload(worldbook),
  );
  app.store.info(
    'sandbox.worldbook.exported',
    `导出了沙盒世界书「${worldbook.name}」。`,
  );
  toastSuccess('沙盒世界书已导出。');
}

async function deleteWorldbook(app, worldbook) {
  const usedBy = app.store.state.sandboxSaves.filter(
    (save) => save.worldbookId === worldbook.id,
  );
  if (usedBy.length) {
    toastError(
      `仍有 ${usedBy.length} 个沙盒存档在使用「${worldbook.name}」，不能删除。`,
      '无法删除',
    );
    return;
  }
  const ok = await confirmDialog({
    title: `删除世界书「${worldbook.name}」？`,
    message: '沙盒世界书将从本机移除，无法撤销。建议先导出 JSON。',
    confirmText: '删除世界书',
    danger: true,
  });
  if (!ok) return;
  app.store.update(
    (state) => {
      state.sandboxWorldbooks = state.sandboxWorldbooks.filter(
        (item) => item.id !== worldbook.id,
      );
    },
    { reason: 'sandbox-worldbook-deleted' },
  );
  app.store.info(
    'sandbox.worldbook.deleted',
    `删除了沙盒世界书「${worldbook.name}」。`,
  );
  toastSuccess('沙盒世界书已删除。');
  app.renderRoute();
}

export { exportWorldbook };
