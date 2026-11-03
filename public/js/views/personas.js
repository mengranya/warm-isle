/** 人格工坊：管理预设与自定义人格，导入 / 导出 JSON。 */

import { appendEmojiTail } from '../core/parse.js';
import {
  downloadJson,
  readTextFile,
  safeColor,
  truncateText,
} from '../core/utils.js';
import {
  exportPersonaPayload,
  mergeImportedItems,
  personaExportFilename,
  preparePersonaImport,
} from '../data/schemas.js';
import {
  avatar,
  pageHeader,
  tag,
} from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const { store } = app;
  const state = store.state;
  const activeArchive = store.getActiveArchive();
  const activePersonaId = activeArchive?.personaId || null;
  const activePersona = activePersonaId ? store.getPersona(activePersonaId) : null;

  const importTextarea = h('textarea', {
    class: 'input textarea import-textarea',
    rows: 8,
    placeholder: '把人格 JSON 粘贴到这里…',
    spellcheck: 'false',
    'aria-label': '人格 JSON',
  });
  const importFile = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'sr-only',
    id: 'persona-file-input',
  });
  const dropZone = h(
    'label',
    {
      class: 'drop-zone',
      for: 'persona-file-input',
      ondragover: (event) => {
        event.preventDefault();
        dropZone.classList.add('is-dragging');
      },
      ondragleave: () => dropZone.classList.remove('is-dragging'),
      ondrop: async (event) => {
        event.preventDefault();
        dropZone.classList.remove('is-dragging');
        const file = event.dataTransfer?.files?.[0];
        if (file) await loadFile(file);
      },
    },
    icon('upload'),
    h('strong', { text: '拖入人格 JSON 文件' }),
    h('span', { text: '或点击选择文件 · 也支持多个人格的数组' }),
  );

  async function loadFile(file) {
    try {
      const text = await readTextFile(file);
      importTextarea.value = text;
      importTextarea.focus();
      toast(`已读取「${file.name}」，确认后点击导入。`, { type: 'info' });
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
      toastError('请先粘贴人格 JSON 或选择文件。');
      importTextarea.focus();
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const incoming = preparePersonaImport(parsed);
      if (!incoming.length) throw new Error('没有找到可导入的人格。');
      const merged = mergeImportedItems(store.state.personas, incoming, 'persona');
      store.update(
        (next) => {
          next.personas = merged.list;
        },
        { reason: 'persona-imported' },
      );
      store.info('persona.imported', `导入了 ${merged.imported} 个人格。`, {
        detail: { names: incoming.map((persona) => persona.name) },
      });
      toastSuccess(`已导入 ${merged.imported} 个人格。`, '导入成功');
      app.renderRoute();
    } catch (error) {
      store.logError('persona.import.failed', error, {
        detail: { length: raw.length },
      });
      toastError(`人格导入失败：${error.message}`, '无法导入');
    }
  }

  const page = h(
    'div',
    { class: 'page page-personas' },
    pageHeader({
      eyebrow: 'Persona studio',
      title: '人格工坊',
      lede: '人格决定 TA 是谁、如何说话、用哪种颜色出现。每个存档会锁住一个人格，并拥有独立对话与日记。',
      actions: [
        activePersona
          ? h(
              'button',
              {
                class: 'btn btn-ghost',
                type: 'button',
                onclick: () => exportPersona(app, activePersona, { current: true }),
              },
              icon('download'),
              h('span', { text: '导出当前人格' }),
            )
          : null,
        h(
          'a',
          { class: 'btn btn-primary', href: '#/personas/new' },
          icon('plus'),
          h('span', { text: '创建人格' }),
        ),
      ],
    }),
    h(
      'div',
      { class: 'persona-toolbar' },
      h(
        'div',
        { class: 'persona-counts' },
        h('span', { class: 'count-pill' }, h('strong', { text: state.personas.length }), ' 个人格'),
        h(
          'span',
          { class: 'count-pill' },
          h('strong', { text: state.personas.filter((persona) => persona.builtin).length }),
          ' 个预设',
        ),
        activePersona
          ? h(
              'span',
              { class: 'count-pill current-persona-pill' },
              icon('star'),
              h('span', { text: `当前：${activePersona.name}` }),
            )
          : null,
      ),
      h(
        'p',
        { class: 'muted small' },
        '视觉颜色与动画只在前端生效，不会浪费模型 token。',
      ),
    ),
    h(
      'div',
      { class: 'persona-grid' },
      ...state.personas.map((persona) => renderPersonaCard(app, persona, activePersonaId)),
      h(
        'a',
        { class: 'persona-card persona-card-new', href: '#/personas/new' },
        h('span', { class: 'new-card-icon' }, icon('plus')),
        h('strong', { text: '创建一个新人格' }),
        h('span', { text: '用辅助表单生成标准 JSON，不调用 AI。' }),
      ),
    ),
    h(
      'section',
      { class: 'import-section', id: 'persona-import' },
      h(
        'div',
        { class: 'import-section-head' },
        h('span', { class: 'section-index', text: 'IMPORT' }),
        h(
          'div',
          {},
          h('h2', { text: '导入人格' }),
          h('p', {
            text: '支持单个人格对象、数组，或包含 personas 数组的导出文件。导入会分配新 ID，同名会附加序号。',
          }),
        ),
        h(
          'a',
          {
            class: 'text-link',
            href: '/samples/persona-shenzhixia.json',
            download: 'persona-shenzhixia.json',
          },
          icon('download'),
          '下载示例 JSON',
        ),
      ),
      h(
        'div',
        { class: 'import-grid' },
        dropZone,
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
              {
                class: 'btn btn-primary',
                type: 'button',
                onclick: doImport,
              },
              icon('upload'),
              h('span', { text: '导入人格' }),
            ),
          ),
        ),
      ),
      h(
        'details',
        { class: 'format-details' },
        h('summary', {}, '人格 JSON 字段说明'),
        h(
          'div',
          { class: 'format-code' },
          h('p', { text: '必填：name（姓名）。建议包含：' }),
          h('ul', {},
            h('li', { text: 'age / identity / personality / appearance / background / likes' }),
            h('li', { text: 'address：角色对玩家的称呼' }),
            h('li', { text: 'dialogue.color：HEX 颜色；dialogue.animation：none | bounce | gradient | glow' }),
            h('li', { text: 'dialogue.emojiEnabled / dialogue.emojis / dialogue.habits' }),
          ),
        ),
      ),
    ),
  );

  dropZone.appendChild(importFile);
  root.appendChild(page);
  return { cleanup() {} };
}

function renderPersonaCard(app, persona, activePersonaId) {
  const color = safeColor(persona.dialogue?.color, '#c56b57');
  const animation = persona.dialogue?.animation || 'none';
  const isActive = persona.id === activePersonaId;
  const preview = appendEmojiTail(
    truncateText(persona.greeting || persona.personality || '……', 80),
    persona,
    `card:${persona.id}`,
  );

  return h(
    'article',
    {
      class: `persona-card ${isActive ? 'is-current' : ''}`.trim(),
      style: { '--persona-accent': color },
    },
    h(
      'div',
      { class: 'persona-card-top' },
      avatar(persona, { size: 'lg' }),
      h(
        'div',
        { class: 'persona-name-wrap' },
        h(
          'div',
          { class: 'persona-name-line' },
          h('h2', { text: persona.name }),
          persona.builtin ? tag('预设', 'warm') : tag('自定义', 'neutral'),
          isActive ? h('span', { class: 'current-badge', text: '当前' }) : null,
        ),
        h('p', { class: 'persona-identity', text: persona.identity }),
      ),
    ),
    h(
      'div',
      { class: 'persona-facts' },
      h('span', {}, icon('user'), h('span', { text: `${persona.age || '未知'} 岁 · ${persona.pronouns || 'TA'}` })),
      h('span', {}, icon('heart'), h('span', { text: `称呼你「${persona.address || '你'}」` })),
    ),
    h(
      'div',
      { class: `persona-bubble-preview bubble anim-${animation}` },
      h('p', { text: preview }),
    ),
    h(
      'div',
      { class: 'persona-tags' },
      ...(persona.tags || []).slice(0, 4).map((text) => tag(text, 'neutral')),
    ),
    h(
      'div',
      { class: 'persona-meta-row' },
      h(
        'span',
        { class: 'persona-meta' },
        h('span', { class: 'inline-color-dot', style: { background: color } }),
        h('code', { text: color }),
      ),
      h(
        'span',
        { class: 'persona-meta' },
        icon('spark'),
        h('span', { text: animationLabel(animation) }),
      ),
      h(
        'span',
        { class: 'persona-meta' },
        h('span', { text: persona.dialogue?.emojiEnabled ? '结尾 emoji' : '无 emoji' }),
      ),
    ),
    h(
      'div',
      { class: 'persona-card-foot' },
      h(
        'a',
        {
          class: 'btn btn-primary btn-sm',
          href: `#/archives/new?persona=${encodeURIComponent(persona.id)}`,
        },
        icon('plus'),
        h('span', { text: '以此创建存档' }),
      ),
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          title: '导出人格 JSON',
          'aria-label': `导出 ${persona.name}`,
          onclick: () => exportPersona(app, persona),
        },
        icon('download'),
      ),
      !persona.builtin
        ? h(
            'button',
            {
              class: 'icon-btn subtle danger-hover',
              type: 'button',
              title: '删除人格',
              'aria-label': `删除 ${persona.name}`,
              onclick: () => deletePersona(app, persona),
            },
            icon('trash'),
          )
        : h(
            'span',
            { class: 'builtin-note', text: '内置人格不可删除' },
          ),
    ),
  );
}

function animationLabel(id) {
  return (
    {
      none: '自然平静',
      bounce: '轻轻跳动',
      gradient: '彩色流光',
      glow: '暖光呼吸',
    }[id] || '自然平静'
  );
}

async function deletePersona(app, persona) {
  const usedBy = app.store.state.archives.filter((archive) => archive.personaId === persona.id);
  if (usedBy.length) {
    toastError(
      `仍有 ${usedBy.length} 个存档在使用「${persona.name}」。请先删除这些存档，或保留人格。`,
      '无法删除',
    );
    return;
  }
  const ok = await confirmDialog({
    title: `删除人格「${persona.name}」？`,
    message: '人格 JSON 将从本机移除，无法撤销。建议先导出一份备份。',
    confirmText: '删除人格',
    danger: true,
  });
  if (!ok) return;
  app.store.update(
    (state) => {
      state.personas = state.personas.filter((item) => item.id !== persona.id);
    },
    { reason: 'persona-deleted' },
  );
  app.store.info('persona.deleted', `删除了人格「${persona.name}」。`);
  toastSuccess('人格已删除。');
  app.renderRoute();
}

function exportPersona(app, persona, { current = false } = {}) {
  downloadJson(personaExportFilename(persona), exportPersonaPayload(persona));
  app.store.info('persona.exported', `导出了人格「${persona.name}」。`, {
    detail: { current },
  });
  toastSuccess(`「${persona.name}」的人格 JSON 已导出。`);
}
