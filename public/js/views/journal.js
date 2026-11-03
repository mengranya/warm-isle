/** 运行日记：操作流水、错误详情、筛选与导出。 */

import { APP_VERSION } from '../core/constants.js';
import {
  downloadJson,
  downloadText,
  formatDateTime,
} from '../core/utils.js';
import { pageHeader } from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastSuccess } from '../ui/toast.js';

const LEVEL_META = {
  info: { label: '信息', icon: 'info', className: 'info' },
  warn: { label: '提醒', icon: 'warning', className: 'warn' },
  error: { label: '错误', icon: 'warning', className: 'error' },
};

export async function render(root, app) {
  const { store } = app;
  const filterState = { level: 'all', query: '' };
  const list = h('div', { class: 'journal-list' });
  const countBadge = h('span', { class: 'journal-count' });
  const searchInput = h('input', {
    class: 'input search-input',
    type: 'search',
    placeholder: '搜索事件、消息、错误类型或堆栈…',
    'aria-label': '搜索运行日记',
  });
  const filterBar = h('div', { class: 'filter-chips' });
  const totalStat = h('strong', { text: String(store.state.logs.length) });
  const errorStat = h('strong', {
    text: String(store.state.logs.filter((log) => log.level === 'error').length),
  });

  const levels = [
    { id: 'all', label: '全部' },
    { id: 'info', label: '信息' },
    { id: 'warn', label: '提醒' },
    { id: 'error', label: '错误' },
  ];

  function logsFiltered() {
    const query = filterState.query.trim().toLowerCase();
    return store.state.logs
      .filter((log) => filterState.level === 'all' || log.level === filterState.level)
      .filter((log) => {
        if (!query) return true;
        const haystack = [
          log.event,
          log.message,
          log.route,
          log.error?.name,
          log.error?.message,
          log.error?.stack,
          JSON.stringify(log.detail || {}),
        ]
          .filter(Boolean)
          .join('\n')
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice()
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function renderFilters() {
    filterBar.replaceChildren(
      ...levels.map((level) => {
        const count =
          level.id === 'all'
            ? store.state.logs.length
            : store.state.logs.filter((log) => log.level === level.id).length;
        return h(
          'button',
          {
            class: `filter-chip ${filterState.level === level.id ? 'is-active' : ''}`.trim(),
            type: 'button',
            onclick: () => {
              filterState.level = level.id;
              renderFilters();
              renderEntries();
            },
          },
          h('span', { text: level.label }),
          h('span', { class: 'filter-count', text: String(count) }),
        );
      }),
    );
  }

  function renderEntries() {
    const logs = logsFiltered();
    countBadge.textContent = `${logs.length} 条`;
    totalStat.textContent = String(store.state.logs.length);
    errorStat.textContent = String(
      store.state.logs.filter((log) => log.level === 'error').length,
    );
    if (!logs.length) {
      list.replaceChildren(
        h(
          'div',
          { class: 'journal-empty' },
          icon('journal'),
          h('h3', { text: filterState.query || filterState.level !== 'all' ? '没有匹配的记录' : '日记还是空白的' }),
          h('p', {
            text:
              filterState.query || filterState.level !== 'all'
                ? '换一个关键词或筛选条件试试。'
                : '创建存档、切换人格、调用 AI 与发生错误时，这里都会留下记录。',
          }),
        ),
      );
      return;
    }
    list.replaceChildren(...logs.map(renderLog));
  }

  function renderLog(log) {
    const level = LEVEL_META[log.level] || LEVEL_META.info;
    const hasDetails = log.detail || log.error;
    const header = h(
      'div',
      { class: 'log-row' },
      h(
        'span',
        { class: `log-level log-level-${level.className}` },
        icon(level.icon),
        h('span', { text: level.label }),
      ),
      h(
        'div',
        { class: 'log-copy' },
        h(
          'div',
          { class: 'log-message-line' },
          h('strong', { class: 'log-event', text: prettifyEvent(log.event) }),
          h('span', { class: 'log-message', text: log.message }),
        ),
        h(
          'div',
          { class: 'log-meta-line' },
          h('span', { text: formatDateTime(log.at, { withSeconds: true }) }),
          h('span', { class: 'log-dot', text: '·' }),
          h('span', { text: log.at }),
          log.route ? h('span', { class: 'log-route', text: log.route }) : null,
          log.error?.requestId
            ? h('span', { class: 'log-route', text: `req ${log.error.requestId.slice(0, 8)}` })
            : null,
        ),
      ),
      hasDetails ? h('span', { class: 'log-expand-hint' }, icon('chevronDown')) : null,
    );

    if (!hasDetails) return h('article', { class: 'log-entry' }, header);

    return h(
      'details',
      { class: 'log-entry log-entry-expandable' },
      h('summary', { class: 'log-summary' }, header),
      h(
        'div',
        { class: 'log-details' },
        log.detail
          ? h(
              'div',
              { class: 'log-detail-block' },
              h('h4', { text: '上下文' }),
              h('pre', { text: JSON.stringify(log.detail, null, 2) }),
            )
          : null,
        log.error
          ? h(
              'div',
              { class: 'log-detail-block log-error-block' },
              h('h4', { text: '错误详情' }),
              h(
                'dl',
                { class: 'error-facts' },
                h('dt', { text: '类型' }),
                h('dd', { text: log.error.name || 'Error' }),
                h('dt', { text: '错误码' }),
                h('dd', { text: log.error.code || '—' }),
                h('dt', { text: '时间戳' }),
                h('dd', { text: log.at }),
                log.error.requestId
                  ? h('dt', { text: 'Request ID' })
                  : null,
                log.error.requestId ? h('dd', { text: log.error.requestId }) : null,
                h('dt', { text: '说明' }),
                h('dd', { text: log.error.message || '—' }),
              ),
              log.error.stack
                ? h('pre', { class: 'error-stack', text: log.error.stack })
                : null,
            )
          : null,
      ),
    );
  }

  searchInput.addEventListener('input', () => {
    filterState.query = searchInput.value;
    renderEntries();
  });

  const page = h(
    'div',
    { class: 'page page-journal' },
    pageHeader({
      eyebrow: 'Runtime log',
      title: '运行日记',
      lede: '暖屿的每一步操作都留在本机。出错时，这里会记录错误类型、堆栈、时间戳与 Request ID。',
      actions: [
        h(
          'button',
          {
            class: 'btn btn-ghost',
            type: 'button',
            onclick: () => exportLogsJson(app),
          },
          icon('download'),
          h('span', { text: '导出 JSON' }),
        ),
        h(
          'button',
          {
            class: 'btn btn-ghost',
            type: 'button',
            onclick: () => exportLogsText(app),
          },
          icon('journal'),
          h('span', { text: '导出文本' }),
        ),
        h(
          'button',
          {
            class: 'btn btn-danger-ghost',
            type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: '清空运行日记？',
                message: '所有操作记录与错误堆栈都会从本机删除，无法撤销。',
                confirmText: '清空日记',
                danger: true,
              });
              if (!ok) return;
              store.clearLogs();
              toastSuccess('运行日记已清空。');
              renderFilters();
              renderEntries();
            },
          },
          icon('trash'),
          h('span', { text: '清空' }),
        ),
      ],
    }),
    h(
      'div',
      { class: 'journal-toolbar' },
      h(
        'div',
        { class: 'journal-stats' },
        h(
          'span',
          { class: 'journal-stat' },
          icon('journal'),
          totalStat,
          h('span', { text: '条记录' }),
        ),
        h(
          'span',
          { class: 'journal-stat is-error' },
          icon('warning'),
          errorStat,
          h('span', { text: '个错误' }),
        ),
        countBadge,
      ),
      h(
        'div',
        { class: 'journal-tools' },
        h('span', { class: 'search-wrap' }, icon('filter'), searchInput),
        filterBar,
      ),
    ),
    h(
      'div',
      { class: 'journal-note' },
      icon('shield'),
      h('span', {
        text: '日志不包含 API Key 或完整对话内容；错误堆栈与轮次摘要仅保存在本机。',
      }),
    ),
    list,
  );

  root.appendChild(page);
  renderFilters();
  renderEntries();

  const unsubscribe = store.subscribe((_state, meta) => {
    if (meta?.reason === 'log' || meta?.reason === 'logs-cleared') {
      renderFilters();
      renderEntries();
    }
  });

  return {
    cleanup() {
      unsubscribe();
    },
  };
}

function prettifyEvent(event) {
  const map = {
    'app.started': '应用启动',
    'chat.user': '玩家发言',
    'ai.request': '调用 AI',
    'ai.response': 'AI 回复',
    'ai.response.partial': 'AI 部分回复',
    'ai.request.failed': 'AI 调用失败',
    'ai.aborted': '停止生成',
    'model.changed': '切换模型',
    'prompt.build.failed': '提示词构建失败',
    'archive.created': '创建存档',
    'archive.switched': '切换存档',
    'archive.deleted': '删除存档',
    'archive.duplicated': '复制存档',
    'archive.exported': '导出存档',
    'archive.demo-created': '创建示例存档',
    'protagonist.updated': '更新主人公',
    'status.updated': '更新状态',
    'npc.added': '加入 NPC',
    'npc.removed': '移除 NPC',
    'npc.drafted': '起草 NPC',
    'npc.draft.failed': 'NPC 起草失败',
    'diary.generated': '生成日记草稿',
    'diary.saved': '保存日记',
    'diary.exported': '导出日记',
    'persona.created': '创建人格',
    'persona.imported': '导入人格',
    'persona.exported': '导出人格',
    'persona.deleted': '删除人格',
    'persona.import.failed': '人格导入失败',
    'worldbook.created': '创建世界书',
    'worldbook.imported': '导入世界书',
    'worldbook.exported': '导出世界书',
    'worldbook.deleted': '删除世界书',
    'worldbook.import.failed': '世界书导入失败',
    'plugin.imported': '导入插件',
    'plugin.import.failed': '插件导入失败',
    'plugin.toggled': '切换插件',
    'plugin.priority': '修改插件优先级',
    'plugin.exported': '导出插件',
    'plugin.deleted': '删除插件',
    'sandbox.created': '创建沙盒历险',
    'sandbox.switched': '切换沙盒存档',
    'sandbox.deleted': '删除沙盒存档',
    'sandbox.exported': '导出沙盒存档',
    'sandbox.turn': '沙盒回合请求',
    'sandbox.turn.complete': '沙盒回合完成',
    'sandbox.event.monitor': '后台事件监控',
    'sandbox.event.monitor.failed': '后台事件监控失败',
    'sandbox.agency.guard.rewritten': '校正玩家代行叙事',
    'sandbox.agency.guard.still.risky': '校正后仍有玩家代行',
    'sandbox.agency.guard.fallback': '本地裁剪玩家代行',
    'sandbox.agency.guard.failed': '玩家代行校正失败',
    'sandbox.aborted': '停止沙盒生成',
    'sandbox.ai.failed': '沙盒 AI 调用失败',
    'sandbox.prompt.failed': '沙盒提示词构建失败',
    'sandbox.state.missing': '沙盒状态块缺失',
    'sandbox.state.edited': '手动校正沙盒状态',
    'sandbox.opening.validation': '自定义开场审查',
    'sandbox.opening.validation.failed': '自定义开场审查失败',
    'sandbox.opening.generated': 'AI 生成专属开场',
    'sandbox.opening.generated.invalid': 'AI 开场结构无效',
    'sandbox.opening.generated.failed': 'AI 开场推演失败',
    'sandbox.chronicle.created': '生成沙盒编年史',
    'sandbox.worldbook.created': '创建沙盒世界书',
    'sandbox.worldbook.imported': '导入沙盒世界书',
    'sandbox.worldbook.import.failed': '沙盒世界书导入失败',
    'sandbox.worldbook.exported': '导出沙盒世界书',
    'sandbox.worldbook.deleted': '删除沙盒世界书',
    'sandbox.plugin.imported': '导入沙盒规则',
    'sandbox.plugin.import.failed': '沙盒规则导入失败',
    'sandbox.plugin.toggled': '切换沙盒规则',
    'sandbox.plugin.priority': '修改沙盒规则优先级',
    'sandbox.plugin.exported': '导出沙盒规则',
    'sandbox.plugin.deleted': '删除沙盒规则',
    'sandbox.plugin.runtime.excluded': '沙盒规则未注入',
    'logs.cleared': '清空运行日记',
    'journal.exported': '导出运行日记',
    'storage.load.failed': '读取本地存储失败',
    'window.error': '页面异常',
    'window.unhandledrejection': '未处理 Promise 异常',
    'settings.saved': '保存设置',
    'settings.token.warning': 'API Key 存储提醒',
    'settings.test.failed': '连接测试失败',
    'connection.checked': '检测模型连接',
    'data.exported': '导出全部数据',
    'data.reset': '清空全部数据',
    'token.reset': '重置 token 统计',
  };
  return map[event] || event;
}

function exportLogsJson(app) {
  const logs = app.store.state.logs;
  downloadJson(
    `warm-isle-journal-${new Date().toISOString().slice(0, 10)}.json`,
    {
      kind: 'warm-isle.journal',
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      count: logs.length,
      logs,
    },
  );
  app.store.info('journal.exported', `导出了 ${logs.length} 条运行日记（JSON）。`);
  toast('运行日记已导出。', { type: 'success' });
}

function exportLogsText(app) {
  const logs = app.store.state.logs;
  const lines = [
    `暖屿 Warm Isle v${APP_VERSION} 运行日记`,
    `导出时间：${new Date().toISOString()}`,
    `记录数：${logs.length}`,
    '='.repeat(64),
    '',
  ];
  for (const log of logs) {
    lines.push(`[${log.at}] [${log.level.toUpperCase()}] ${log.event}`);
    lines.push(log.message);
    if (log.route) lines.push(`route: ${log.route}`);
    if (log.archiveId) lines.push(`archive: ${log.archiveId}`);
    if (log.detail) lines.push(`detail: ${JSON.stringify(log.detail)}`);
    if (log.error) {
      lines.push(`error: ${log.error.name} (${log.error.code || 'no-code'})`);
      lines.push(`message: ${log.error.message}`);
      if (log.error.requestId) lines.push(`requestId: ${log.error.requestId}`);
      if (log.error.stack) lines.push(log.error.stack);
    }
    lines.push('-'.repeat(48));
  }
  downloadText(
    `warm-isle-journal-${new Date().toISOString().slice(0, 10)}.txt`,
    lines.join('\n'),
  );
  app.store.info('journal.exported', `导出了 ${logs.length} 条运行日记（文本）。`);
  toast('运行日记已导出。', { type: 'success' });
}
