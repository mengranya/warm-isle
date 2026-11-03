/**
 * 暖屿 · 单页应用入口。
 *
 * 说明：
 * - 使用 Hash 路由，静态服务器无需 history fallback。
 * - 视图按需动态 import，首屏只加载外壳与当前页面。
 * - 状态变更不会强制整页重渲染；聊天视图自行做流式局部更新，保证输入框始终有焦点。
 */

import {
  APP_NAME,
  APP_VERSION,
  NAV_ITEMS,
  PROVIDERS,
  ROUTE_META,
  SANDBOX_NAV_ITEMS,
  SANDBOX_ROUTE_META,
  getProvider,
  getSandboxCategory,
} from './core/constants.js';
import {
  formatCompactNumber,
  formatNumber,
  safeColor,
  truncateText,
} from './core/utils.js';
import { Store } from './services/store.js';
import { fetchHealth } from './services/ai.js';
import { hydrateKeys } from './services/vault.js';
import {
  clear,
  h,
  icon,
  qs,
  replaceChildren,
} from './ui/dom.js';
import { avatar } from './ui/components.js';
import { openModal } from './ui/modal.js';
import { toast, toastError } from './ui/toast.js';

const VIEW_LOADERS = {
  chat: () => import('./views/chat.js'),
  archives: () => import('./views/archives.js'),
  'archives/new': () => import('./views/create-archive.js'),
  personas: () => import('./views/personas.js'),
  'personas/new': () => import('./views/create-persona.js'),
  worldbooks: () => import('./views/worldbooks.js'),
  'worldbooks/new': () => import('./views/create-worldbook.js'),
  plugins: () => import('./views/plugins.js'),
  sandbox: () => import('./views/sandbox-home.js'),
  'sandbox/new': () => import('./views/sandbox-create.js'),
  'sandbox/play': () => import('./views/sandbox-play.js'),
  'sandbox/worldbooks': () => import('./views/sandbox-worldbooks.js'),
  'sandbox/worldbooks/new': () => import('./views/sandbox-worldbook-new.js'),
  'sandbox/plugins': () => import('./views/plugins.js'),
  journal: () => import('./views/journal.js'),
  settings: () => import('./views/settings.js'),
};

const MOBILE_NAV = ['chat', 'archives', 'personas', 'worldbooks', 'sandbox', 'settings'];

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const route = pathPart || 'archives';
  return {
    route: VIEW_LOADERS[route] ? route : 'archives',
    query: new URLSearchParams(queryPart),
    raw,
  };
}

function routeFamily(route) {
  return String(route || '').split('/')[0];
}

/** 导航高亮到“大类首页”，例如 sandbox/new 高亮沙盒大厅。 */
function navRouteFor(route) {
  const value = String(route || '');
  if (value.startsWith('sandbox/worldbooks')) return 'sandbox/worldbooks';
  if (value.startsWith('sandbox/plugins')) return 'sandbox/plugins';
  if (value.startsWith('sandbox')) return 'sandbox';
  if (value.startsWith('archives')) return 'archives';
  if (value.startsWith('personas')) return 'personas';
  if (value.startsWith('worldbooks')) return 'worldbooks';
  if (value.startsWith('plugins')) return 'plugins';
  return value;
}

function isSandboxRoute(route) {
  return String(route || '').startsWith('sandbox');
}

const app = {
  store: null,
  runtime: {
    apiKeys: {},
    health: null,
    healthCheckedAt: null,
    callState: 'idle',
    callDetail: '',
    aiStatus: 'checking',
    currentView: null,
    viewToken: 0,
    route: 'archives',
    query: new URLSearchParams(),
    modalCount: 0,
  },

  async boot() {
    this.store = await Store.open();
    this.store.onPersistenceError = (error) => {
      toastError(`本地数据保存失败：${error?.message || '未知错误'}`);
    };

    if (this.store.loadInfo.loadError) {
      this.store.logError('storage.load.failed', this.store.loadInfo.loadError, {
        message: '读取本地数据失败，已创建新的工作区。',
      });
    }

    const { keys, failures } = await hydrateKeys(this.store.state.settings);
    this.runtime.apiKeys = keys;
    for (const failure of failures) {
      this.store.warn('key.decrypt.failed', `无法解密 ${failure.provider} 的 API Key，请重新填写。`, {
        detail: failure,
      });
    }
    if (failures.length) {
      toast(`有 ${failures.length} 个已保存的 API Key 无法解密，请到设置中重新填写。`, {
        type: 'warn',
        duration: 7_000,
      });
    }

    this.store.setRoute(parseHash().route);
    this.renderNavigation();
    this.bindShellEvents();
    this.bindGlobalErrors();

    await this.refreshHealth({ quiet: true });

    const hash = window.location.hash;
    if (!hash) {
      const active = this.store.getActiveArchive();
      const next = active ? 'chat' : 'archives';
      window.history.replaceState(null, '', `#/${next}`);
    }
    if (parseHash().route === 'chat' && !this.store.getActiveArchive()) {
      window.history.replaceState(null, '', '#/archives');
    }
    if (parseHash().route === 'sandbox/play' && !this.store.getActiveSandboxSave()) {
      window.history.replaceState(null, '', '#/sandbox');
    }

    await this.renderRoute();
    this.refreshChrome();

    this.store.info('app.started', '暖屿已启动。', {
      detail: {
        version: APP_VERSION,
        storage: this.store.loadInfo.source,
        archives: this.store.state.archives.length,
      },
    });

    this.store.scheduleSave(800);

    window.addEventListener('hashchange', () => {
      this.closeSidebar();
      this.renderRoute().catch((error) => this.handleViewError(error));
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.store.flush().catch(() => {});
    });
    window.addEventListener('pagehide', () => {
      this.store.flush().catch(() => {});
    });

    window.setInterval(() => {
      if (document.visibilityState === 'visible') this.refreshHealth({ quiet: true });
    }, 60_000);

    this.store.subscribe((state, meta) => {
      this.refreshChrome();
      if (meta?.reason === 'archive-created') {
        this.runtime.callState = 'idle';
      }
    });

    window.__WARM_ISLE__ = this;
  },

  async renderRoute() {
    const { route, query } = parseHash();
    if (route === 'chat' && !this.store.getActiveArchive()) {
      window.location.replace('#/archives');
      return;
    }
    if (route === 'sandbox/play' && !this.store.getActiveSandboxSave()) {
      window.location.replace('#/sandbox');
      return;
    }
    const token = ++this.runtime.viewToken;
    this.runtime.route = route;
    this.runtime.query = query;
    this.store.setRoute(route);
    document.documentElement.dataset.route = route;
    this.closeSidebar();
    this.refreshChrome();

    const root = qs('#view-root');
    const previousCleanup = this.runtime.currentView?.cleanup;
    if (typeof previousCleanup === 'function') {
      try {
        previousCleanup();
      } catch (error) {
        console.error('视图清理失败：', error);
      }
    }
    this.runtime.currentView = null;

    const loader = VIEW_LOADERS[route];
    if (!loader) return;
    clear(root);
    root.appendChild(
      h(
        'div',
        { class: 'route-loading', role: 'status' },
        h('span', { class: 'spinner' }),
        h('span', { text: '正在铺开这一页…' }),
      ),
    );

    try {
      const module = await loader();
      if (token !== this.runtime.viewToken) return;
      clear(root);
      const render = module.render || module.default;
      const view = await render(root, this);
      if (token !== this.runtime.viewToken) {
        view?.cleanup?.();
        return;
      }
      this.runtime.currentView = view || null;
      root.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (error) {
      if (token !== this.runtime.viewToken) return;
      this.handleViewError(error);
    }
  },

  async handleViewError(error) {
    console.error(error);
    this.store.logError('view.render.failed', error, {
      detail: { route: this.runtime.route, hash: location.hash },
    });
    const root = qs('#view-root');
    replaceChildren(
      root,
      h(
        'div',
        { class: 'fatal-state' },
        h('span', { class: 'fatal-icon' }, icon('warning')),
        h('h1', { text: '这一页没有铺开' }),
        h('p', { text: error?.message || '页面渲染时发生未知错误，详情已写入运行日记。' }),
        h(
          'div',
          { class: 'button-row' },
          h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              onclick: () => this.renderRoute(),
            },
            icon('refresh'),
            h('span', { text: '重试' }),
          ),
          h(
            'a',
            { class: 'btn btn-ghost', href: '#/journal' },
            icon('journal'),
            h('span', { text: '查看运行日记' }),
          ),
        ),
      ),
    );
  },

  navigate(route, { query = null, replace = false } = {}) {
    const safeRoute = VIEW_LOADERS[route] ? route : 'archives';
    let target = `#/${safeRoute}`;
    if (query) {
      const params = query instanceof URLSearchParams ? query : new URLSearchParams(query);
      const serialized = params.toString();
      if (serialized) target += `?${serialized}`;
    }
    if (window.location.hash === target) {
      this.renderRoute();
      return;
    }
    if (replace) window.history.replaceState(null, '', target);
    else window.location.hash = target;
    if (replace) this.renderRoute();
  },

  openChat(archiveId) {
    const archive = this.store.getArchive(archiveId);
    if (!archive) {
      toastError('这个存档已经不存在了。');
      return;
    }
    if (this.store.state.activeArchiveId !== archiveId) {
      this.store.setActiveArchive(archiveId);
      this.store.info('archive.switched', `切换到存档「${archive.name}」。`, { archiveId });
    }
    this.navigate('chat');
  },

  openSandbox(saveId) {
    const save = this.store.getSandboxSave(saveId);
    if (!save) {
      toastError('这个沙盒存档已经不存在了。');
      return;
    }
    if (this.store.state.activeSandboxSaveId !== saveId) {
      this.store.setActiveSandboxSave(saveId);
      this.store.info(
        'sandbox.switched',
        `切换到沙盒存档「${save.name}」。`,
        { archiveId: saveId },
      );
    }
    this.navigate('sandbox/play');
  },

  getProviderKey(providerId = this.store.state.settings.provider) {
    return this.runtime.apiKeys?.[providerId] || '';
  },

  /**
   * 实际发送给本地代理的 Key。
   * 设置里的「优先使用服务端密钥」只表示优先级：服务端没有配置时，
   * 自动回退到浏览器本地保存的 Key，避免界面显示已配置却发出空 Key。
   */
  getEffectiveApiKey(providerId = this.store.state.settings.provider) {
    const localKey = this.getProviderKey(providerId);
    if (!this.store.state.settings.useServerKey) return localKey;
    const serverKeyConfigured = Boolean(this.runtime.health?.serverKeys?.[providerId]);
    return serverKeyConfigured ? '' : localKey;
  },

  hasLocalKey(providerId = this.store.state.settings.provider) {
    return Boolean(this.runtime.apiKeys?.[providerId]);
  },

  hasServerKey(providerId = this.store.state.settings.provider) {
    return Boolean(this.runtime.health?.serverKeys?.[providerId]);
  },

  setProviderKey(providerId, key) {
    if (!this.runtime.apiKeys) this.runtime.apiKeys = {};
    if (key) this.runtime.apiKeys[providerId] = key;
    else delete this.runtime.apiKeys[providerId];
    this.refreshAIStatus();
  },

  hasKey(providerId = this.store.state.settings.provider) {
    return this.hasLocalKey(providerId) || this.hasServerKey(providerId);
  },

  markAIStatus(state, detail = '') {
    if (state === 'online') {
      this.runtime.callState = 'ok';
      this.runtime.callDetail = detail || '最近一次调用成功';
    } else if (state === 'offline') {
      this.runtime.callState = 'error';
      this.runtime.callDetail = detail || '最近一次调用失败';
    } else {
      this.runtime.callState = 'idle';
      this.runtime.callDetail = detail;
    }
    this.refreshAIStatus();
  },

  refreshAIStatus() {
    if (!this.store) return;
    const settings = this.store.state.settings;
    const provider = getProvider(settings.provider);
    const serverOnline = Boolean(this.runtime.health?.ok);
    const localKeyConfigured = this.hasLocalKey(settings.provider);
    const serverKeyConfigured = this.hasServerKey(settings.provider);
    const keySource =
      localKeyConfigured && !(settings.useServerKey && serverKeyConfigured)
        ? '本地密钥'
        : '服务端密钥';

    let status = 'online';
    let label = '在线';
    let detail = `${provider.label} · ${settings.model}`;

    if (settings.demoMode) {
      status = 'demo';
      label = '演示';
      detail = '离线演示模式：不会调用模型，也不会消耗 token。';
    } else if (!serverOnline) {
      status = 'offline';
      label = '离线';
      detail = '本地服务未连接。请确认 node server.mjs 正在运行。';
    } else if (!this.hasKey(settings.provider)) {
      status = 'unconfigured';
      label = '未配置';
      detail = settings.useServerKey
        ? `${provider.label} 的服务端环境变量密钥和本地 API Key 都没有配置。`
        : `${provider.label} 还没有填写 API Key。`;
    } else if (this.runtime.callState === 'error') {
      status = 'offline';
      label = '异常';
      detail = this.runtime.callDetail || '最近一次模型调用失败，请查看运行日记。';
    } else if (this.runtime.callState === 'ok') {
      status = 'online';
      label = '在线';
      detail = `${provider.label} · ${settings.model} · ${keySource} · 最近调用成功`;
    } else {
      status = 'online';
      label = '在线';
      detail = `${provider.label} · ${settings.model} · ${keySource} · 已就绪`;
    }

    this.runtime.aiStatus = status;
    const pill = qs('#ai-status');
    if (pill) {
      pill.dataset.status = status;
      pill.title = detail;
      const text = qs('#ai-status-text');
      if (text) text.textContent = label;
      pill.setAttribute('aria-label', `模型状态：${label}。${detail}`);
    }
  },

  async refreshHealth({ quiet = false } = {}) {
    const health = await fetchHealth();
    this.runtime.health = health;
    this.runtime.healthCheckedAt = new Date().toISOString();
    if (!health && !quiet) {
      toast('本地服务暂时不可达，AI 调用将无法进行。', { type: 'warn' });
    }
    this.refreshAIStatus();
    return health;
  },

  updateTokenHud() {
    if (!this.store) return;
    const stats = this.store.state.stats;
    const text = qs('#token-hud-text');
    if (text) {
      text.textContent = `${formatCompactNumber(stats?.totalTokens || 0)} tokens`;
    }
    const hud = qs('#token-hud');
    if (hud) {
      hud.title = `累计 ${formatNumber(stats?.totalTokens || 0)} tokens · ${formatNumber(
        stats?.requests || 0,
      )} 次请求 · 输入 ${formatNumber(stats?.promptTokens || 0)} / 输出 ${formatNumber(
        stats?.completionTokens || 0,
      )}`;
    }
  },

  renderNavigation() {
    const nav = qs('#main-nav');
    const mobile = qs('#mobile-nav');
    const version = qs('#app-version');
    if (version) version.textContent = `v${APP_VERSION}`;

    const romanceItems = NAV_ITEMS.filter(
      (item) => !['journal', 'settings'].includes(item.route),
    );
    const commonItems = NAV_ITEMS.filter((item) =>
      ['journal', 'settings'].includes(item.route),
    );

    const renderGroup = (title, items, className = '') =>
      h(
        'div',
        { class: `nav-group ${className}`.trim() },
        h('p', { class: 'nav-group-title', text: title }),
        ...items.map((item) =>
          h(
            'a',
            {
              class: 'nav-item',
              href: `#/${item.route}`,
              'data-route': item.route,
            },
            icon(item.icon),
            h('span', { text: item.label }),
            h('span', { class: 'nav-dot', 'aria-hidden': 'true' }),
          ),
        ),
      );

    replaceChildren(
      nav,
      renderGroup('恋爱对话', romanceItems, 'nav-group-romance'),
      renderGroup('沙盒世界', SANDBOX_NAV_ITEMS, 'nav-group-sandbox'),
      renderGroup('通用', commonItems, 'nav-group-common'),
    );

    const allItems = [...NAV_ITEMS, ...SANDBOX_NAV_ITEMS];
    replaceChildren(
      mobile,
      ...MOBILE_NAV.map((route) => {
        const item = allItems.find((entry) => entry.route === route);
        return h(
          'a',
          {
            class: 'mobile-nav-item',
            href: `#/${item.route}`,
            'data-route': item.route,
          },
          icon(item.icon),
          h('span', { text: item.label }),
        );
      }),
    );
  },

  refreshChrome() {
    if (!this.store) return;
    const { route } = parseHash();
    const sandboxMode = isSandboxRoute(route);
    const meta = ROUTE_META[route] || SANDBOX_ROUTE_META[route] || ROUTE_META.archives;
    const title = qs('#topbar-title');
    const kicker = qs('#topbar-kicker');
    if (title) title.textContent = meta.title;
    if (kicker) {
      let kickerText;
      if (route === 'chat') kickerText = this.store.getActiveArchive()?.name || APP_NAME;
      else if (route === 'sandbox/play') {
        kickerText = this.store.getActiveSandboxSave()?.name || `${APP_NAME} · 沙盒`;
      } else {
        kickerText = `${APP_NAME} / ${meta.label.split(' / ')[0]}`;
      }
      kicker.textContent = kickerText;
    }
    document.title = `${meta.title} · ${APP_NAME}`;

    const activeNav = navRouteFor(route);
    for (const item of document.querySelectorAll('.nav-item, .mobile-nav-item')) {
      item.classList.toggle('is-active', item.dataset.route === activeNav);
    }

    const newLabel = qs('#new-archive-label');
    if (newLabel) newLabel.textContent = sandboxMode ? '创建沙盒世界' : '创建新存档';
    const newButton = qs('#new-archive-btn');
    if (newButton) newButton.dataset.mode = sandboxMode ? 'sandbox' : 'romance';

    const recentTitle = qs('#recent-title');
    const recentAll = qs('#recent-all-link');
    if (recentTitle) recentTitle.textContent = sandboxMode ? '最近的历险' : '最近的存档';
    if (recentAll) {
      recentAll.textContent = '全部';
      recentAll.href = sandboxMode ? '#/sandbox' : '#/archives';
    }

    const recent = qs('#recent-archives');
    if (recent && sandboxMode) {
      const saves = [...(this.store.state.sandboxSaves || [])]
        .sort(
          (a, b) =>
            new Date(b.lastPlayedAt || b.updatedAt) -
            new Date(a.lastPlayedAt || a.updatedAt),
        )
        .slice(0, 5);
      if (!saves.length) {
        recent.replaceChildren(
          h('p', { class: 'recent-empty', text: '还没有沙盒历险。先选择一个世界吧。' }),
        );
      } else {
        recent.replaceChildren(
          ...saves.map((save) => {
            const category = getSandboxCategory(save.category);
            const sceneText =
              save.world?.scene?.summary ||
              save.messages?.at(-1)?.content ||
              '等待新的行动';
            return h(
              'button',
              {
                class: `recent-item ${
                  save.id === this.store.state.activeSandboxSaveId ? 'is-active' : ''
                }`.trim(),
                type: 'button',
                'aria-current':
                  save.id === this.store.state.activeSandboxSaveId ? 'true' : undefined,
                onclick: () => this.openSandbox(save.id),
              },
              h(
                'span',
                {
                  class: 'recent-sandbox-icon',
                  style: { '--sandbox-accent': category.accent },
                },
                icon(category.icon),
              ),
              h(
                'span',
                { class: 'recent-copy' },
                h('strong', { text: save.name }),
                h('small', {
                  text: truncateText(sceneText, 30) || '等待新的行动',
                }),
              ),
            );
          }),
        );
      }
    } else if (recent) {
      const archives = [...this.store.state.archives]
        .sort(
          (a, b) =>
            new Date(b.lastChatAt || b.updatedAt) - new Date(a.lastChatAt || a.updatedAt),
        )
        .slice(0, 5);
      if (!archives.length) {
        recent.replaceChildren(
          h('p', { class: 'recent-empty', text: '还没有存档。先去创建一段故事吧。' }),
        );
      } else {
        recent.replaceChildren(
          ...archives.map((archive) => {
            const persona = this.store.getPersona(archive.personaId);
            return h(
              'button',
              {
                class: `recent-item ${
                  archive.id === this.store.state.activeArchiveId ? 'is-active' : ''
                }`.trim(),
                type: 'button',
                'aria-current':
                  archive.id === this.store.state.activeArchiveId ? 'true' : undefined,
                onclick: () => this.openChat(archive.id),
              },
              avatar(persona, { size: 'xs' }),
              h(
                'span',
                { class: 'recent-copy' },
                h('strong', { text: archive.name }),
                h('small', {
                  text:
                    truncateText(archive.messages.at(-1)?.content || '还没有对话', 30) ||
                    '还没有对话',
                }),
              ),
            );
          }),
        );
      }
    }

    this.syncQuickModel();
    this.refreshAIStatus();
    this.updateTokenHud();
  },

  syncQuickModel() {
    const select = qs('#quick-model');
    if (!select) return;
    const settings = this.store.state.settings;
    const currentValue = `${settings.provider}::${settings.model}`;
    const isCustomCurrent =
      settings.provider === 'custom' ||
      !getProvider(settings.provider).models.some((model) => model.id === settings.model);

    if (isCustomCurrent) {
      const existing = select.querySelector('option[data-dynamic="custom-current"]');
      if (!existing) {
        const option = h('option', {
          value: currentValue,
          text: `${getProvider(settings.provider).shortLabel} · ${settings.model || '自定义模型'}`,
        });
        option.dataset.dynamic = 'custom-current';
        select.insertBefore(option, select.firstChild);
      } else {
        existing.value = currentValue;
        existing.textContent = `${getProvider(settings.provider).shortLabel} · ${
          settings.model || '自定义模型'
        }`;
      }
    }
    select.value = currentValue;
    if (!select.value) {
      select.value = '__settings__';
    }

    const dot = qs('#quick-provider-dot');
    if (dot) dot.style.background = safeColor(getProvider(settings.provider).accent);
  },

  buildQuickModelSelect() {
    const select = qs('#quick-model');
    if (!select) return;
    const groups = [];
    for (const provider of Object.values(PROVIDERS)) {
      if (!provider.models.length) continue;
      const group = h('optgroup', { label: provider.label });
      for (const model of provider.models) {
        group.appendChild(
          h('option', {
            value: `${provider.id}::${model.id}`,
            text: `${provider.label} · ${model.label}`,
          }),
        );
      }
      groups.push(group);
    }
    const customGroup = h('optgroup', { label: '自定义 / 更多' });
    customGroup.appendChild(
      h('option', { value: '__settings__', text: '自定义接口与密钥…' }),
    );
    select.append(...groups, customGroup);

    select.addEventListener('change', () => {
      if (select.value === '__settings__') {
        this.navigate('settings');
        this.syncQuickModel();
        return;
      }
      const [providerId, ...modelParts] = select.value.split('::');
      const modelId = modelParts.join('::');
      if (!PROVIDERS[providerId] || !modelId) return;
      const providerChanged = this.store.state.settings.provider !== providerId;
      this.store.update(
        (state) => {
          state.settings.provider = providerId;
          state.settings.model = modelId;
          if (providerChanged) state.settings.baseUrl = '';
        },
        { reason: 'settings-model-changed' },
      );
      this.runtime.callState = 'idle';
      this.store.info(
        'model.changed',
        `切换模型为 ${PROVIDERS[providerId].label} · ${modelId}。`,
      );
      this.refreshAIStatus();
      toast(`已切换到 ${PROVIDERS[providerId].label} · ${modelId}`, { type: 'success' });
    });
  },

  bindShellEvents() {
    this.buildQuickModelSelect();

    qs('#new-archive-btn')?.addEventListener('click', () => {
      this.navigate(isSandboxRoute(parseHash().route) ? 'sandbox/new' : 'archives/new');
    });
    qs('#menu-btn')?.addEventListener('click', () => this.toggleSidebar());
    qs('#sidebar-scrim')?.addEventListener('click', () => this.closeSidebar());
    qs('#ai-status')?.addEventListener('click', () => this.navigate('settings'));
    qs('#token-hud')?.addEventListener('click', () => this.openTokenStats());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeSidebar();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 960) this.closeSidebar();
    });
  },

  openTokenStats() {
    const stats = this.store.state.stats;
    const providers = Object.entries(stats.byProvider || {});
    openModal({
      title: 'Token 账本',
      eyebrow: '只记录，不上传',
      subtitle: '真实 usage 优先，服务商未返回 usage 时使用轻量估算。',
      size: 'md',
      body: h(
        'div',
        { class: 'stack-md' },
        h(
          'div',
          { class: 'stat-grid' },
          statCard('总 tokens', formatNumber(stats.totalTokens), '累计消耗'),
          statCard('请求', formatNumber(stats.requests), 'API 调用次数'),
          statCard('输入', formatNumber(stats.promptTokens), '提示词'),
          statCard('输出', formatNumber(stats.completionTokens), '模型回复'),
        ),
        providers.length
          ? h(
              'div',
              { class: 'mini-table' },
              ...providers.map(([providerId, value]) =>
                h(
                  'div',
                  { class: 'mini-table-row' },
                  h('span', {
                    class: 'mini-table-name',
                    text: PROVIDERS[providerId]?.label || providerId,
                  }),
                  h('span', { text: `${formatNumber(value.totalTokens)} tokens` }),
                ),
              ),
            )
          : h('p', { class: 'muted', text: '还没有调用记录。' }),
        stats.estimated
          ? h('p', {
              class: 'muted small',
              text: `${formatNumber(stats.estimated)} 次请求的 usage 为估算值，仅供观察趋势。`,
            })
          : null,
      ),
      actions: [
        {
          label: '查看详细设置',
          variant: 'ghost',
          onClick: () => this.navigate('settings'),
        },
        { label: '关闭', variant: 'primary' },
      ],
    });
  },

  toggleSidebar() {
    const body = document.body;
    const open = !body.classList.contains('sidebar-open');
    body.classList.toggle('sidebar-open', open);
    qs('#menu-btn')?.setAttribute('aria-expanded', String(open));
  },

  closeSidebar() {
    document.body.classList.remove('sidebar-open');
    qs('#menu-btn')?.setAttribute('aria-expanded', 'false');
  },

  bindGlobalErrors() {
    const seen = new Set();
    const record = (event, error, detail) => {
      const signature = `${error?.name}:${error?.message}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      this.store.logError(event, error, { detail });
      toastError(error?.message || '发生了未处理的错误，详情已写入运行日记。');
    };

    window.addEventListener('error', (event) => {
      if (event.error?.name === 'AbortError') return;
      record('window.error', event.error || new Error(event.message), {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      if (event.reason?.name === 'AbortError' || event.reason?.code === 'ABORTED') return;
      const reason =
        event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      record('window.unhandledrejection', reason, {});
    });
  },
};

function statCard(label, value, hint) {
  return h(
    'div',
    { class: 'stat-card' },
    h('span', { class: 'stat-label', text: label }),
    h('strong', { class: 'stat-value', text: value }),
    h('span', { class: 'stat-hint', text: hint }),
  );
}

app.boot().catch((error) => {
  console.error('暖屿启动失败：', error);
  const root = document.getElementById('view-root');
  if (root) {
    replaceChildren(
      root,
      h(
        'div',
        { class: 'fatal-state' },
        h('span', { class: 'fatal-icon' }, icon('warning')),
        h('h1', { text: '暖屿没有成功醒来' }),
        h('p', { text: error?.message || '启动时发生未知错误。' }),
        h('p', {
          class: 'muted small',
          text: '请检查浏览器控制台，或刷新页面重试。若使用隐私模式，请允许 IndexedDB 与 LocalStorage。',
        }),
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onclick: () => window.location.reload(),
          },
          icon('refresh'),
          h('span', { text: '重新加载' }),
        ),
      ),
    );
  }
});
