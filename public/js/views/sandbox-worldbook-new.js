/** 创建沙盒世界书：本地 JSON 生成器，支持历史年份、时代分期、事件与开场。 */

import {
  SANDBOX_CATEGORIES,
  getSandboxCategory,
} from '../core/constants.js';
import { createId, downloadJson } from '../core/utils.js';
import { normalizeSandboxWorldbook } from '../data/sandbox-schemas.js';
import {
  field,
  input,
  pageHeader,
  tag,
  textarea,
} from '../ui/components.js';
import { copyText, h, icon } from '../ui/dom.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const draftId = createId('sbworld');
  let saved = false;
  let previewJson = '';
  let currentCategory = 'xianxia';
  let rulesAutoValue = '';
  let rulesTouched = false;
  const periodEntries = [];
  const eventEntries = [];
  const scenarioEntries = [];
  const entryEntries = [];

  const categoryChoices = h('div', { class: 'sandbox-category-choice-grid' });
  const nameInput = input({ id: 'sbw-name', maxLength: 80, required: true, placeholder: '例如：九洲仙途 / 大唐 / 灰烬王冠' });
  const descriptionInput = textarea({ id: 'sbw-description', rows: 4, maxLength: 1200, placeholder: '这个世界的时代、制度、核心冲突与日常质感。' });
  const tagsInput = input({ id: 'sbw-tags', maxLength: 300, placeholder: '修仙、宗门、低魔（逗号分隔）' });
  const rulesInput = textarea({ id: 'sbw-rules', rows: 4, maxLength: 2000, placeholder: '这个类型世界的硬规则：力量上限、技术条件、社会制度、代价与禁忌。' });
  const currencyInput = input({ id: 'sbw-currency', maxLength: 20, value: '灵石' });
  const moneyInput = input({ id: 'sbw-money', type: 'number', min: 0, value: '18' });
  const locationInput = input({ id: 'sbw-location', maxLength: 100, value: '云海坊市' });
  const dateYearInput = input({ id: 'sbw-date-year', type: 'number', min: 1, max: 9999, value: '3271' });
  const dateMonthInput = input({ id: 'sbw-date-month', type: 'number', min: 1, max: 12, value: '8' });
  const dateDayInput = input({ id: 'sbw-date-day', type: 'number', min: 1, max: 31, value: '12' });
  const timeInput = input({ id: 'sbw-time', maxLength: 24, value: '午时' });
  const weatherInput = input({ id: 'sbw-weather', maxLength: 40, value: '多云' });

  const eraSection = h('section', { class: 'form-card sandbox-era-form' });
  const eraDynasty = input({ id: 'sbw-era-dynasty', maxLength: 40, placeholder: '唐 / 明 / 汉' });
  const eraLabel = input({ id: 'sbw-era-label', maxLength: 60, placeholder: '大唐 / 大明' });
  const eraStart = input({ id: 'sbw-era-start', type: 'number', min: 1, max: 9999, value: '618' });
  const eraEnd = input({ id: 'sbw-era-end', type: 'number', min: 1, max: 9999, value: '907' });
  const eraDefault = input({ id: 'sbw-era-default', type: 'number', min: 1, max: 9999, value: '742' });
  const periodsContainer = h('div', { class: 'entry-editor-list' });
  const eventsContainer = h('div', { class: 'entry-editor-list' });

  const scenariosContainer = h('div', { class: 'sandbox-scenario-editor-list' });
  const entriesContainer = h('div', { class: 'entry-editor-list' });
  const jsonPreview = h('pre', { class: 'json-preview', spellcheck: 'false' });
  const jsonStats = h('span', { class: 'muted small' });
  const liveTitle = h('h3', { class: 'worldbook-live-title', text: '未命名世界' });
  const liveDesc = h('p', { class: 'worldbook-live-desc', text: '填写名称与简介后，这里会出现世界轮廓。' });
  const liveMeta = h('div', { class: 'sandbox-live-meta' });

  const form = h(
    'form',
    {
      id: 'sandbox-worldbook-form',
      class: 'sandbox-worldbook-form',
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
        h('div', {}, h('h2', { text: '选择世界类型' }), h('p', { text: '类型决定属性名称、货币、判定风格和初始世界规则。' })),
      ),
      categoryChoices,
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '02' }),
        h('div', {}, h('h2', { text: '世界身份' }), h('p', { text: '名称、简介、类型规则与开局默认状态。' })),
      ),
      field({ label: '世界书名称', required: true, control: nameInput, htmlFor: 'sbw-name' }),
      field({ label: '世界简介', control: descriptionInput, htmlFor: 'sbw-description' }),
      field({ label: '标签', control: tagsInput, htmlFor: 'sbw-tags' }),
      field({ label: '类型硬规则', control: rulesInput, htmlFor: 'sbw-rules', hint: '会随每轮提示词发送，影响世界的真实感与力量上限。' }),
    ),
    eraSection,
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '03' }),
        h('div', {}, h('h2', { text: '开局默认状态' }), h('p', { text: '玩家没有选择开场时使用；历史世界会自动使用所选年份。' })),
      ),
      h(
        'div',
        { class: 'form-grid three' },
        field({ label: '货币单位', control: currencyInput, htmlFor: 'sbw-currency' }),
        field({ label: '初始货币', control: moneyInput, htmlFor: 'sbw-money' }),
        field({ label: '默认地点', control: locationInput, htmlFor: 'sbw-location' }),
      ),
      h(
        'div',
        { class: 'form-grid four' },
        field({ label: '默认年', control: dateYearInput, htmlFor: 'sbw-date-year' }),
        field({ label: '月', control: dateMonthInput, htmlFor: 'sbw-date-month' }),
        field({ label: '日', control: dateDayInput, htmlFor: 'sbw-date-day' }),
        field({ label: '时段', control: timeInput, htmlFor: 'sbw-time' }),
      ),
      field({ label: '天气', control: weatherInput, htmlFor: 'sbw-weather' }),
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '04' }),
        h('div', {}, h('h2', { text: '开场场景' }), h('p', { text: '玩家创建存档时可以选择这些开场；至少保留一个。' })),
        h(
          'button',
          { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => addScenario() },
          icon('plus'),
          h('span', { text: '添加开场' }),
        ),
      ),
      scenariosContainer,
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '05' }),
        h('div', {}, h('h2', { text: '世界书条目' }), h('p', { text: '地理、制度、势力、资源、禁忌；按关键词与优先级检索。' })),
        h(
          'button',
          { class: 'btn btn-soft btn-sm', type: 'button', onclick: () => addEntry() },
          icon('plus'),
          h('span', { text: '添加条目' }),
        ),
      ),
      entriesContainer,
    ),
    h(
      'div',
      { class: 'create-form-actions' },
      h('a', { class: 'btn btn-ghost', href: '#/sandbox/worldbooks' }, icon('arrowLeft'), h('span', { text: '返回' })),
      h(
        'button',
        { class: 'btn btn-primary btn-lg', type: 'submit', form: 'sandbox-worldbook-form' },
        icon('save'),
        h('span', { text: '保存沙盒世界书' }),
      ),
    ),
  );

  const previewAside = h(
    'aside',
    { class: 'create-preview sandbox-worldbook-preview' },
    h(
      'div',
      { class: 'preview-sticky' },
      h(
        'div',
        { class: 'preview-head' },
        h(
          'div',
          {},
          h('p', { class: 'eyebrow', text: 'World outline' }),
          h('h2', { class: 'preview-title', text: '世界轮廓' }),
        ),
        h('span', { class: 'local-only-badge' }, icon('shield'), h('span', { text: '本地生成 · 不调用 AI' })),
      ),
      h(
        'div',
        { class: 'worldbook-live-card sandbox-live-card' },
        h('span', { class: 'worldbook-live-emblem' }, icon('scroll')),
        liveTitle,
        liveDesc,
        liveMeta,
      ),
      h(
        'div',
        { class: 'json-panel' },
        h(
          'div',
          { class: 'json-panel-head' },
          h('strong', { text: '沙盒世界书 JSON' }),
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
                    downloadJson('sandbox-worldbook-draft.json', JSON.parse(previewJson));
                    app.store.info('sandbox.worldbook.draft.exported', '下载了沙盒世界书草稿。');
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
    { class: 'page page-sandbox-worldbook-create' },
    pageHeader({
      eyebrow: 'Sandbox world builder',
      title: '创建沙盒世界书',
      lede: '设定世界的时代、制度、年份、开场与可探索的常识。此页面只生成本地 JSON。',
      actions: [h('span', { class: 'local-only-badge page-badge' }, icon('shield'), h('span', { text: '不消耗 token' }))],
    }),
    h('div', { class: 'create-layout sandbox-create-layout' }, form, previewAside),
  );

  root.appendChild(page);

  function buildCategoryChoices() {
    categoryChoices.replaceChildren(
      ...SANDBOX_CATEGORIES.map((category) =>
        h(
          'label',
          {
            class: `sandbox-category-choice ${currentCategory === category.id ? 'is-selected' : ''}`.trim(),
            style: { '--sandbox-accent': category.accent },
          },
          h('input', {
            type: 'radio',
            name: 'sb-category',
            value: category.id,
            checked: currentCategory === category.id,
            onchange: () => {
              currentCategory = category.id;
              applyCategoryDefaults();
              buildCategoryChoices();
              updatePreview();
            },
          }),
          h('span', { class: 'sandbox-category-icon' }, icon(category.icon)),
          h(
            'span',
            {},
            h('strong', { text: category.label }),
            h('small', { text: category.description }),
          ),
          h('span', { class: 'choice-check' }, icon('check')),
        ),
      ),
    );
  }

  function applyCategoryDefaults() {
    const category = getSandboxCategory(currentCategory);
    if (!currencyInput.value.trim() || ['灵石', '两银', '银币', '贯', '五铢钱'].includes(currencyInput.value.trim())) {
      currencyInput.value = category.currency;
    }
    const isHistorical = category.id === 'historical';
    eraSection.hidden = !isHistorical;
    if (isHistorical) {
      eraDynasty.value ||= '唐';
      eraLabel.value ||= '大唐';
      dateYearInput.value = eraDefault.value || '742';
    }
    if (!rulesTouched || !rulesInput.value.trim() || rulesInput.value === rulesAutoValue) {
      rulesInput.value = category.prompt;
      rulesAutoValue = category.prompt;
      rulesTouched = false;
    }
    buildEraSection();
  }

  function buildEraSection() {
    if (currentCategory !== 'historical') {
      eraSection.hidden = true;
      return;
    }
    eraSection.hidden = false;
    const periods = periodEntries;
    const events = eventEntries;
    eraSection.replaceChildren(
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number step-word', text: '历史' }),
        h(
          'div',
          {},
          h('h2', { text: '真实历史年份' }),
          h('p', {
            text: '创建存档时可以选择起止年份内的任意一年；只注入当前年份及以前的历史背景。',
          }),
        ),
      ),
      h(
        'div',
        { class: 'form-grid three' },
        field({ label: '朝代', control: eraDynasty, htmlFor: 'sbw-era-dynasty' }),
        field({ label: '纪年名称', control: eraLabel, htmlFor: 'sbw-era-label' }),
        field({ label: '推荐开局年', control: eraDefault, htmlFor: 'sbw-era-default' }),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({ label: '起始年（公元）', control: eraStart, htmlFor: 'sbw-era-start' }),
        field({ label: '结束年（公元）', control: eraEnd, htmlFor: 'sbw-era-end' }),
      ),
      h(
        'div',
        { class: 'form-section' },
        h(
          'div',
          { class: 'form-section-head' },
          h('h3', { class: 'form-section-title', text: '时代分期' }),
          h(
            'button',
            { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addPeriod() },
            icon('plus'),
            h('span', { text: '添加分期' }),
          ),
        ),
        periodsContainer,
      ),
      h(
        'div',
        { class: 'form-section' },
        h(
          'div',
          { class: 'form-section-head' },
          h('h3', { class: 'form-section-title', text: '年份史事' }),
          h(
            'button',
            { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addEvent() },
            icon('plus'),
            h('span', { text: '添加史事' }),
          ),
        ),
        eventsContainer,
      ),
    );
    if (!periods.length) addPeriod();
    if (!events.length) addEvent();
    periodsContainer.replaceChildren(...periods.map((item) => item.card));
    eventsContainer.replaceChildren(...events.map((item) => item.card));
  }

  function addPeriod(initial = {}) {
    const record = { id: createId('period') };
    const nameInputEl = input({ value: initial.name || '', placeholder: '贞观 / 开元 / 天宝', maxLength: 60, 'aria-label': '分期名称' });
    const startInput = input({ type: 'number', min: 1, max: 9999, value: initial.startYear || eraStart.value || 618, 'aria-label': '分期起始年' });
    const endInput = input({ type: 'number', min: 1, max: 9999, value: initial.endYear || eraEnd.value || 907, 'aria-label': '分期结束年' });
    const summaryInput = input({ value: initial.summary || '', placeholder: '这一阶段的时代特征', maxLength: 500, 'aria-label': '分期摘要' });
    const card = h(
      'div',
      { class: 'sandbox-timeline-row' },
      nameInputEl,
      startInput,
      endInput,
      summaryInput,
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          'aria-label': '删除分期',
          onclick: () => {
            const index = periodEntries.findIndex((item) => item.id === record.id);
            if (index >= 0) periodEntries.splice(index, 1);
            card.remove();
            updatePreview();
          },
        },
        icon('x'),
      ),
    );
    record.card = card;
    record.values = () => ({
      name: nameInputEl.value.trim(),
      startYear: Number(startInput.value),
      endYear: Number(endInput.value),
      summary: summaryInput.value.trim(),
    });
    for (const element of [nameInputEl, startInput, endInput, summaryInput]) {
      element.addEventListener('input', scheduleUpdate);
    }
    periodEntries.push(record);
    periodsContainer.appendChild(card);
    scheduleUpdate();
  }

  function addEvent(initial = {}) {
    const record = { id: createId('event') };
    const yearInput = input({ type: 'number', min: 1, max: 9999, value: initial.year || eraDefault.value || 742, 'aria-label': '史事年份' });
    const titleInput = input({ value: initial.title || '', placeholder: '事件名称', maxLength: 100, 'aria-label': '史事名称' });
    const contentInput = input({ value: initial.content || '', placeholder: '真实史事摘要', maxLength: 600, 'aria-label': '史事内容' });
    const card = h(
      'div',
      { class: 'sandbox-timeline-row' },
      yearInput,
      titleInput,
      contentInput,
      h(
        'button',
        {
          class: 'icon-btn subtle',
          type: 'button',
          'aria-label': '删除史事',
          onclick: () => {
            const index = eventEntries.findIndex((item) => item.id === record.id);
            if (index >= 0) eventEntries.splice(index, 1);
            card.remove();
            updatePreview();
          },
        },
        icon('x'),
      ),
    );
    record.card = card;
    record.values = () => ({
      year: Number(yearInput.value),
      title: titleInput.value.trim(),
      content: contentInput.value.trim(),
    });
    for (const element of [yearInput, titleInput, contentInput]) {
      element.addEventListener('input', scheduleUpdate);
    }
    eventEntries.push(record);
    eventsContainer.appendChild(card);
    scheduleUpdate();
  }

  function addScenario(initial = {}) {
    const record = { id: initial.id || createId('scenario') };
    const titleInput = input({ value: initial.title || '', placeholder: '开场标题', maxLength: 100, 'aria-label': '开场标题' });
    const descInput = input({ value: initial.description || '', placeholder: '一句话描述玩家处境', maxLength: 600, 'aria-label': '开场描述' });
    const locationInputEl = input({ value: initial.location || '', placeholder: '长安·西市', maxLength: 100, 'aria-label': '开场地点' });
    const realmInput = input({ value: initial.realm || '凡人', placeholder: '凡人 / 炼气五层 / 佣兵', maxLength: 60, 'aria-label': '初始位阶' });
    const titleLabelInput = input({ value: initial.titleLabel || '初入此世', placeholder: '初始身份名号', maxLength: 80, 'aria-label': '初始身份' });
    const openingInput = textarea({ value: initial.opening || '', rows: 4, maxLength: 3000, placeholder: '玩家进入世界时看到的第一段叙事，可用 {player} 占位。', 'aria-label': '开场叙事' });
    const choicesInput = textarea({ value: (initial.choices || []).join('\n'), rows: 3, maxLength: 600, placeholder: '每行一个初始行动选项', 'aria-label': '开场选项' });
    const inventoryInput = textarea({ value: (initial.inventory || []).map((item) => `${item.name}|${item.qty}|${item.note || ''}`).join('\n'), rows: 2, maxLength: 800, placeholder: '每行：物品名|数量|说明', 'aria-label': '初始物品' });
    const moneyInputEl = input({ type: 'number', min: 0, value: initial.money ?? '', placeholder: '留空使用世界默认', 'aria-label': '开场初始货币' });
    const card = h(
      'article',
      { class: 'sandbox-scenario-editor' },
      h(
        'div',
        { class: 'sandbox-scenario-editor-head' },
        h('span', { class: 'entry-order', text: String(scenarioEntries.length + 1).padStart(2, '0') }),
        h('strong', { text: '开场场景' }),
        h(
          'button',
          { class: 'icon-btn subtle danger-hover', type: 'button', 'aria-label': '删除开场', onclick: () => {
            const index = scenarioEntries.findIndex((item) => item.id === record.id);
            if (index >= 0) scenarioEntries.splice(index, 1);
            card.remove();
            refreshScenarioIndices();
            updatePreview();
          } },
          icon('trash'),
        ),
      ),
      h('div', { class: 'form-grid two' }, field({ label: '标题', control: titleInput }), field({ label: '地点', control: locationInputEl })),
      field({ label: '描述', control: descInput }),
      h('div', { class: 'form-grid three' }, field({ label: '初始位阶', control: realmInput }), field({ label: '初始名号', control: titleLabelInput }), field({ label: '初始货币', control: moneyInputEl })),
      field({ label: '开场叙事', control: openingInput }),
      h('div', { class: 'form-grid two' }, field({ label: '初始选项', control: choicesInput, hint: '每行一个，3–5 个为宜。' }), field({ label: '初始物品', control: inventoryInput, hint: '每行：名称|数量|说明。' })),
    );
    record.card = card;
    record.indexLabel = card.querySelector('.entry-order');
    record.values = () => ({
      id: record.id,
      title: titleInput.value.trim(),
      description: descInput.value.trim(),
      location: locationInputEl.value.trim(),
      realm: realmInput.value.trim(),
      titleLabel: titleLabelInput.value.trim(),
      opening: openingInput.value.trim(),
      choices: choicesInput.value.split(/\n/).map((line) => line.trim()).filter(Boolean),
      inventory: inventoryInput.value.split(/\n/).map((line) => {
        const [name, qty, note] = line.split('|').map((part) => part.trim());
        return name ? { name, qty: Math.max(1, Number(qty) || 1), note: note || '' } : null;
      }).filter(Boolean),
      money: moneyInputEl.value === '' ? null : Number(moneyInputEl.value),
    });
    for (const element of [titleInput, descInput, locationInputEl, realmInput, titleLabelInput, openingInput, choicesInput, inventoryInput, moneyInputEl]) {
      element.addEventListener('input', scheduleUpdate);
    }
    scenarioEntries.push(record);
    scenariosContainer.appendChild(card);
    refreshScenarioIndices();
    scheduleUpdate();
  }

  function refreshScenarioIndices() {
    scenarioEntries.forEach((record, index) => {
      record.indexLabel.textContent = String(index + 1).padStart(2, '0');
    });
  }

  function addEntry(initial = {}) {
    const record = { id: initial.id || createId('sbentry') };
    const titleInput = input({ value: initial.title || '', placeholder: '条目名称', maxLength: 80, 'aria-label': '条目名称' });
    const keywordsInput = input({ value: (initial.keywords || []).join('、'), placeholder: '关键词，用顿号分隔', maxLength: 300, 'aria-label': '条目关键词' });
    const contentInput = textarea({ value: initial.content || '', rows: 3, maxLength: 3000, placeholder: '具体、可用的世界事实。', 'aria-label': '条目内容' });
    const pinnedInput = h('input', { type: 'checkbox', checked: Boolean(initial.pinned), onchange: scheduleUpdate });
    const priorityInput = input({ type: 'number', min: 0, max: 100, value: initial.priority ?? 70, class: 'priority-input', 'aria-label': '条目优先级' });
    const card = h(
      'article',
      { class: 'entry-editor-card' },
      h(
        'div',
        { class: 'entry-editor-head' },
        h('span', { class: 'entry-order' }),
        titleInput,
        h(
          'div',
          { class: 'entry-editor-controls' },
          h('label', { class: 'mini-check' }, pinnedInput, h('span', { text: '常驻' })),
          priorityInput,
          h(
            'button',
            {
              class: 'icon-btn subtle danger-hover',
              type: 'button',
              'aria-label': '删除条目',
              onclick: () => {
                const index = entryEntries.findIndex((item) => item.id === record.id);
                if (index >= 0) entryEntries.splice(index, 1);
                card.remove();
                refreshEntryIndices();
                updatePreview();
              },
            },
            icon('trash'),
          ),
        ),
      ),
      h('div', { class: 'entry-editor-body' }, keywordsInput, contentInput),
    );
    record.card = card;
    record.indexLabel = card.querySelector('.entry-order');
    record.values = () => ({
      id: record.id,
      title: titleInput.value.trim(),
      keywords: keywordsInput.value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      content: contentInput.value.trim(),
      pinned: pinnedInput.checked,
      priority: Number(priorityInput.value) || 0,
    });
    for (const element of [titleInput, keywordsInput, contentInput, priorityInput]) element.addEventListener('input', scheduleUpdate);
    entryEntries.push(record);
    entriesContainer.appendChild(card);
    refreshEntryIndices();
    scheduleUpdate();
  }

  function refreshEntryIndices() {
    entryEntries.forEach((record, index) => {
      record.indexLabel.textContent = String(index + 1).padStart(2, '0');
    });
  }

  function buildDraft() {
    const era =
      currentCategory === 'historical'
        ? {
            enabled: true,
            dynasty: eraDynasty.value.trim() || '古朝',
            label: eraLabel.value.trim() || eraDynasty.value.trim() || '古朝',
            startYear: Number(eraStart.value) || 1,
            endYear: Number(eraEnd.value) || 1,
            defaultYear: Number(eraDefault.value) || Number(eraStart.value) || 1,
            calendar: '公元',
            periods: periodEntries.map((item) => item.values()).filter((item) => item.name),
            events: eventEntries.map((item) => item.values()).filter((item) => item.title),
          }
        : null;
    return {
      schemaVersion: 1,
      kind: 'warm-isle.sandbox-worldbook',
      id: draftId,
      name: nameInput.value.trim(),
      category: currentCategory,
      description: descriptionInput.value.trim(),
      tags: tagsInput.value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      builtin: false,
      createdAt: new Date().toISOString(),
      era,
      defaults: {
        currency: currencyInput.value.trim() || getSandboxCategory(currentCategory).currency,
        startingMoney: Number(moneyInput.value) || 0,
        location: locationInput.value.trim() || '未知之地',
        date: {
          year: Number(dateYearInput.value) || era?.defaultYear || 1,
          month: Number(dateMonthInput.value) || 1,
          day: Number(dateDayInput.value) || 1,
        },
        time: timeInput.value.trim() || '清晨',
        weather: weatherInput.value.trim() || '晴',
      },
      genreRules: rulesInput.value.trim(),
      entries: entryEntries.map((item) => item.values()).filter((item) => item.content),
      scenarios: scenarioEntries.map((item) => item.values()).filter((item) => item.title && item.opening),
    };
  }

  function safePreview() {
    const draft = buildDraft();
    return {
      ...draft,
      name: draft.name || '未命名世界',
      description: draft.description || '还没有简介。',
    };
  }

  function updatePreview() {
    const draft = safePreview();
    const category = getSandboxCategory(draft.category);
    liveTitle.textContent = draft.name;
    liveDesc.textContent = draft.description;
    liveMeta.replaceChildren(
      ...[
        tag(category.shortLabel, 'warm'),
        draft.era?.enabled
          ? tag(`${draft.era.startYear}–${draft.era.endYear} 年`, 'sage')
          : null,
        tag(`${draft.entries.length} 个条目`, 'neutral'),
        tag(`${draft.scenarios.length} 个开场`, 'neutral'),
      ].filter(Boolean),
    );
    try {
      const normalized = normalizeSandboxWorldbook(draft, { id: draftId, builtin: false });
      previewJson = JSON.stringify(normalized, null, 2);
    } catch (error) {
      previewJson = JSON.stringify({ error: error.message, hint: '填写名称后即可生成完整 JSON。' }, null, 2);
    }
    jsonPreview.textContent = previewJson;
    jsonStats.textContent = `${previewJson.length} 字符`;
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

  for (const element of [nameInput, descriptionInput, tagsInput, rulesInput, currencyInput, moneyInput, locationInput, dateYearInput, dateMonthInput, dateDayInput, timeInput, weatherInput, eraDynasty, eraLabel, eraStart, eraEnd, eraDefault]) {
    element.addEventListener('input', scheduleUpdate);
  }
  rulesInput.addEventListener('input', () => {
    rulesTouched = true;
  });
  eraDefault.addEventListener('input', () => {
    if (currentCategory === 'historical') {
      dateYearInput.value = eraDefault.value;
      scheduleUpdate();
    }
  });

  function saveWorldbook() {
    if (saved) return;
    if (!nameInput.value.trim()) {
      nameInput.focus();
      toastError('请先填写世界书名称。');
      return;
    }
    const draft = buildDraft();
    if (!draft.entries.length) {
      toastError('至少需要一个有内容的世界书条目。');
      return;
    }
    if (!draft.scenarios.length) {
      toastError('至少需要一个可用的开场场景。');
      return;
    }
    if (draft.category === 'historical') {
      if (draft.era.startYear > draft.era.endYear) {
        toastError('历史起始年不能晚于结束年。');
        return;
      }
      if (draft.era.defaultYear < draft.era.startYear || draft.era.defaultYear > draft.era.endYear) {
        toastError('推荐开局年必须落在起止年份之间。');
        return;
      }
    }
    try {
      const worldbook = normalizeSandboxWorldbook(draft, { id: draftId, builtin: false });
      const duplicate = app.store.state.sandboxWorldbooks.find(
        (item) => item.name.toLowerCase() === worldbook.name.toLowerCase(),
      );
      if (duplicate) worldbook.name = `${worldbook.name}（${app.store.state.sandboxWorldbooks.length + 1}）`;
      app.store.update(
        (state) => {
          state.sandboxWorldbooks.push(worldbook);
        },
        { reason: 'sandbox-worldbook-created' },
      );
      app.store.info(
        'sandbox.worldbook.created',
        `创建了沙盒世界书「${worldbook.name}」。`,
        { detail: { category: worldbook.category, era: worldbook.era?.dynasty || null } },
      );
      toastSuccess(`「${worldbook.name}」已经可以开始沙盒游戏。`, '沙盒世界书已保存');
      saved = true;
      app.navigate('sandbox/worldbooks');
    } catch (error) {
      app.store.logError('sandbox.worldbook.create.failed', error);
      toastError(`保存失败：${error.message}`);
    }
  }

  buildCategoryChoices();
  applyCategoryDefaults();
  addScenario({
    title: '新的开始',
    description: '你站在这个世界的入口，周围的一切都还来得及改变。',
    location: '未知之地',
    opening: '{player}睁开眼睛，发现自己正站在一片陌生的地方。风里有不属于故乡的气味。',
    choices: ['观察四周', '寻找道路', '检查随身物品'],
    realm: '凡人',
    titleLabel: '初入此世',
    inventory: [{ name: '旧行囊', qty: 1, note: '几件换洗衣物' }],
    money: null,
  });
  addEntry({ title: '世界概览', keywords: ['世界', '时代', '规则'], content: '', pinned: true, priority: 90 });
  scheduleUpdate();

  return { cleanup() {} };
}


