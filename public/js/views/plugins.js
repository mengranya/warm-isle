/**
 * 插件管理：导入 JSON、开关、优先级、查看全局提示词。
 * 插件在提示词中位于人格与世界书之前，冲突时优先。
 */

import { compilePluginRuntime } from '../core/plugins.js';
import {
  downloadJson,
  formatNumber,
  readTextFile,
  sanitizeFileName,
} from '../core/utils.js';
import {
  exportPluginPayload,
  mergeImportedItems,
  preparePluginImport,
} from '../data/schemas.js';
import { pageHeader, tag } from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const { store } = app;
  const state = store.state;
  const isSandbox = String(app.runtime.route || '').startsWith('sandbox');
  const sourceKey = isSandbox ? 'sandboxPlugins' : 'plugins';
  const eventName = (name) => (isSandbox ? `sandbox.${name}` : name);
  const getPlugins = () => store.state[sourceKey] || [];
  const modeLabel = isSandbox ? '沙盒规则' : '恋爱插件';

  const importTextarea = h('textarea', {
    class: 'input textarea import-textarea',
    rows: 8,
    placeholder: isSandbox ? '把沙盒规则插件 JSON 粘贴到这里…' : '把插件 JSON 粘贴到这里…',
    spellcheck: 'false',
    'aria-label': isSandbox ? '沙盒规则插件 JSON' : '插件 JSON',
  });
  const importFile = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'sr-only',
    id: 'plugin-file-input',
  });
  const countLabel = h('span', { class: 'count-pill' });
  const list = h('div', { class: 'plugin-list' });
  const runtimeSummary = h('div', { class: 'plugin-runtime-summary' });

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

  function refreshCount() {
    const plugins = getPlugins();
    const enabled = plugins.filter((plugin) => plugin.enabled).length;
    countLabel.replaceChildren(
      h('strong', { text: String(enabled) }),
      h('span', { text: ` / ${plugins.length} 个启用` }),
    );
    renderRuntimeSummary();
  }

  function renderRuntimeSummary() {
    const activePlugins = getPlugins().filter((plugin) => plugin.enabled);
    const runtime = compilePluginRuntime(activePlugins, {
      configuredMaxTokens: store.state.settings.maxTokens,
    });
    if (!runtime.selected.length) {
      runtimeSummary.replaceChildren(
        h(
          'span',
          { class: 'runtime-empty' },
          icon('plug'),
          h('span', {
            text: isSandbox
              ? '当前没有启用沙盒规则。开关后，下一回合会立即生效。'
              : '当前没有启用插件。开关后，下一轮对话会立即生效。',
          }),
        ),
      );
      return;
    }
    const length = runtime.length;
    const metrics = [
      h('span', { class: 'runtime-metric' }, icon('plug'), h('span', { text: `${runtime.selected.length} 个插件完整注入` })),
      h(
        'span',
        { class: 'runtime-metric' },
        icon('terminal'),
        h('span', { text: `${formatNumber(runtime.chars)} 字 · 约 +${formatNumber(runtime.estimatedTokens)} tokens/轮` }),
      ),
      length.hasConstraint
        ? h(
            'span',
            { class: 'runtime-metric runtime-metric-accent' },
            icon('spark'),
            h('span', {
              text: `篇幅 ${length.min ?? '不限'}–${length.max ?? '不限'} 字 · 本轮输出上限约 ${formatNumber(runtime.suggestedMaxTokens)} tokens`,
            }),
          )
        : null,
      runtime.excluded.length
        ? h(
            'span',
            { class: 'runtime-metric runtime-metric-warning' },
            icon('warning'),
            h('span', { text: `${runtime.excluded.length} 个插件因预算未注入` }),
          )
        : null,
    ].filter(Boolean);
    runtimeSummary.replaceChildren(...metrics);
  }

  function renderList() {
    const plugins = [...getPlugins()].sort(
      (a, b) => Number(b.enabled) - Number(a.enabled) || b.priority - a.priority,
    );
    list.replaceChildren(
      ...plugins.map((plugin) =>
        renderPluginCard(app, plugin, refreshCount, renderList, {
          sourceKey,
          eventName,
          isSandbox,
        }),
      ),
    );
    refreshCount();
  }

  function doImport() {
    const raw = importTextarea.value.trim();
    if (!raw) {
      toastError('请先粘贴插件 JSON 或选择文件。');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const incoming = preparePluginImport(parsed);
      if (!incoming.length) throw new Error('没有找到可导入的插件。');
      const merged = mergeImportedItems(getPlugins(), incoming, 'plugin');
      store.update(
        (next) => {
          next[sourceKey] = merged.list;
        },
        { reason: isSandbox ? 'sandbox-plugin-imported' : 'plugin-imported' },
      );
      store.info(
        eventName('plugin.imported'),
        `导入了 ${merged.imported} 个${modeLabel}。`,
        { detail: { names: incoming.map((plugin) => plugin.name) } },
      );
      toastSuccess(`已导入 ${merged.imported} 个${modeLabel}。`, '导入成功');
      app.renderRoute();
    } catch (error) {
      store.logError(eventName('plugin.import.failed'), error, {
        detail: { length: raw.length },
      });
      toastError(`插件导入失败：${error.message}`, '无法导入');
    }
  }

  const page = h(
    'div',
    { class: 'page page-plugins' },
    pageHeader({
      eyebrow: isSandbox ? 'Sandbox rules · isolated' : 'Global overrides',
      title: isSandbox ? '沙盒规则插件' : '插件',
      lede: isSandbox
        ? '沙盒规则只作用于开放世界模式，与恋爱对话插件完全隔离。启用后会作为世界规则硬约束注入，并在每轮末尾复核。'
        : '插件是全局、高优先级的提示词。启用的插件会排在人格与世界书之前，冲突时以插件为准。',
      actions: [countLabel],
    }),
    h(
      'div',
      { class: 'priority-explainer' },
      h(
        'div',
        { class: 'priority-stack' },
        priorityLayer(isSandbox ? '沙盒规则' : '插件', '最高优先级', 'plug', true),
        priorityLayer('世界书', isSandbox ? '世界设定' : '背景事实', 'book', false),
        priorityLayer(isSandbox ? '世界引擎' : '人格', isSandbox ? '基础规则' : '角色口吻', isSandbox ? 'compass' : 'persona', false),
      ),
      h(
        'div',
        { class: 'priority-copy' },
        h('h2', { text: '当规则冲突时' }),
        h('p', {
          text: isSandbox
            ? '沙盒规则优先于世界书、世界类型规则和通用叙事要求。适合加入时代约束、物理法则、硬核后果与内容边界；不能改动恋爱对话模式的数据。'
            : '插件优先于世界书与人格。适合加入叙事镜头、内容边界、回合节奏等全局规则；不建议在插件里逐条改写角色关系。',
        }),
        h(
          'p',
          { class: 'muted small' },
          '所有启用插件都会作为硬约束完整注入，并在提示词末尾再次复核；篇幅类插件会自动提高本轮输出上限。',
        ),
      ),
    ),
    runtimeSummary,
    list,
    h(
      'section',
      { class: 'import-section', id: 'plugin-import' },
      h(
        'div',
        { class: 'import-section-head' },
        h('span', { class: 'section-index', text: 'IMPORT' }),
        h(
          'div',
          {},
          h('h2', { text: isSandbox ? '导入沙盒规则' : '导入插件' }),
          h('p', {
            text: isSandbox
              ? '沙盒规则同样使用 name / prompt / enabled / priority 字段；导入后只影响开放世界模式。'
              : '插件 JSON 至少需要 name 与 prompt。导入后默认保持文件内的开关状态，可自行启用。',
          }),
        ),
        h(
          'a',
          {
            class: 'text-link',
            href: '/samples/plugin-director.json',
            download: 'plugin-director.json',
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
            for: 'plugin-file-input',
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
          h('strong', { text: isSandbox ? '拖入沙盒规则 JSON 文件' : '拖入插件 JSON 文件' }),
          h('span', { text: '或点击选择文件 · 支持数组批量导入' }),
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
              h('span', { text: isSandbox ? '导入沙盒规则' : '导入插件' }),
            ),
          ),
        ),
      ),
    ),
  );

  page.querySelector('.drop-zone')?.appendChild(importFile);
  root.appendChild(page);
  renderList();
  return { cleanup() {} };
}

function priorityLayer(label, hint, iconName, active) {
  return h(
    'div',
    { class: `priority-layer ${active ? 'is-active' : ''}`.trim() },
    h('span', { class: 'priority-layer-icon' }, icon(iconName)),
    h('span', { class: 'priority-layer-label', text: label }),
    h('span', { class: 'priority-layer-hint', text: hint }),
  );
}

function renderPluginCard(
  app,
  plugin,
  refreshCount,
  renderList,
  { sourceKey = 'plugins', eventName = (name) => name, isSandbox = false } = {},
) {
  const enabled = plugin.enabled;
  const toggle = h('input', {
    type: 'checkbox',
    checked: enabled,
    'aria-label': `${enabled ? '停用' : '启用'}插件 ${plugin.name}`,
  });
  const status = h('span', { class: 'plugin-status', text: enabled ? '已启用' : '未启用' });
  const priorityInput = h('input', {
    type: 'number',
    class: 'plugin-priority-input',
    value: plugin.priority,
    min: 0,
    max: 100,
    step: 1,
    'aria-label': `${plugin.name} 的优先级`,
  });

  const card = h(
    'article',
    { class: `plugin-card ${enabled ? 'is-enabled' : ''}`.trim(), 'data-plugin-id': plugin.id },
    h(
      'div',
      { class: 'plugin-card-head' },
      h(
        'span',
        { class: 'plugin-icon' },
        icon('plug'),
      ),
      h(
        'div',
        { class: 'plugin-title-wrap' },
        h(
          'div',
          { class: 'plugin-title-line' },
          h('h2', { text: plugin.name }),
          plugin.builtin ? tag('示例', 'warm') : tag('自定义', 'neutral'),
          status,
        ),
        h('p', {
          class: 'plugin-meta',
          text: `${plugin.author || '未署名'} · v${plugin.version || '1.0.0'} · 优先级 ${plugin.priority}`,
        }),
      ),
      h(
        'label',
        { class: 'switch', title: enabled ? '停用插件' : '启用插件' },
        toggle,
        h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })),
        h('span', { class: 'sr-only', text: enabled ? '停用插件' : '启用插件' }),
      ),
    ),
    h('p', { class: 'plugin-description', text: plugin.description || '没有填写描述。' }),
    h(
      'details',
      { class: 'plugin-prompt-details' },
      h(
        'summary',
        {},
        icon('terminal'),
        h('span', { text: '查看注入的提示词' }),
        h('span', { class: 'prompt-length', text: `${plugin.prompt.length} 字符` }),
      ),
      h('pre', { class: 'plugin-prompt', text: plugin.prompt }),
    ),
    h(
      'div',
      { class: 'plugin-card-foot' },
      h(
        'label',
        { class: 'plugin-priority-edit' },
        h('span', { text: '优先级' }),
        priorityInput,
      ),
      h(
        'div',
        { class: 'plugin-actions' },
        h(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: () => {
              downloadJson(
                `${sanitizeFileName(plugin.name)}.plugin.json`,
                exportPluginPayload(plugin),
              );
              app.store.info(
                eventName('plugin.exported'),
                `导出了${isSandbox ? '沙盒规则' : '插件'}「${plugin.name}」。`,
              );
              toastSuccess('插件已导出。');
            },
          },
          icon('download'),
          h('span', { text: '导出' }),
        ),
        !plugin.builtin
          ? h(
              'button',
              {
                class: 'icon-btn subtle danger-hover',
                type: 'button',
                title: '删除插件',
                'aria-label': `删除 ${plugin.name}`,
                onclick: () =>
                  deletePlugin(app, plugin, renderList, {
                    sourceKey,
                    eventName,
                    isSandbox,
                  }),
              },
              icon('trash'),
            )
          : null,
      ),
    ),
  );

  toggle.addEventListener('change', () => {
    const nextEnabled = toggle.checked;
    app.store.update(
      (state) => {
        const target = (state[sourceKey] || []).find((item) => item.id === plugin.id);
        if (target) {
          target.enabled = nextEnabled;
          target.userToggled = true;
        }
      },
      { reason: isSandbox ? 'sandbox-plugin-toggled' : 'plugin-toggled', pluginId: plugin.id },
    );
    app.store.info(
      eventName('plugin.toggled'),
      `${nextEnabled ? '启用' : '停用'}${isSandbox ? '沙盒规则' : '插件'}「${plugin.name}」。`,
    );
    card.classList.toggle('is-enabled', nextEnabled);
    status.textContent = nextEnabled ? '已启用' : '未启用';
    card.querySelector('.plugin-meta').textContent = `${plugin.author || '未署名'} · v${
      plugin.version || '1.0.0'
    } · 优先级 ${plugin.priority}`;
    refreshCount();
    toast(nextEnabled ? '插件已启用，下一轮生效。' : '插件已停用。', {
      type: 'success',
      duration: 1_800,
    });
  });

  priorityInput.addEventListener('change', () => {
    const value = Math.max(0, Math.min(100, Number(priorityInput.value) || 0));
    priorityInput.value = String(value);
    app.store.update(
      (state) => {
        const target = (state[sourceKey] || []).find((item) => item.id === plugin.id);
        if (target) target.priority = value;
      },
      { reason: isSandbox ? 'sandbox-plugin-priority' : 'plugin-priority', pluginId: plugin.id },
    );
    app.store.info(
      eventName('plugin.priority'),
      `将${isSandbox ? '沙盒规则' : '插件'}「${plugin.name}」的优先级设为 ${value}。`,
    );
    card.querySelector('.plugin-meta').textContent = `${plugin.author || '未署名'} · v${
      plugin.version || '1.0.0'
    } · 优先级 ${value}`;
    refreshCount();
    toast('优先级已更新，下一轮生效。', { type: 'success', duration: 1_800 });
  });

  return card;
}

async function deletePlugin(
  app,
  plugin,
  renderList,
  { sourceKey = 'plugins', eventName = (name) => name, isSandbox = false } = {},
) {
  const label = isSandbox ? '沙盒规则' : '插件';
  const ok = await confirmDialog({
    title: `删除${label}「${plugin.name}」？`,
    message: `${label}将从本机移除，无法撤销。建议先导出一份 JSON。`,
    confirmText: `删除${label}`,
    danger: true,
  });
  if (!ok) return;
  app.store.update(
    (state) => {
      state[sourceKey] = (state[sourceKey] || []).filter(
        (item) => item.id !== plugin.id,
      );
    },
    { reason: isSandbox ? 'sandbox-plugin-deleted' : 'plugin-deleted' },
  );
  app.store.info(
    eventName('plugin.deleted'),
    `删除了${label}「${plugin.name}」。`,
  );
  toastSuccess(`${label}已删除。`);
  renderList();
}
