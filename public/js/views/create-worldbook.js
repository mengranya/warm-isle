/**
 * 辅助创建世界书。
 * 与人格辅助页同构：本地表单 -> 标准 JSON，全程不调用 AI。
 */

import {
  createId,
  downloadJson,
  truncateText,
} from '../core/utils.js';
import { copyText } from '../ui/dom.js';
import { normalizeWorldbook } from '../data/schemas.js';
import {
  field,
  input,
  pageHeader,
  tag,
  textarea,
} from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

const DRAFT_ID = createId('world');

export async function render(root, app) {
  const entries = [];
  const entriesContainer = h('div', { class: 'entry-editor-list' });
  const jsonPreview = h('pre', { class: 'json-preview', spellcheck: 'false' });
  const jsonStats = h('span', { class: 'muted small' });
  const liveEntryPreview = h('div', { class: 'worldbook-live-entries' });
  let previewJson = '';
  let saved = false;

  const nameInput = input({
    id: 'w-name',
    maxLength: 80,
    required: true,
    placeholder: '比如：雾屿镇',
  });
  const descriptionInput = textarea({
    id: 'w-description',
    rows: 4,
    maxLength: 1_200,
    placeholder: '这是一座怎样的地方？时代、氛围、最重要的规则是什么？',
  });
  const tagsInput = input({
    id: 'w-tags',
    maxLength: 300,
    placeholder: '治愈、海边、慢生活（逗号分隔）',
  });

  const form = h(
    'form',
    {
      class: 'worldbook-form',
      id: 'worldbook-form',
      onsubmit: (event) => {
        event.preventDefault();
        saveWorldbook();
      },
    },
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '01' }),
        h(
          'div',
          {},
          h('h2', { text: '为世界命名' }),
          h('p', { text: '简介会作为背景摘要进入提示词；条目则按关键词相关性挑选。' }),
        ),
      ),
      field({ label: '世界书名称', required: true, control: nameInput, htmlFor: 'w-name' }),
      field({
        label: '背景简介',
        control: descriptionInput,
        htmlFor: 'w-description',
        hint: '建议 100–300 字，写清时代、地点、氛围与核心冲突。',
      }),
      field({ label: '标签', control: tagsInput, htmlFor: 'w-tags' }),
    ),
    h(
      'section',
      { class: 'form-card worldbook-entry-section' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '02' }),
        h(
          'div',
          {},
          h('h2', { text: '添加世界条目' }),
          h('p', {
            text: '条目是检索单位。关键词越贴合对话，越容易被选中；常驻条目每轮都会进入提示词。',
          }),
        ),
        h(
          'button',
          { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => addEntry() },
          icon('plus'),
          h('span', { text: '添加条目' }),
        ),
      ),
      entriesContainer,
      h(
        'div',
        { class: 'entry-section-foot' },
        h('span', { class: 'muted small', text: '建议 3–8 个条目，每条约 100–400 字。' }),
        h(
          'button',
          { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addEntry() },
          icon('plus'),
          h('span', { text: '再加一条' }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'create-form-actions' },
      h('a', { class: 'btn btn-ghost', href: '#/worldbooks' }, icon('arrowLeft'), h('span', { text: '返回' })),
      h(
        'button',
        { class: 'btn btn-primary btn-lg', type: 'submit', form: 'worldbook-form' },
        icon('book'),
        h('span', { text: '保存世界书' }),
      ),
    ),
  );

  const previewAside = h(
    'aside',
    { class: 'create-preview worldbook-preview-aside' },
    h(
      'div',
      { class: 'preview-sticky' },
      h(
        'div',
        { class: 'preview-head' },
        h(
          'div',
          {},
          h('p', { class: 'eyebrow', text: 'Live outline' }),
          h('h2', { class: 'preview-title', text: '世界轮廓' }),
        ),
        h(
          'span',
          { class: 'local-only-badge' },
          icon('shield'),
          h('span', { text: '本地生成 · 不调用 AI' }),
        ),
      ),
      h(
        'div',
        { class: 'worldbook-live-card' },
        h('span', { class: 'worldbook-live-emblem' }, icon('book')),
        h('h3', { class: 'worldbook-live-title', text: '未命名世界' }),
        h('p', { class: 'worldbook-live-desc', text: '填写名称和简介后，这里会出现世界轮廓。' }),
        liveEntryPreview,
      ),
      h(
        'div',
        { class: 'json-panel' },
        h(
          'div',
          { class: 'json-panel-head' },
          h('strong', { text: '世界书 JSON' }),
          jsonStats,
          h(
            'div',
            { class: 'json-actions' },
            h(
              'button',
              {
                class: 'icon-btn subtle',
                type: 'button',
                title: '复制 JSON',
                'aria-label': '复制 JSON',
                onclick: async () => {
                  const ok = await copyText(previewJson);
                  toast(ok ? 'JSON 已复制。' : '复制失败。', {
                    type: ok ? 'success' : 'error',
                    duration: 1_800,
                  });
                },
              },
              icon('copy'),
            ),
            h(
              'button',
              {
                class: 'icon-btn subtle',
                type: 'button',
                title: '下载 JSON',
                'aria-label': '下载 JSON',
                onclick: () => {
                  try {
                    downloadJson('worldbook-draft.json', JSON.parse(previewJson));
                    app.store.info('worldbook.draft.exported', '下载了世界书 JSON 草稿。');
                  } catch {
                    toastError('请先填写世界书名称。');
                  }
                },
              },
              icon('download'),
            ),
          ),
        ),
        jsonPreview,
      ),
    ),
  );

  const page = h(
    'div',
    { class: 'page page-worldbook-create' },
    pageHeader({
      eyebrow: 'World builder · local generator',
      title: '创建世界书',
      lede: '先写世界的轮廓，再拆成可被检索的条目。此页面不接入 AI，只生成标准 JSON。',
      actions: [
        h(
          'span',
          { class: 'local-only-badge page-badge' },
          icon('shield'),
          h('span', { text: '不消耗 token' }),
        ),
      ],
    }),
    h('div', { class: 'create-layout worldbook-create-layout' }, form, previewAside),
  );

  root.appendChild(page);

  /* ------------------------------ 条目编辑 ------------------------------ */

  function addEntry(initial = {}) {
    const id = initial.id || createId('entry');
    const entry = {
      id,
      titleInput: input({
        value: initial.title || '',
        placeholder: '条目名称，如：重要地点',
        maxLength: 80,
        'aria-label': '条目名称',
      }),
      keywordsInput: input({
        value: (initial.keywords || []).join('、'),
        placeholder: '关键词：码头、灯塔、旧街（用顿号或逗号分隔）',
        maxLength: 400,
        'aria-label': '条目关键词',
      }),
      contentInput: textarea({
        value: initial.content || '',
        rows: 4,
        maxLength: 3_000,
        placeholder: '这个条目所描述的世界事实。写具体的场景与规则，避免空泛。',
        'aria-label': '条目内容',
      }),
      pinnedInput: h('input', {
        type: 'checkbox',
        checked: Boolean(initial.pinned),
        onchange: scheduleUpdate,
      }),
      priorityInput: input({
        type: 'number',
        value: initial.priority ?? 70,
        min: 0,
        max: 100,
        step: 1,
        class: 'priority-input',
        'aria-label': '条目优先级',
      }),
      indexLabel: h('span', { class: 'entry-order' }),
    };
    const card = h(
      'article',
      { class: 'entry-editor-card', 'data-entry-id': id },
      h(
        'div',
        { class: 'entry-editor-head' },
        entry.indexLabel,
        h(
          'div',
          { class: 'entry-editor-title-wrap' },
          entry.titleInput,
        ),
        h(
          'div',
          { class: 'entry-editor-controls' },
          h(
            'label',
            { class: 'mini-check' },
            entry.pinnedInput,
            h('span', { text: '常驻' }),
          ),
          h(
            'label',
            { class: 'priority-field', title: '优先级越高，越容易被选中' },
            h('span', { text: '优先级' }),
            entry.priorityInput,
          ),
          h(
            'button',
            {
              class: 'icon-btn subtle danger-hover',
              type: 'button',
              title: '删除条目',
              'aria-label': '删除条目',
              onclick: () => {
                const index = entries.findIndex((item) => item.id === id);
                if (index >= 0) entries.splice(index, 1);
                card.remove();
                refreshIndices();
                updatePreview();
              },
            },
            icon('trash'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'entry-editor-body' },
        h('label', { class: 'entry-label' }, h('span', { text: '关键词' }), entry.keywordsInput),
        h('label', { class: 'entry-label' }, h('span', { text: '内容' }), entry.contentInput),
      ),
    );

    const record = { id, card, ...entry };
    entries.push(record);
    entriesContainer.appendChild(card);
    for (const element of [entry.titleInput, entry.keywordsInput, entry.contentInput, entry.priorityInput]) {
      element.addEventListener('input', scheduleUpdate);
    }
    entry.pinnedInput.addEventListener('change', scheduleUpdate);
    refreshIndices();
    scheduleUpdate();
    return record;
  }

  function refreshIndices() {
    entries.forEach((entry, index) => {
      entry.indexLabel.textContent = String(index + 1).padStart(2, '0');
    });
  }

  function buildDraft() {
    return {
      schemaVersion: 1,
      kind: 'warm-isle.worldbook',
      id: DRAFT_ID,
      name: nameInput.value.trim(),
      description: descriptionInput.value.trim(),
      tags: parseList(tagsInput.value),
      entries: entries.map((entry) => ({
        id: entry.id,
        title: entry.titleInput.value.trim(),
        keywords: parseList(entry.keywordsInput.value),
        content: entry.contentInput.value.trim(),
        pinned: entry.pinnedInput.checked,
        priority: Number(entry.priorityInput.value) || 0,
      })),
      builtin: false,
      createdAt: new Date().toISOString(),
    };
  }

  function safeDraft() {
    const draft = buildDraft();
    return {
      ...draft,
      name: draft.name || '未命名世界',
      description: draft.description || '还没有简介。',
    };
  }

  function updatePreview() {
    const draft = safeDraft();
    page.querySelector('.worldbook-live-title').textContent = draft.name;
    page.querySelector('.worldbook-live-desc').textContent = draft.description;

    const filled = draft.entries.filter((entry) => entry.title || entry.content);
    liveEntryPreview.replaceChildren(
      ...(filled.length
        ? filled.slice(0, 6).map((entry, index) =>
            h(
              'div',
              { class: 'worldbook-live-entry' },
              h('span', { class: 'entry-index', text: String(index + 1).padStart(2, '0') }),
              h(
                'span',
                {},
                h('strong', { text: entry.title || `条目 ${index + 1}` }),
                h('span', { text: truncateText(entry.content || '还没有内容', 70) }),
              ),
              entry.pinned ? h('span', { class: 'pin-mark' }, icon('pin')) : null,
            ),
          )
        : [h('p', { class: 'muted small', text: '还没有条目。至少写一个地点、规则或秘密。' })]),
    );
    page.querySelector('.worldbook-live-card')?.classList.toggle('has-entries', filled.length > 0);

    try {
      const normalized = normalizeWorldbook(draft, { id: DRAFT_ID, builtin: false });
      previewJson = JSON.stringify(normalized, null, 2);
    } catch (error) {
      previewJson = JSON.stringify(
        { error: error.message, hint: '填写世界书名称后即可生成完整 JSON。' },
        null,
        2,
      );
    }
    jsonPreview.textContent = previewJson;
    jsonStats.textContent = `${previewJson.length} 字符`;
    page.querySelectorAll('.worldbook-live-tags').forEach((node) => node.remove());
    if (draft.tags.length) {
      page
        .querySelector('.worldbook-live-card')
        ?.appendChild(
          h(
            'div',
            { class: 'preview-tags worldbook-live-tags' },
            ...draft.tags.map((text) => tag(text, 'neutral')),
          ),
        );
    }
  }

  let scheduled = false;
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      updatePreview();
    });
  }

  for (const element of [nameInput, descriptionInput, tagsInput]) {
    element.addEventListener('input', () => {
      if (element === nameInput) {
        page.querySelector('.worldbook-live-title').textContent = nameInput.value.trim() || '未命名世界';
      }
      scheduleUpdate();
    });
  }

  function parseList(value) {
    return String(value || '')
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function saveWorldbook() {
    if (saved) return;
    if (!nameInput.value.trim()) {
      nameInput.focus();
      toastError('请先填写世界书名称。');
      return;
    }
    const draft = buildDraft();
    const filledEntries = draft.entries.filter((entry) => entry.content.trim());
    if (!filledEntries.length) {
      toastError('至少需要一个有内容的世界条目。');
      entries[0]?.contentInput.focus();
      return;
    }
    try {
      const worldbook = normalizeWorldbook(
        { ...draft, entries: filledEntries },
        { id: DRAFT_ID, builtin: false },
      );
      const duplicate = app.store.state.worldbooks.find(
        (item) => item.name.toLowerCase() === worldbook.name.toLowerCase(),
      );
      if (duplicate) worldbook.name = `${worldbook.name}（${app.store.state.worldbooks.length + 1}）`;
      app.store.update(
        (state) => {
          state.worldbooks.push(worldbook);
        },
        { reason: 'worldbook-created' },
      );
      app.store.info('worldbook.created', `创建了世界书「${worldbook.name}」。`, {
        detail: { entries: worldbook.entries.length },
      });
      saved = true;
      toastSuccess(`「${worldbook.name}」已经可以使用了。`, '世界书已保存');
      app.navigate('worldbooks');
    } catch (error) {
      saved = false;
      app.store.logError('worldbook.create.failed', error);
      toastError(`保存世界书失败：${error.message}`);
    }
  }

  addEntry({
    title: '地理与氛围',
    keywords: ['地点', '天气', '环境'],
    content: '',
    pinned: true,
    priority: 90,
  });
  updatePreview();

  return { cleanup() {} };
}
