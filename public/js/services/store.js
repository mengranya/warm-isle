/**
 * 应用状态容器。
 *
 * 刻意保持轻量：没有框架、没有 Proxy 深层响应。
 * - 数据变更通过 update()/replaceState() 触发订阅。
 * - 持久化 350ms 去抖 + 串行写队列，避免 IndexedDB 写入乱序。
 */

import { LIMITS } from '../core/constants.js';
import { addUsage, clone, createId, createUsageBucket, safeNumber } from '../core/utils.js';
import { normalizeState, createInitialState } from '../data/schemas.js';
import { loadState, saveState } from './storage.js';

export class Store {
  constructor(state, loadInfo = {}) {
    this.state = state;
    this.loadInfo = loadInfo;
    this.listeners = new Set();
    this.route = 'archives';
    this.saveTimer = null;
    this.saveChain = Promise.resolve();
    this.lastPersistenceError = null;
    this.onPersistenceError = null;
  }

  static async open() {
    let loaded = null;
    let loadError = null;
    try {
      loaded = await loadState();
    } catch (error) {
      loadError = error;
    }
    const normalized = loaded?.state ? normalizeState(loaded.state) : createInitialState();
    const store = new Store(normalized, {
      source: loaded?.source || 'new',
      savedAt: loaded?.savedAt || null,
      loadError,
    });
    return store;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(meta = {}) {
    for (const listener of this.listeners) {
      try {
        listener(this.state, meta);
      } catch (error) {
        console.error('状态订阅回调异常：', error);
      }
    }
  }

  setRoute(route) {
    this.route = route;
    this.state.meta.lastRoute = route;
  }

  update(mutator, meta = {}) {
    const result = mutator(this.state);
    this.state.meta.lastOpenedAt = new Date().toISOString();
    this.scheduleSave();
    this.notify({ reason: 'update', ...meta });
    return result;
  }

  replaceState(nextState, meta = {}) {
    this.state = normalizeState(nextState);
    this.state.meta.lastOpenedAt = new Date().toISOString();
    this.scheduleSave();
    this.notify({ reason: 'replace', ...meta });
  }

  scheduleSave(delay = 350) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.flush().catch(() => {});
    }, delay);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const snapshot = clone(this.state);
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(() => saveState(snapshot))
      .then(() => {
        this.lastPersistenceError = null;
      })
      .catch((error) => {
        this.lastPersistenceError = error;
        console.error('保存应用状态失败：', error);
        this.onPersistenceError?.(error);
      });
    return this.saveChain;
  }

  /* ---------------------------- 日志 ---------------------------- */

  _pushLog(entry) {
    this.state.logs.push(entry);
    if (this.state.logs.length > LIMITS.maxLogs) {
      this.state.logs.splice(0, this.state.logs.length - LIMITS.maxLogs);
    }
  }

  log(level, event, message, { detail = null, error = null, archiveId = null } = {}) {
    const errorInfo = error
      ? {
          name: error.name || 'Error',
          message: error.message || String(error),
          stack: error.stack || '',
          code: error.code || '',
          requestId: error.requestId || '',
        }
      : null;
    const entry = {
      id: createId('log'),
      at: new Date().toISOString(),
      level: ['info', 'warn', 'error'].includes(level) ? level : 'info',
      event: String(event || 'event').slice(0, 80),
      message: String(message || '').slice(0, 500),
      detail: detail ?? null,
      error: errorInfo,
      archiveId: archiveId || null,
      route: this.route,
    };
    this._pushLog(entry);
    this.scheduleSave(250);
    this.notify({ reason: 'log', entry });
    return entry;
  }

  info(event, message, options = {}) {
    return this.log('info', event, message, options);
  }

  warn(event, message, options = {}) {
    return this.log('warn', event, message, options);
  }

  logError(event, error, { message = '', detail = null, archiveId = null } = {}) {
    return this.log('error', event, message || error?.message || '发生未知错误', {
      error: error instanceof Error ? error : new Error(String(error)),
      detail,
      archiveId,
    });
  }

  clearLogs() {
    this.state.logs = [];
    this._pushLog({
      id: createId('log'),
      at: new Date().toISOString(),
      level: 'info',
      event: 'logs.cleared',
      message: '运行日记已清空。',
      detail: null,
      error: null,
      archiveId: null,
      route: this.route,
    });
    this.scheduleSave(150);
    this.notify({ reason: 'logs-cleared' });
  }

  /* ---------------------------- 查询 ---------------------------- */

  getActiveArchive() {
    return this.state.archives.find((archive) => archive.id === this.state.activeArchiveId) || null;
  }

  getArchive(id) {
    return this.state.archives.find((archive) => archive.id === id) || null;
  }

  getPersona(id) {
    return this.state.personas.find((persona) => persona.id === id) || null;
  }

  getWorldbook(id) {
    return id ? this.state.worldbooks.find((worldbook) => worldbook.id === id) || null : null;
  }

  getPlugin(id) {
    return this.state.plugins.find((plugin) => plugin.id === id) || null;
  }

  getActivePersona() {
    const archive = this.getActiveArchive();
    return archive ? this.getPersona(archive.personaId) : null;
  }

  getActiveWorldbook() {
    const archive = this.getActiveArchive();
    return archive ? this.getWorldbook(archive.worldbookId) : null;
  }

  getEnabledPlugins() {
    return this.state.plugins.filter((plugin) => plugin.enabled);
  }

  setActiveArchive(id) {
    const archive = this.getArchive(id);
    if (!archive) return false;
    this.update(
      (state) => {
        state.activeArchiveId = id;
        archive.lastChatAt = new Date().toISOString();
      },
      { reason: 'archive-switched', archiveId: id },
    );
    return true;
  }

  /* ------------------------- 沙盒世界查询 ------------------------- */

  getSandboxWorldbook(id) {
    return id
      ? this.state.sandboxWorldbooks.find((worldbook) => worldbook.id === id) || null
      : null;
  }

  getSandboxPlugin(id) {
    return this.state.sandboxPlugins.find((plugin) => plugin.id === id) || null;
  }

  getSandboxSave(id) {
    return this.state.sandboxSaves.find((save) => save.id === id) || null;
  }

  getActiveSandboxSave() {
    return (
      this.state.sandboxSaves.find(
        (save) => save.id === this.state.activeSandboxSaveId,
      ) || null
    );
  }

  getEnabledSandboxPlugins() {
    return this.state.sandboxPlugins.filter((plugin) => plugin.enabled);
  }

  setActiveSandboxSave(id) {
    const save = this.getSandboxSave(id);
    if (!save) return false;
    this.update(
      (state) => {
        state.activeSandboxSaveId = id;
        save.lastPlayedAt = new Date().toISOString();
      },
      { reason: 'sandbox-switched', archiveId: id },
    );
    return true;
  }

  /* ---------------------------- 统计 ---------------------------- */

  recordUsage({ archiveId, provider, usage }) {
    if (!usage) return;
    const providerId = provider || this.state.settings.provider;
    this.update(
      (state) => {
        if (!state.stats.byProvider) state.stats.byProvider = {};
        if (!state.stats.byProvider[providerId]) {
          state.stats.byProvider[providerId] = createUsageBucket();
        }
        addUsage(state.stats, usage);
        addUsage(state.stats.byProvider[providerId], usage);

        const archive = archiveId
          ? state.archives.find((item) => item.id === archiveId)
          : null;
        const sandboxSave = archiveId
          ? state.sandboxSaves.find((item) => item.id === archiveId)
          : null;
        const target = archive || sandboxSave;
        if (target) {
          if (!target.tokenStats.byProvider) target.tokenStats.byProvider = {};
          if (!target.tokenStats.byProvider[providerId]) {
            target.tokenStats.byProvider[providerId] = createUsageBucket();
          }
          addUsage(target.tokenStats, usage);
          addUsage(target.tokenStats.byProvider[providerId], usage);
          target.updatedAt = new Date().toISOString();
        }
      },
      { reason: 'usage', archiveId },
    );
  }

  resetStats() {
    this.update(
      (state) => {
        state.stats = createUsageBucket();
        for (const archive of state.archives) archive.tokenStats = createUsageBucket();
        for (const save of state.sandboxSaves) save.tokenStats = createUsageBucket();
      },
      { reason: 'stats-reset' },
    );
  }

  /* ---------------------------- 便捷方法 ---------------------------- */

  addArchive(archive) {
    this.update(
      (state) => {
        state.archives.unshift(archive);
        state.activeArchiveId = archive.id;
      },
      { reason: 'archive-created', archiveId: archive.id },
    );
    return archive;
  }

  removeArchive(id) {
    let removed = null;
    this.update(
      (state) => {
        const index = state.archives.findIndex((archive) => archive.id === id);
        if (index === -1) return;
        [removed] = state.archives.splice(index, 1);
        if (state.activeArchiveId === id) {
          state.activeArchiveId = state.archives[0]?.id || null;
        }
      },
      { reason: 'archive-deleted', archiveId: id },
    );
    return removed;
  }

  addSandboxSave(save) {
    this.update(
      (state) => {
        state.sandboxSaves.unshift(save);
        state.activeSandboxSaveId = save.id;
      },
      { reason: 'sandbox-created', archiveId: save.id },
    );
    return save;
  }

  removeSandboxSave(id) {
    let removed = null;
    this.update(
      (state) => {
        const index = state.sandboxSaves.findIndex((save) => save.id === id);
        if (index === -1) return;
        [removed] = state.sandboxSaves.splice(index, 1);
        if (state.activeSandboxSaveId === id) {
          state.activeSandboxSaveId = state.sandboxSaves[0]?.id || null;
        }
      },
      { reason: 'sandbox-deleted', archiveId: id },
    );
    return removed;
  }

  touchArchive(id, { chat = false } = {}) {
    const now = new Date().toISOString();
    const archive = this.getArchive(id);
    if (!archive) return;
    archive.updatedAt = now;
    if (chat) archive.lastChatAt = now;
  }

  /** 供调试与设置页使用：数据规模（字节）。 */
  getApproxSize() {
    try {
      return new Blob([JSON.stringify(this.state)]).size;
    } catch {
      return safeNumber(JSON.stringify(this.state).length);
    }
  }
}
