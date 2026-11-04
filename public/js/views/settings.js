/**
 * 设置：模型、密钥、连接检测、token 账本、本地数据管理。
 *
 * 安全约定：
 * - API Key 永不写入运行日记；
 * - 勾选“记住”时，用 WebCrypto AES-GCM 加密后存入 state.keyVault；
 * - 未勾选时仅保存在 sessionStorage；
 * - 导出的全量备份会主动移除 keyVault。
 */

import {
  APP_NAME,
  APP_VERSION,
  LIMITS,
  PROVIDERS,
  getProvider,
} from '../core/constants.js';
import {
  clone,
  downloadJson,
  formatBytes,
  formatDateTime,
  formatNumber,
  readTextFile,
  safeNumber,
} from '../core/utils.js';
import {
  checkConnection,
  clearCompletionCache,
} from '../services/ai.js';
import { getStorageInfo } from '../services/storage.js';
import { createInitialState, normalizeState } from '../data/schemas.js';
import {
  forgetKey,
  maskKey,
  persistKey,
  writeSessionKeys,
} from '../services/vault.js';
import {
  checkbox,
  field,
  input,
  pageHeader,
  select,
} from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const { store } = app;
  const settings = store.state.settings;
  let currentProvider = settings.provider;
  let keyTouched = new Set();
  let rememberChanged = false;

  const keyDrafts = {};
  for (const [providerId, key] of Object.entries(app.runtime.apiKeys || {})) {
    if (key) keyDrafts[providerId] = key;
  }

  /* ------------------------------ 表单控件 ------------------------------ */

  const providerSelect = select({
    id: 'set-provider',
    options: Object.values(PROVIDERS).map((provider) => ({
      value: provider.id,
      label: provider.label,
    })),
    value: currentProvider,
    onChange: () => switchProvider(providerSelect.value),
  });
  const providerDescription = h('p', { class: 'provider-description' });

  const modelSelect = select({
    id: 'set-model',
    options: [],
    onChange: () => {
      updateModelVisibility();
      updateConfigSummary();
    },
  });
  const modelCustomInput = input({
    id: 'set-model-custom',
    maxLength: 160,
    placeholder: '自定义模型 ID，例如 gpt-4.1',
    onInput: updateConfigSummary,
  });

  const baseUrlInput = input({
    id: 'set-base-url',
    maxLength: 500,
    placeholder: '',
    onInput: updateConfigSummary,
  });

  const keyInput = h('input', {
    class: 'input key-input',
    id: 'set-api-key',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '粘贴 API Key',
    'aria-label': 'API Key',
  });
  const keyVisibilityButton = h(
    'button',
    {
      class: 'icon-btn field-inline-btn',
      type: 'button',
      title: '显示 / 隐藏密钥',
      'aria-label': '显示或隐藏密钥',
      onclick: () => {
        const showing = keyInput.type === 'text';
        keyInput.type = showing ? 'password' : 'text';
        keyVisibilityButton.classList.toggle('is-active', !showing);
        keyVisibilityButton.replaceChildren(icon(showing ? 'eye' : 'eyeOff'));
      },
    },
    icon('eye'),
  );
  const keyStatus = h('div', { class: 'key-status' });
  const serverKeyHint = h('p', { class: 'field-hint' });

  const useServerKeyCheck = checkbox({
    id: 'set-use-server-key',
    label: '优先使用服务端环境变量密钥',
    checked: settings.useServerKey,
    description:
      '在 .env 中配置 DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY；服务端未配置时自动回退到本地 Key。',
    onChange: () => updateConfigSummary(),
  });
  const rememberKeyCheck = checkbox({
    id: 'set-remember-key',
    label: '在这台设备记住密钥（AES-GCM 加密）',
    checked: settings.rememberKeys,
    description: '关闭后密钥只存在于当前标签页，关闭浏览器即清除。',
    onChange: () => {
      rememberChanged = true;
      updateConfigSummary();
    },
  });
  const cryptoWarning = globalThis.crypto?.subtle
    ? null
    : h('p', {
        class: 'field-hint',
        text:
          location.protocol === 'https:'
            ? '当前浏览器不支持 WebCrypto。请更新系统浏览器，或关闭“记住密钥”仅在本次会话使用。'
            : '当前不是 HTTPS，浏览器不会提供 WebCrypto。请改用 https:// 地址；或关闭“记住密钥”仅在本次会话使用。',
      });

  const temperatureRange = h('input', {
    type: 'range',
    id: 'set-temperature',
    min: '0',
    max: '2',
    step: '0.05',
    value: String(settings.temperature),
    class: 'range-input',
    onInput: () => {
      temperatureValue.textContent = Number(temperatureRange.value).toFixed(2);
      updateConfigSummary();
    },
  });
  const temperatureValue = h('span', {
    class: 'range-value',
    text: Number(settings.temperature).toFixed(2),
  });

  const maxTokensRange = h('input', {
    type: 'range',
    id: 'set-max-tokens',
    min: '128',
    max: '4096',
    step: '64',
    value: String(settings.maxTokens),
    class: 'range-input',
    onInput: () => {
      maxTokensValue.textContent = String(maxTokensRange.value);
      updateConfigSummary();
    },
  });
  const maxTokensValue = h('span', { class: 'range-value', text: String(settings.maxTokens) });

  const contextRange = h('input', {
    type: 'range',
    id: 'set-context',
    min: '1800',
    max: '12000',
    step: '200',
    value: String(settings.contextChars),
    class: 'range-input',
    onInput: () => {
      contextValue.textContent = `${contextRange.value} 字符`;
      updateConfigSummary();
    },
  });
  const contextValue = h('span', {
    class: 'range-value',
    text: `${settings.contextChars} 字符`,
  });

  const streamToggle = checkbox({
    id: 'set-stream',
    label: '流式显示回复',
    checked: settings.stream !== false,
    description: '逐字显示更自然；关闭后等待完整回复再出现。',
  });
  const demoToggle = checkbox({
    id: 'set-demo',
    label: '离线演示模式',
    checked: settings.demoMode,
    description: '不调用模型、不计费，用本地模板模拟对话与日记，适合先体验界面。',
    onChange: () => updateConfigSummary(),
  });

  const testResult = h('div', { class: 'connection-result', hidden: true });
  const testButton = h(
    'button',
    { class: 'btn btn-soft', type: 'button', onclick: testConnection },
    icon('link'),
    h('span', { text: '测试连接' }),
  );
  const saveButtonTop = h(
    'button',
    { class: 'btn btn-primary', type: 'submit', form: 'settings-form' },
    icon('save'),
    h('span', { text: '保存设置' }),
  );

  const summaryProvider = h('strong');
  const summaryModel = h('span');
  const summaryStatus = h('span');
  const summaryKey = h('span');

  /* ------------------------------ 页面结构 ------------------------------ */

  const modelForm = h(
    'form',
    {
      id: 'settings-form',
      class: 'settings-form',
      onsubmit: (event) => {
        event.preventDefault();
        saveSettings().catch((error) => {
          store.logError('settings.save.failed', error);
          toastError(`保存设置失败：${error.message}`);
        });
      },
    },
    h(
      'section',
      { class: 'settings-card' },
      h(
        'div',
        { class: 'settings-card-head' },
        h(
          'div',
          {},
          h('p', { class: 'eyebrow', text: 'Model connection' }),
          h('h2', { text: '模型与密钥' }),
          h('p', { text: '浏览器只与本机服务通信，由服务端代发请求，避免跨域暴露密钥。' }),
        ),
        h(
          'span',
          { class: 'settings-status-chip', id: 'settings-ai-chip' },
          h('span', { class: 'status-dot' }),
          h('span', { text: '检查中' }),
        ),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({
          label: '提供商',
          control: providerSelect,
          htmlFor: 'set-provider',
          hint: '支持 DeepSeek、OpenAI GPT-4 系列与 Claude。',
        }),
        field({
          label: '模型',
          control: h(
            'div',
            { class: 'stack-xs' },
            modelSelect,
            modelCustomInput,
          ),
          htmlFor: 'set-model',
        }),
      ),
      providerDescription,
      field({
        label: 'API Base URL',
        control: baseUrlInput,
        htmlFor: 'set-base-url',
        hint: '留空使用提供商默认地址。自定义接口需填写到 /v1 这一级。',
      }),
      h(
        'div',
        { class: 'api-key-field field' },
        h(
          'div',
          { class: 'field-label-row' },
          h('label', { class: 'field-label', for: 'set-api-key', text: 'API Key' }),
          h('span', { class: 'field-hint', text: '只保存在本机，不写入日志。' }),
        ),
        h('div', { class: 'key-input-wrap' }, keyInput, keyVisibilityButton),
        keyStatus,
        h(
          'div',
          { class: 'key-actions' },
          h(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () => {
                keyInput.value = '';
                keyDrafts[currentProvider] = '';
                keyTouched.add(currentProvider);
                updateKeyStatus();
              },
            },
            icon('trash'),
            h('span', { text: '清空此密钥（保存后生效）' }),
          ),
        ),
      ),
      useServerKeyCheck,
      rememberKeyCheck,
      cryptoWarning,
      serverKeyHint,
      h('div', { class: 'settings-divider' }),
      h(
        'div',
        { class: 'slider-field' },
        h(
          'div',
          { class: 'slider-head' },
          h('label', { class: 'field-label', for: 'set-temperature', text: '温度' }),
          temperatureValue,
        ),
        temperatureRange,
        h('p', { class: 'field-hint', text: '越高越有创造力，越低越稳定。角色扮演建议 0.8–1.0。' }),
      ),
      h(
        'div',
        { class: 'slider-field' },
        h(
          'div',
          { class: 'slider-head' },
          h('label', { class: 'field-label', for: 'set-max-tokens', text: '单轮最大输出 tokens' }),
          maxTokensValue,
        ),
        maxTokensRange,
        h('p', {
          class: 'field-hint',
          text: '建议 600–1000。若启用“不少于 1000 字”等长篇幅插件，本轮会自动临时提高输出上限，无需手动改这里。',
        }),
      ),
      streamToggle,
      demoSwitchRow(demoToggle),
      h(
        'div',
        { class: 'settings-actions' },
        testButton,
        saveButtonTop,
      ),
      testResult,
    ),
    h(
      'section',
      { class: 'settings-card' },
      h(
        'div',
        { class: 'settings-card-head' },
        h(
          'div',
          {},
          h('p', { class: 'eyebrow', text: 'Memory budget' }),
          h('h2', { text: '记忆与上下文' }),
          h('p', {
            text: '暖屿优先用日记替代完整历史。这里的预算控制世界书、日记与最近对话的总字符数。',
          }),
        ),
      ),
      h(
        'div',
        { class: 'slider-field' },
        h(
          'div',
          { class: 'slider-head' },
          h('label', { class: 'field-label', for: 'set-context', text: '上下文预算' }),
          contextValue,
        ),
        contextRange,
        h('p', {
          class: 'field-hint',
          text: '默认 4600 字符，约 3000–4500 tokens。插件优先完整载入，其余预算分配给世界书、日记与最近对话。',
        }),
      ),
      h(
        'div',
        { class: 'budget-breakdown' },
        budgetItem('插件', '最高优先', 'plug'),
        budgetItem('世界书', '余量 30%', 'book'),
        budgetItem('相关日记', '余量 20%', 'brain'),
        budgetItem('未压缩对话', '余量 50%', 'chat'),
      ),
    ),
  );

  const page = h(
    'div',
    { class: 'page page-settings' },
    pageHeader({
      eyebrow: 'Preferences',
      title: '设置',
      lede: '连接模型、管理密钥、查看 token 账本，以及备份或清理本地数据。',
      actions: [saveButtonTop],
    }),
    h(
      'div',
      { class: 'settings-layout' },
      modelForm,
      h(
        'aside',
        { class: 'settings-side' },
        h(
          'section',
          { class: 'settings-side-card config-summary' },
          h('p', { class: 'eyebrow', text: '当前配置' }),
          h(
            'div',
            { class: 'config-summary-provider' },
            icon('spark'),
            h('div', {}, summaryProvider, summaryModel),
          ),
          h('div', { class: 'summary-divider' }),
          h('div', { class: 'summary-row' }, h('span', { text: '状态' }), summaryStatus),
          h('div', { class: 'summary-row' }, h('span', { text: '密钥来源' }), summaryKey),
          h('div', { class: 'summary-row' }, h('span', { text: '演示模式' }), h('span', { text: settings.demoMode ? '开启' : '关闭' })),
          h(
            'div',
            { class: 'summary-note' },
            icon('shield'),
            h('span', { text: '数据与密钥都留在这台设备。' }),
          ),
        ),
        h(
          'section',
          { class: 'settings-side-card' },
          h(
            'div',
            { class: 'side-card-head' },
            h(
              'div',
              { class: 'side-card-title' },
              h('span', { class: 'side-kicker', text: 'Health' }),
              h('h2', { text: '本地服务' }),
            ),
            h(
              'button',
              {
                class: 'icon-btn subtle',
                type: 'button',
                title: '重新检查本地服务',
                'aria-label': '重新检查本地服务',
                onclick: async () => {
                  await app.refreshHealth();
                  renderHealth();
                  updateConfigSummary();
                },
              },
              icon('refresh'),
            ),
          ),
          h('div', { class: 'health-block', id: 'health-block' }),
        ),
        h(
          'section',
          { class: 'settings-side-card' },
          h('p', { class: 'eyebrow', text: 'Token ledger' }),
          h('div', { class: 'side-token-total' }, h('strong', { text: formatNumber(store.state.stats.totalTokens) }), h('span', { text: '累计 tokens' })),
          h(
            'div',
            { class: 'summary-row' },
            h('span', { text: '请求次数' }),
            h('span', { text: formatNumber(store.state.stats.requests) }),
          ),
          h(
            'div',
            { class: 'summary-row' },
            h('span', { text: '输入 / 输出' }),
            h('span', {
              text: `${formatNumber(store.state.stats.promptTokens)} / ${formatNumber(
                store.state.stats.completionTokens,
              )}`,
            }),
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-sm btn-block',
              type: 'button',
              onclick: async () => {
                const ok = await confirmDialog({
                  title: '重置 token 统计？',
                  message: '只会清零统计数字，不会删除任何对话或日记。',
                  confirmText: '重置统计',
                });
                if (!ok) return;
                store.resetStats();
                store.info('token.reset', '重置了 token 统计。');
                toastSuccess('token 统计已重置。');
                app.renderRoute();
              },
            },
            icon('refresh'),
            h('span', { text: '重置统计' }),
          ),
        ),
      ),
    ),
    renderTokenSection(app),
    renderDataSection(app),
    h(
      'section',
      { class: 'settings-card about-card' },
      h(
        'div',
        { class: 'about-art' },
        h('span', { class: 'inline-brand-sun' }),
        h('span', { class: 'inline-brand-sea' }),
      ),
      h(
        'div',
        {},
        h('h2', { text: `${APP_NAME} Warm Isle` }),
        h('p', {
          text: `v${APP_VERSION} · 本地优先的 AI 角色扮演与日记记忆工坊。无框架、无追踪、无第三方脚本。`,
        }),
        h(
          'p',
          { class: 'muted small' },
          '数据存放于浏览器 IndexedDB；服务端只负责静态文件与 AI 代理。使用前请遵守模型服务商的条款。',
        ),
      ),
    ),
  );

  root.appendChild(page);

  /* ------------------------------ 提供商 / 模型 ------------------------------ */

  function currentProviderMeta() {
    return getProvider(currentProvider);
  }

  function populateModelSelect() {
    const provider = currentProviderMeta();
    const models = provider.models;
    modelSelect.replaceChildren(
      ...models.map((model) =>
        h('option', {
          value: model.id,
          text: `${model.label}${model.note ? ` · ${model.note}` : ''}`,
        }),
      ),
      h('option', { value: '__custom__', text: '自定义模型 ID…' }),
    );

    const currentModel = currentProvider === settings.provider ? settings.model : models[0]?.id || '__custom__';
    if (models.some((model) => model.id === currentModel)) {
      modelSelect.value = currentModel;
      modelCustomInput.value = '';
    } else if (currentModel && currentModel !== '__custom__') {
      modelSelect.value = '__custom__';
      modelCustomInput.value = currentModel;
    } else {
      modelSelect.value = models[0]?.id || '__custom__';
      modelCustomInput.value = '';
    }
    updateModelVisibility();
  }

  function updateModelVisibility() {
    const provider = currentProviderMeta();
    const useCustom = provider.id === 'custom' || modelSelect.value === '__custom__';
    modelSelect.hidden = provider.id === 'custom';
    modelCustomInput.hidden = !useCustom;
    if (provider.id === 'custom') modelSelect.value = '__custom__';
    if (useCustom) modelCustomInput.placeholder = '必填：模型 ID，例如 llama-3.1-70b';
    else modelCustomInput.placeholder = '自定义模型 ID';
  }

  function getModelValue() {
    if (currentProviderMeta().id === 'custom' || modelSelect.value === '__custom__') {
      return modelCustomInput.value.trim();
    }
    return modelSelect.value;
  }

  function switchProvider(providerId) {
    // 切换前保留当前输入，避免用户未保存时丢失草稿。
    keyDrafts[currentProvider] = keyInput.value.trim();
    currentProvider = providerId;
    const provider = currentProviderMeta();
    providerDescription.replaceChildren(
      h('strong', { text: provider.label }),
      h('span', { text: provider.description }),
    );
    baseUrlInput.value = '';
    baseUrlInput.placeholder = provider.baseUrl || 'https://your-api.example.com/v1';
    keyInput.value = keyDrafts[providerId] || '';
    keyInput.type = 'password';
    keyVisibilityButton.replaceChildren(icon('eye'));
    populateModelSelect();
    updateKeyStatus();
    updateConfigSummary();
    updateServerKeyHint();
  }

  function updateKeyStatus() {
    const provider = currentProviderMeta();
    const typed = keyInput.value.trim();
    const runtimeKey = app.runtime.apiKeys?.[currentProvider];
    const hasEncrypted = Boolean(store.state.settings.keyVault?.[currentProvider]);
    keyStatus.replaceChildren();
    if (typed) {
      keyStatus.appendChild(
        h(
          'span',
          { class: 'key-state is-present' },
          icon('key'),
          h('span', { text: `已填写 · ${maskKey(typed)}` }),
        ),
      );
    } else if (runtimeKey) {
      keyStatus.appendChild(
        h(
          'span',
          { class: 'key-state is-present' },
          icon('key'),
          h('span', { text: `已配置 · ${maskKey(runtimeKey)}` }),
        ),
      );
    } else if (hasEncrypted) {
      keyStatus.appendChild(
        h(
          'span',
          { class: 'key-state is-present' },
          icon('shield'),
          h('span', { text: '已保存加密密钥，但当前会话尚未解密；请重新填写。' }),
        ),
      );
    } else {
      keyStatus.appendChild(
        h(
          'span',
          { class: 'key-state is-missing' },
          icon('warning'),
          h('span', { text: '尚未配置本地密钥。' }),
        ),
      );
    }
    updateServerKeyHint();
    updateConfigSummary();
  }

  function updateServerKeyHint() {
    const provider = currentProviderMeta();
    const configured = Boolean(app.runtime.health?.serverKeys?.[currentProvider]);
    const preferServer = useServerKeyCheck.querySelector('input').checked;
    serverKeyHint.textContent = `服务端环境变量：${provider.keyEnv} ${
      configured ? '已配置' : '未配置（可在 .env 中填写）'
    }。${
      preferServer
        ? configured
          ? '当前优先使用服务端密钥。'
          : '服务端未配置，将自动回退到本地密钥。'
        : '当前优先使用本地密钥。'
    }`;
  }

  function connectionStatus() {
    const useServer = useServerKeyCheck.querySelector('input').checked;

    const hasLocal = Boolean(keyInput.value.trim() || app.runtime.apiKeys?.[currentProvider]);
    const hasServer = Boolean(app.runtime.health?.serverKeys?.[currentProvider]);
    if (settings.demoMode || demoToggle.querySelector('input').checked) {
      return { label: '演示模式', className: 'demo' };
    }
    if (!app.runtime.health?.ok) return { label: '服务离线', className: 'offline' };
    if ((useServer && hasServer) || hasLocal) {
      if (app.runtime.callState === 'error') return { label: '连接异常', className: 'offline' };
      return { label: '在线', className: 'online' };
    }
    if (hasServer) return { label: '在线', className: 'online' };
    return { label: '未配置', className: 'unconfigured' };
  }

  function updateConfigSummary() {
    if (!summaryProvider) return;
    const provider = currentProviderMeta();
    summaryProvider.textContent = provider.label;
    summaryModel.textContent = getModelValue() || '未选择模型';
    const status = connectionStatus();
    summaryStatus.replaceChildren(
      h('span', { class: `inline-status inline-status-${status.className}` }, status.label),
    );
    const hasServer = Boolean(app.runtime.health?.serverKeys?.[currentProvider]);
    const hasLocal = Boolean(keyInput.value.trim() || app.runtime.apiKeys?.[currentProvider]);
    const preferServer = useServerKeyCheck.querySelector('input').checked;
    if (settings.demoMode || demoToggle.querySelector('input').checked) {
      summaryKey.textContent = '演示模式 · 不调用';
    } else if (preferServer && hasServer) {
      summaryKey.textContent = '服务端环境变量';
    } else if (hasLocal) {
      summaryKey.textContent = '本地密钥';
    } else if (hasServer) {
      summaryKey.textContent = '服务端环境变量';
    } else {
      summaryKey.textContent = '未配置';
    }
    updateSettingsChip();
  }

  function updateSettingsChip() {
    const chip = page.querySelector('#settings-ai-chip');
    if (!chip) return;
    const status = connectionStatus();
    chip.className = `settings-status-chip status-${status.className}`;
    chip.replaceChildren(h('span', { class: 'status-dot' }), h('span', { text: status.label }));
  }

  /* ------------------------------ 测试 / 保存 ------------------------------ */

  async function testConnection() {
    const provider = currentProviderMeta();
    const model = getModelValue();
    if (!model) {
      toastError('请先选择或填写模型 ID。');
      modelCustomInput.focus();
      return;
    }
    const preferServer = useServerKeyCheck.querySelector('input').checked;
    const serverConfigured = Boolean(app.runtime.health?.serverKeys?.[currentProvider]);
    // 服务端优先且可用时测试服务端密钥；否则使用当前输入或本地保存的 Key。
    const useServerForTest = preferServer && serverConfigured;
    const checkSettings = {
      provider: currentProvider,
      model,
      baseUrl: baseUrlInput.value.trim(),
      useServerKey: useServerForTest,
      temperature: safeNumber(temperatureRange.value, 0.9),
      maxTokens: safeNumber(maxTokensRange.value, 800),
      demoMode: false,
    };
    testButton.disabled = true;
    testButton.classList.add('is-busy');
    testResult.hidden = false;
    testResult.className = 'connection-result is-testing';
    testResult.replaceChildren(h('span', { class: 'spinner small' }), h('span', { text: '正在连接…' }));
    try {
      const result = await checkConnection({
        settings: checkSettings,
        apiKey: useServerForTest
          ? ''
          : keyInput.value.trim() || app.runtime.apiKeys?.[currentProvider] || '',
      });
      testResult.className = `connection-result ${result.ok ? 'is-success' : 'is-error'}`;
      testResult.replaceChildren(
        icon(result.ok ? 'check' : 'warning'),
        h(
          'div',
          {},
          h('strong', { text: result.ok ? '连接成功' : '连接失败' }),
          h('p', { text: result.message || '' }),
          result.latency
            ? h('span', { class: 'muted small', text: `响应 ${result.latency}ms · 测试不会自动保存设置` })
            : h('span', { class: 'muted small', text: '测试不会自动保存设置' }),
          h('p', {
            class: 'muted small',
            text: '测试使用当前表单中的密钥；请点击「保存设置」，顶栏状态和后续对话才会使用这份配置。',
          }),
        ),
      );
      if (result.ok) {
        app.markAIStatus('online', result.message);
        store.info('connection.checked', `${provider.label} 连接测试成功。`, {
          detail: { latency: result.latency, status: result.status, model },
        });
      } else {
        app.markAIStatus('offline', result.message);
        store.warn('settings.test.failed', `${provider.label} 连接测试失败：${result.message}`, {
          detail: { status: result.status, code: result.code || '', model },
        });
      }
      renderHealth();
      updateConfigSummary();
    } finally {
      testButton.disabled = false;
      testButton.classList.remove('is-busy');
    }
  }

  async function saveSettings() {
    const provider = currentProviderMeta();
    const model = getModelValue();
    if (!model) {
      toastError('模型 ID 不能为空。');
      modelCustomInput.focus();
      return;
    }
    const baseUrl = baseUrlInput.value.trim();
    if (provider.id === 'custom' && !baseUrl) {
      toastError('自定义接口必须填写 API Base URL。');
      baseUrlInput.focus();
      return;
    }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      toastError('API Base URL 必须以 http:// 或 https:// 开头。');
      baseUrlInput.focus();
      return;
    }

    keyDrafts[currentProvider] = keyInput.value.trim();
    const remember = rememberKeyCheck.querySelector('input').checked;
    const useServer = useServerKeyCheck.querySelector('input').checked;
    const nextKeyVault = { ...store.state.settings.keyVault };
    const providersToPersist = new Set([
      ...Object.keys(keyDrafts),
      ...Object.keys(app.runtime.apiKeys || {}),
      ...Object.keys(store.state.settings.keyVault || {}),
    ]);

    try {
      for (const providerId of providersToPersist) {
        if (!PROVIDERS[providerId]) continue;
        const desired =
          keyDrafts[providerId] ??
          (app.runtime.apiKeys?.[providerId] || '');
        if (!desired) {
          delete nextKeyVault[providerId];
          await forgetKey(providerId);
          app.setProviderKey(providerId, '');
          continue;
        }
        const needsPersist =
          keyTouched.has(providerId) ||
          rememberChanged ||
          (remember && !nextKeyVault[providerId]) ||
          (!remember && nextKeyVault[providerId]);
        if (needsPersist) {
          const cipher = await persistKey(providerId, desired, remember);
          if (cipher) nextKeyVault[providerId] = cipher;
          else delete nextKeyVault[providerId];
          app.setProviderKey(providerId, desired);
        }
      }
    } catch (error) {
      throw new Error(`密钥保存失败：${error.message}`);
    }

    const nextSettings = {
      ...store.state.settings,
      provider: currentProvider,
      model,
      baseUrl,
      temperature: safeNumber(temperatureRange.value, 0.9),
      maxTokens: Math.round(safeNumber(maxTokensRange.value, 800)),
      stream: streamToggle.querySelector('input').checked,
      demoMode: demoToggle.querySelector('input').checked,
      useServerKey: useServer,
      rememberKeys: remember,
      contextChars: Math.round(safeNumber(contextRange.value, LIMITS.contextChars)),
      keyVault: nextKeyVault,
    };

    store.update(
      (state) => {
        state.settings = nextSettings;
      },
      { reason: 'settings-saved' },
    );
    store.info('settings.saved', '保存了模型与对话设置。', {
      detail: {
        provider: currentProvider,
        model,
        useServerKey: useServer,
        demoMode: nextSettings.demoMode,
        rememberedProviders: Object.keys(nextKeyVault),
      },
    });
    clearCompletionCache();
    app.markAIStatus('idle');
    app.refreshChrome();
    keyTouched.clear();
    rememberChanged = false;
    updateKeyStatus();
    updateConfigSummary();
    updateServerKeyHint();
    toastSuccess('设置已保存。', '已更新');
    testResult.hidden = true;
  }

  /* ------------------------------ 密钥事件 ------------------------------ */

  keyInput.addEventListener('input', () => {
    keyDrafts[currentProvider] = keyInput.value.trim();
    keyTouched.add(currentProvider);
    updateKeyStatus();
  });
  useServerKeyCheck.querySelector('input').addEventListener('change', () => {
    updateServerKeyHint();
    updateConfigSummary();
  });
  rememberKeyCheck.querySelector('input').addEventListener('change', () => {
    rememberChanged = true;
    updateConfigSummary();
  });
  demoToggle.querySelector('input').addEventListener('change', updateConfigSummary);

  /* ------------------------------ 侧栏信息 ------------------------------ */

  function renderHealth() {
    const block = page.querySelector('#health-block');
    if (!block) return;
    const health = app.runtime.health;
    block.replaceChildren(
      h(
        'div',
        { class: `health-line ${health?.ok ? 'is-online' : 'is-offline'}` },
        h('span', { class: 'health-dot' }),
        h('strong', { text: health?.ok ? '本地服务在线' : '本地服务离线' }),
      ),
      h(
        'p',
        {
          class: 'muted small',
          text: health
            ? `v${health.version || APP_VERSION} · Node ${health.node || '—'} · 已运行 ${formatUptime(
                health.uptimeSeconds,
              )}`
            : '请运行 node server.mjs 后重新检查。',
        },
      ),
      h(
        'div',
        { class: 'server-key-list' },
        ...Object.entries(PROVIDERS).map(([providerId, provider]) =>
          h(
            'div',
            { class: 'server-key-row' },
            h('span', { text: provider.label }),
            h('span', {
              class: `key-dot ${health?.serverKeys?.[providerId] ? 'is-on' : ''}`,
              title: health?.serverKeys?.[providerId] ? '已配置' : '未配置',
            }),
          ),
        ),
      ),
    );
  }

  switchProvider(currentProvider);
  baseUrlInput.value = settings.baseUrl || '';
  keyInput.value = keyDrafts[currentProvider] || '';
  updateKeyStatus();
  updateConfigSummary();
  updateServerKeyHint();
  renderHealth();

  return { cleanup() {} };
}

function demoSwitchRow(demoToggle) {
  return h(
    'div',
    { class: 'settings-highlight-row' },
    h(
      'div',
      { class: 'settings-highlight-icon' },
      icon('spark'),
    ),
    demoToggle,
  );
}

function budgetItem(label, percent, iconName) {
  return h(
    'div',
    { class: 'budget-item' },
    h('span', { class: 'budget-icon' }, icon(iconName)),
    h('strong', { text: label }),
    h('span', { text: percent }),
  );
}

function formatUptime(seconds) {
  const value = Math.max(0, Math.round(safeNumber(seconds)));
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.floor(value / 60)} 分钟`;
  return `${Math.floor(value / 3600)} 小时 ${Math.floor((value % 3600) / 60)} 分钟`;
}

/* ------------------------------------------------------------------ */
/* Token 账本                                                          */
/* ------------------------------------------------------------------ */

function renderTokenSection(app) {
  const stats = app.store.state.stats;
  const providers = Object.entries(stats.byProvider || {});
  const archives = [
    ...app.store.state.archives.map((archive) => ({
      ...archive,
      modeLabel: '恋爱对话',
      countLabel: `${archive.diaries.length} 篇日记`,
    })),
    ...app.store.state.sandboxSaves.map((save) => ({
      ...save,
      modeLabel: '沙盒世界',
      tokenStats: save.tokenStats || { totalTokens: 0 },
      countLabel: `第 ${save.turn} 回合`,
    })),
  ]
    .sort((a, b) => b.tokenStats.totalTokens - a.tokenStats.totalTokens)
    .slice(0, 8);

  const tokenSection = h(
    'section',
    { class: 'settings-card token-section', id: 'token-section' },
    h(
      'div',
      { class: 'settings-card-head' },
      h(
        'div',
        {},
        h('p', { class: 'eyebrow', text: 'Usage' }),
        h('h2', { text: 'Token 账本' }),
        h('p', {
          text: '真实 usage 优先；未返回 usage 时以字符估算兜底。演示模式不计入。',
        }),
      ),
      h(
        'span',
        { class: 'count-pill' },
        icon('info'),
        h('span', { text: `${formatNumber(stats.requests)} 次请求` }),
      ),
    ),
    h(
      'div',
      { class: 'stat-grid token-stat-grid' },
      simpleStat('总 tokens', formatNumber(stats.totalTokens), 'input + output'),
      simpleStat('输入', formatNumber(stats.promptTokens), '提示词'),
      simpleStat('输出', formatNumber(stats.completionTokens), '回复'),
      simpleStat('估算请求', formatNumber(stats.estimated), '未返回 usage'),
    ),
    h(
      'div',
      { class: 'token-columns' },
      h(
        'div',
        { class: 'token-breakdown' },
        h('h3', { text: '按提供商' }),
        providers.length
          ? h(
              'div',
              { class: 'mini-table' },
              ...providers.map(([providerId, value]) =>
                h(
                  'div',
                  { class: 'mini-table-row' },
                  h('span', { class: 'mini-table-name', text: PROVIDERS[providerId]?.label || providerId }),
                  h('span', { text: `${formatNumber(value.totalTokens)} tokens` }),
                  h('span', { class: 'mini-table-sub', text: `${formatNumber(value.requests)} 次` }),
                ),
              ),
            )
          : h('p', { class: 'muted small', text: '还没有调用记录。' }),
        stats.last
          ? h('p', {
              class: 'muted small',
              text: `最近一次：${formatNumber(stats.last.totalTokens)} tokens · ${formatDateTime(
                stats.last.at,
              )}`,
            })
          : null,
      ),
      h(
        'div',
        { class: 'token-breakdown' },
        h('h3', { text: '最耗 token 的存档' }),
        archives.length
          ? h(
              'div',
              { class: 'mini-table' },
              ...archives.map((archive) =>
                h(
                  'div',
                  { class: 'mini-table-row' },
                  h('span', { class: 'mini-table-name', text: `${archive.name} · ${archive.modeLabel}` }),
                  h('span', { text: `${formatNumber(archive.tokenStats.totalTokens)} tokens` }),
                  h('span', { class: 'mini-table-sub', text: archive.countLabel }),
                ),
              ),
            )
          : h('p', { class: 'muted small', text: '还没有存档。' }),
      ),
    ),
  );
  return tokenSection;
}

function simpleStat(label, value, hint) {
  return h(
    'div',
    { class: 'stat-card' },
    h('span', { class: 'stat-label', text: label }),
    h('strong', { class: 'stat-value', text: value }),
    h('span', { class: 'stat-hint', text: hint }),
  );
}

/* ------------------------------------------------------------------ */
/* 数据与隐私                                                          */
/* ------------------------------------------------------------------ */

function renderDataSection(app) {
  const store = app.store;
  const importInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'sr-only',
    id: 'backup-file-input',
  });
  const storageInfo = h('div', { class: 'storage-info' });

  async function importBackup(file) {
    if (!file) return;
    try {
      const raw = await readTextFile(file, 25 * 1024 * 1024);
      const payload = JSON.parse(raw);
      const importedState = payload?.state || payload;
      if (!importedState || !Array.isArray(importedState.archives)) {
        throw new Error('这不是可识别的暖屿备份文件。');
      }
      const ok = await confirmDialog({
        title: '导入备份并覆盖当前数据？',
        message: `备份包含 ${importedState.archives.length} 个恋爱存档、${
          Array.isArray(importedState.sandboxSaves) ? importedState.sandboxSaves.length : 0
        } 个沙盒存档。当前所有存档、人格、世界书、沙盒世界与日记都会被替换；本地 API Key 会保留。`,
        confirmText: '导入并覆盖',
        danger: true,
      });
      if (!ok) return;
      const next = normalizeState(importedState);
      next.settings.keyVault = { ...store.state.settings.keyVault };
      next.settings.rememberKeys = store.state.settings.rememberKeys;
      next.settings.useServerKey = store.state.settings.useServerKey;
      store.replaceState(next, { reason: 'data-imported' });
      store.info('data.imported', '导入了备份数据，原有存档已被替换。', {
        detail: {
          archives: importedState.archives.length,
          sandboxSaves: Array.isArray(importedState.sandboxSaves)
            ? importedState.sandboxSaves.length
            : 0,
        },
      });
      toastSuccess('备份已导入。');
      app.navigate('archives');
    } catch (error) {
      store.logError('data.import.failed', error);
      toastError(`导入备份失败：${error.message}`);
    }
  }

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    await importBackup(file);
    importInput.value = '';
  });

  const section = h(
    'section',
    { class: 'settings-card data-section' },
    h(
      'div',
      { class: 'settings-card-head' },
      h(
        'div',
        {},
        h('p', { class: 'eyebrow', text: 'Local first' }),
        h('h2', { text: '数据与隐私' }),
        h('p', {
          text: '恋爱存档、沙盒存档、世界书与日记都保存在浏览器 IndexedDB，并以 gzip 压缩备份到 LocalStorage。两种模式共用模型设置与运行日记，数据互不覆盖。API Key 单独加密。',
        }),
      ),
      h('span', { class: 'privacy-badge' }, icon('shield'), h('span', { text: '仅本机' })),
    ),
    storageInfo,
    h(
      'div',
      { class: 'data-actions' },
      h(
        'div',
        { class: 'data-action-card' },
        h('span', { class: 'data-action-icon' }, icon('download')),
        h(
          'div',
          {},
          h('strong', { text: '导出全部数据' }),
          h('p', { text: 'JSON 备份不包含 API Key。' }),
        ),
        h(
          'button',
          {
            class: 'btn btn-soft btn-sm',
            type: 'button',
            onclick: () => {
              const snapshot = clone(store.state);
              delete snapshot.settings.keyVault;
              downloadJson(`warm-isle-backup-${new Date().toISOString().slice(0, 10)}.json`, {
                kind: 'warm-isle.backup',
                appVersion: APP_VERSION,
                exportedAt: new Date().toISOString(),
                state: snapshot,
              });
              store.info('data.exported', '导出了全部数据备份（不含 API Key）。');
              toastSuccess('备份已导出。');
            },
          },
          h('span', { text: '导出' }),
        ),
      ),
      h(
        'div',
        { class: 'data-action-card' },
        h('span', { class: 'data-action-icon' }, icon('upload')),
        h(
          'div',
          {},
          h('strong', { text: '从备份恢复' }),
          h('p', { text: '将覆盖当前存档与设置，但保留本地密钥。' }),
        ),
        h(
          'button',
          { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => importInput.click() },
          h('span', { text: '选择文件' }),
        ),
        importInput,
      ),
      h(
        'div',
        { class: 'data-action-card is-danger' },
        h('span', { class: 'data-action-icon' }, icon('trash')),
        h(
          'div',
          {},
          h('strong', { text: '清空全部数据' }),
          h('p', { text: '删除所有恋爱存档、沙盒存档、人格、世界书、规则与日记，无法撤销。' }),
        ),
        h(
          'button',
          {
            class: 'btn btn-danger-ghost btn-sm',
            type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: '清空暖屿的全部数据？',
                message: '所有恋爱存档、沙盒存档、人格、世界书、规则、日记与设置都会被删除。API Key 也会从本机清除。这个操作无法撤销。',
                confirmText: '全部删除',
                danger: true,
              });
              if (!ok) return;
              writeSessionKeys({});
              app.runtime.apiKeys = {};
              const fresh = createInitialState();
              store.replaceState(fresh, { reason: 'data-reset' });
              store.info('data.reset', '清空了全部本地数据。');
              await store.flush();
              toast('正在重新加载空白工作区…', { type: 'info' });
              setTimeout(() => {
                window.location.hash = '#/archives';
                window.location.reload();
              }, 500);
            },
          },
          h('span', { text: '清空' }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'security-note' },
      icon('key'),
      h(
        'p',
        {},
        h('strong', { text: '关于 API Key 加密' }),
        h('span', {
          text: '记住密钥时使用 WebCrypto AES-GCM，主密钥以不可导出的 CryptoKey 保存在 IndexedDB。它无法抵御同源 XSS，因此项目不加载任何第三方脚本，并启用了严格 CSP。',
        }),
      ),
    ),
  );

  getStorageInfo()
    .then((info) => {
      storageInfo.replaceChildren(
        h(
          'div',
          { class: 'storage-grid' },
          storageItem('IndexedDB 主存储', info.indexedDb ? '可用' : '不可用', info.indexedDb),
          storageItem('gzip JSON 备份', info.compression ? '已启用' : '浏览器不支持', info.compression),
          storageItem('数据规模', formatBytes(store.getApproxSize()), true),
          storageItem(
            '对话 / 沙盒消息',
            `${formatNumber(
              store.state.archives.reduce((sum, archive) => sum + archive.messages.length, 0) +
                store.state.sandboxSaves.reduce((sum, save) => sum + save.messages.length, 0),
            )} 条`,
            true,
          ),
        ),
      );
    })
    .catch(() => {
      storageInfo.replaceChildren(
        h('p', { class: 'muted small', text: '无法读取本地存储状态。' }),
      );
    });

  return section;
}

function storageItem(label, value, good) {
  return h(
    'div',
    { class: `storage-item ${good ? 'is-good' : 'is-bad'}`.trim() },
    h('span', { class: 'storage-label', text: label }),
    h('strong', { class: 'storage-value', text: value }),
  );
}
