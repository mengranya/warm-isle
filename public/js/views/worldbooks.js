/** 世界书：预设、自建、导入、导出与条目查看。 */

import {
  downloadJson,
  readTextFile,
  sanitizeFileName,
  truncateText,
} from '../core/utils.js';
import {
  exportWorldbookPayload,
  mergeImportedItems,
  prepareWorldbookImport,
} from '../data/schemas.js';
import { pageHeader, tag } from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const { store } = app;
  const state = store.state;

  const importTextarea = h('textarea', {
    class: 'input textarea import-textarea',
    rows: 8,
    placeholder: '把世界书 JSON 粘贴到这里…',
    spellcheck: 'false',
    'aria-label': '世界书 JSON',
  });
  const importFile = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'sr-only',
    id: 'worldbook-file-input',
  });

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
      toastError('请先粘贴世界书 JSON 或选择文件。');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const incoming = prepareWorldbookImport(parsed);
      if (!incoming.length) throw new Error('没有找到可导入的世界书。');
      const merged = mergeImportedItems(store.state.worldbooks, incoming, 'worldbook');
      store.update(
        (next) => {
          next.worldbooks = merged.list;
        },
        { reason: 'worldbook-imported' },
      );
      store.info('worldbook.imported', `导入了 ${merged.imported} 本世界书。`, {
        detail: { names: incoming.map((item) => item.name) },
      });
      toastSuccess(`已导入 ${merged.imported} 本世界书。`, '导入成功');
      app.renderRoute();
    } catch (error) {
      store.logError('worldbook.import.failed', error, { detail: { length: raw.length } });
      toastError(`世界书导入失败：${error.message}`, '无法导入');
    }
  }

  const page = h(
    'div',
    { class: 'page page-worldbooks' },
    pageHeader({
      eyebrow: 'World library',
      title: '世界书',
      lede: '世界书是故事的共同事实：地理、风俗、规则与秘密。对话时只抽取相关条目，不必每轮发送整本书。',
      actions: [
        h(
          'a',
          { class: 'btn btn-primary', href: '#/worldbooks/new' },
          icon('plus'),
          h('span', { text: '创建世界书' }),
        ),
      ],
    }),
    h(
      'div',
      { class: 'worldbook-grid' },
      ...state.worldbooks.map((worldbook, index) =>
        renderWorldbookCard(app, worldbook, index),
      ),
      h(
        'a',
        { class: 'worldbook-card worldbook-card-new', href: '#/worldbooks/new' },
        h('span', { class: 'new-card-icon' }, icon('plus')),
        h('strong', { text: '写一本新世界书' }),
        h('span', { text: '用条目管理地点、风俗、规则和秘密。' }),
      ),
    ),
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
          h('h2', { text: '导入世界书' }),
          h('p', {
            text: '支持单本世界书、数组，或包含 worldbooks 数组的导出文件。条目会自动补齐 ID。',
          }),
        ),
        h(
          'a',
          {
            class: 'text-link',
            href: '/samples/worldbook-mist-harbor.json',
            download: 'worldbook-mist-harbor.json',
          },
          icon('download'),
          '下载示例 JSON',
        ),
      ),
      h(
        'div',
        { class: 'import-grid' },
        h(
          'label',
          {
            class: 'drop-zone',
            for: 'worldbook-file-input',
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
          h('strong', { text: '拖入世界书 JSON 文件' }),
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
              h('span', { text: '导入世界书' }),
            ),
          ),
        ),
      ),
    ),
  );

  page.querySelector('.drop-zone')?.appendChild(importFile);
  root.appendChild(page);
  return { cleanup() {} };
}

function renderWorldbookCard(app, worldbook, index) {
  const usedBy = app.store.state.archives.filter(
    (archive) => archive.worldbookId === worldbook.id,
  ).length;
  const palette = ['#8fae9f', '#c49a74', '#9b8aa7', '#c57f72'];
  const accent = palette[index % palette.length];
  const keywords = [...new Set(worldbook.entries.flatMap((entry) => entry.keywords))].slice(0, 8);

  return h(
    'article',
    {
      class: 'worldbook-card',
      style: { '--worldbook-accent': accent },
    },
    h(
      'div',
      { class: 'worldbook-card-head' },
      h(
        'span',
        { class: 'worldbook-emblem', style: { '--worldbook-accent': accent } },
        icon('book'),
      ),
      h(
        'div',
        { class: 'worldbook-title-wrap' },
        h(
          'div',
          { class: 'worldbook-title-line' },
          h('h2', { text: worldbook.name }),
          worldbook.builtin ? tag('预设', 'warm') : tag('自定义', 'neutral'),
        ),
        h('p', { text: worldbook.description ? truncateText(worldbook.description, 120) : '暂无简介。' }),
      ),
    ),
    h(
      'div',
      { class: 'worldbook-stats' },
      h('span', {}, icon('journal'), h('span', { text: `${worldbook.entries.length} 个条目` })),
      h('span', {}, icon('archive'), h('span', { text: `${usedBy} 个存档在用` })),
      h(
        'span',
        {},
        icon('pin'),
        h('span', { text: `${worldbook.entries.filter((entry) => entry.pinned).length} 个常驻` }),
      ),
    ),
    h(
      'div',
      { class: 'worldbook-entry-preview' },
      ...worldbook.entries.slice(0, 3).map((entry, entryIndex) =>
        h(
          'div',
          { class: 'worldbook-entry-line' },
          h('span', { class: 'entry-index', text: String(entryIndex + 1).padStart(2, '0') }),
          h(
            'span',
            { class: 'entry-copy' },
            h('strong', { text: entry.title }),
            h('span', { text: truncateText(entry.content, 70) }),
          ),
          entry.pinned ? h('span', { class: 'pin-mark' }, icon('pin')) : null,
        ),
      ),
      worldbook.entries.length > 3
        ? h('p', { class: 'muted small', text: `还有 ${worldbook.entries.length - 3} 个条目…` })
        : null,
    ),
    keywords.length
      ? h(
          'div',
          { class: 'worldbook-keywords' },
          ...keywords.map((keyword) => tag(keyword, 'neutral')),
        )
      : null,
    h(
      'div',
      { class: 'worldbook-card-foot' },
      h(
        'a',
        {
          class: 'btn btn-soft btn-sm',
          href: `#/archives/new?worldbook=${encodeURIComponent(worldbook.id)}`,
        },
        icon('plus'),
        h('span', { text: '用此世界开新档' }),
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => openWorldbook(app, worldbook),
        },
        icon('book'),
        h('span', { text: '查看条目' }),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '导出世界书 JSON',
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

function openWorldbook(app, worldbook) {
  const worldbookNow =
    app.store.state.worldbooks.find((item) => item.id === worldbook.id) || worldbook;
  openModal({
    title: worldbookNow.name,
    eyebrow: worldbookNow.builtin ? '预设世界书' : '自定义世界书',
    subtitle: worldbookNow.description,
    size: 'lg',
    body: h(
      'div',
      { class: 'worldbook-detail' },
      ...worldbookNow.entries.map((entry) =>
        h(
          'article',
          { class: 'worldbook-detail-entry' },
          h(
            'div',
            { class: 'worldbook-detail-head' },
            h('h3', { text: entry.title }),
            entry.pinned ? tag('常驻', 'warm') : null,
            h('span', { class: 'entry-priority', text: `优先级 ${entry.priority}` }),
          ),
          h('p', { text: entry.content }),
          entry.keywords.length
            ? h(
                'div',
                { class: 'worldbook-keywords' },
                ...entry.keywords.map((keyword) => tag(keyword, 'neutral')),
              )
            : null,
        ),
      ),
    ),
    actions: [
      {
        label: '导出 JSON',
        variant: 'ghost',
        icon: 'download',
        onClick: () => exportWorldbook(app, worldbookNow),
      },
      { label: '关闭', variant: 'primary' },
    ],
  });
}

function exportWorldbook(app, worldbook) {
  downloadJson(
    `${sanitizeFileName(worldbook.name)}.worldbook.json`,
    exportWorldbookPayload(worldbook),
  );
  app.store.info('worldbook.exported', `导出了世界书「${worldbook.name}」。`);
  toastSuccess(`「${worldbook.name}」已导出。`);
}

async function deleteWorldbook(app, worldbook) {
  const usedBy = app.store.state.archives.filter(
    (archive) => archive.worldbookId === worldbook.id,
  );
  if (usedBy.length) {
    toastError(
      `有 ${usedBy.length} 个存档正在使用「${worldbook.name}」。请先切换这些存档的世界书，或保留它。`,
      '无法删除',
    );
    return;
  }
  const ok = await confirmDialog({
    title: `删除世界书「${worldbook.name}」？`,
    message: '世界书将从本机移除，无法撤销。建议先导出 JSON 备份。',
    confirmText: '删除世界书',
    danger: true,
  });
  if (!ok) return;
  app.store.update(
    (state) => {
      state.worldbooks = state.worldbooks.filter((item) => item.id !== worldbook.id);
    },
    { reason: 'worldbook-deleted' },
  );
  app.store.info('worldbook.deleted', `删除了世界书「${worldbook.name}」。`);
  toastSuccess('世界书已删除。');
  app.renderRoute();
}
