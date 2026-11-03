/** 创建沙盒存档：世界类型 → 世界书/年份 → 开场 → 角色与规则。 */

import {
  SANDBOX_CATEGORIES,
  SANDBOX_DIFFICULTIES,
  SANDBOX_HISTORICAL_TEMPLATES,
  SANDBOX_LIMITS,
  SANDBOX_TOTAL_POINT_MAX,
  getHistoricalOverallLabel,
  getHistoricalTemplate,
  getSandboxAbilities,
  getSandboxAbilityKeys,
  getSandboxCategory,
  getSandboxDifficulty,
} from '../core/constants.js';
import { createAgingState, describeAging } from '../core/sandbox-aging.js';
import {
  createDefaultAttributes,
  createSandboxSave,
  attributeTotal,
  formatHistoricalYear,
  formatHistoricalYearRange,
  formatHistoricalYearShort,
  getSuggestedYears,
  isSandboxScenarioAvailable,
  resolveHistoricalEra,
} from '../data/sandbox-schemas.js';
import {
  buildOpeningValidationPrompt,
  parseOpeningVerdict,
} from '../core/sandbox-validate.js';
import {
  buildHistoricalOpeningPrompt,
  parseHistoricalOpening,
} from '../core/sandbox-opening.js';
import {
  detectPlayerAgency,
  stripPlayerAgency,
} from '../core/sandbox-agency.js?v=2';
import {
  clone,
  createId,
  normalizeUsage,
  truncateText,
} from '../core/utils.js';
import { completeChat } from '../services/ai.js';
import {
  field,
  input,
  pageHeader,
  textarea,
} from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { toast, toastError } from '../ui/toast.js';

const CUSTOM_SCENARIO_ID = '__custom_opening__';

export async function render(root, app) {
  const state = app.store.state;
  const query = app.runtime.query || new URLSearchParams();
  const queryBook = app.store.getSandboxWorldbook(query.get('worldbook'));
  let categoryId =
    queryBook?.category ||
    (SANDBOX_CATEGORIES.some((category) => category.id === query.get('category'))
      ? query.get('category')
      : 'xianxia');
  let worldbook =
    queryBook ||
    state.sandboxWorldbooks.find((book) => book.category === categoryId) ||
    state.sandboxWorldbooks[0];
  let year = worldbook?.era?.enabled ? worldbook.era.defaultYear : worldbook?.defaults?.date?.year || 1;
  let scenarioId = worldbook?.scenarios?.[0]?.id || CUSTOM_SCENARIO_ID;
  let difficultyId = 'normal';
  let templateId = 'commoner';
  let fixedFigure = null;
  let createPending = false;
  let customVerdict = null;
  const customScenarioId = createId('sbscenario');

  const categoryGrid = h('div', { class: 'sandbox-category-choice-grid' });
  const bookSelect = h('select', { class: 'input select', 'aria-label': '选择沙盒世界书' });
  const bookDetail = h('div', { class: 'sandbox-book-detail' });
  const yearPanel = h('div', { class: 'sandbox-year-panel' });
  const scenarioGrid = h('div', { class: 'sandbox-scenario-choice-grid' });
  const attributesGrid = h('div', { class: 'sandbox-attribute-grid' });
  const attributeBudget = h('span', { class: 'sandbox-attribute-budget' });
  const scenarioSummary = h('div', { class: 'sandbox-preview-scenario' });
  const previewCard = h('div', { class: 'sandbox-create-preview-card' });
  const summaryTitle = h('h3', { class: 'sandbox-preview-title', text: '尚未命名' });
  const summaryMeta = h('p', { class: 'sandbox-preview-meta', text: '' });
  const summaryDesc = h('p', { class: 'sandbox-preview-desc', text: '' });

  const customTitleInput = input({
    id: 'sb-custom-title',
    maxLength: 100,
    placeholder: '自定义开场标题',
  });
  const customLocationInput = input({
    id: 'sb-custom-location',
    maxLength: 100,
    placeholder: '开场地点，默认使用世界书的初始地点',
  });
  const customOpeningInput = textarea({
    id: 'sb-custom-opening',
    rows: 6,
    maxLength: 3_000,
    placeholder:
      '写下你进入这个世界时的第一段情境。可用 {player} 代表角色名；AI 只判断是否可行，不会改写这段文字。',
  });
  const customChoicesInput = textarea({
    id: 'sb-custom-choices',
    rows: 3,
    maxLength: 600,
    placeholder: '每行一个初始行动选项，至少 1 个。例如：先观察四周',
  });
  const customInventoryInput = textarea({
    id: 'sb-custom-inventory',
    rows: 2,
    maxLength: 800,
    placeholder: '可选。每行：物品名|数量|说明',
  });
  const customTitleLabelInput = input({
    id: 'sb-custom-title-label',
    maxLength: 80,
    placeholder: '初始名号，例如：西市通译 / 外门弟子（可选）',
  });

  const createButton = h(
    'button',
    {
      class: 'btn btn-primary btn-lg',
      type: 'submit',
      form: 'sandbox-create-form',
    },
    icon('compass'),
    h('span', { text: '进入这个世界' }),
  );
  const createButtonLabel = createButton.querySelector('span');
  const customVerdictBox = h('div', {
    class: 'sandbox-opening-verdict',
    hidden: true,
  });
  const customPanel = h(
    'div',
    { class: 'sandbox-custom-opening', hidden: true },
    h(
      'div',
      { class: 'sandbox-custom-opening-head' },
      h('span', { class: 'sandbox-custom-icon' }, icon('edit')),
      h(
        'div',
        {},
        h('strong', { text: '自定义开场' }),
        h('p', {
          text: '只写这一次历险的起点。历史类世界会在创建前调用 AI 只判断可行性；修仙与西方玄幻不调用 AI，直接创建。',
        }),
      ),
    ),
    h(
      'div',
      { class: 'form-grid two' },
      field({
        label: '开场标题',
        control: customTitleInput,
        htmlFor: 'sb-custom-title',
        hint: '可留空，默认「自定义开场」。',
      }),
      field({
        label: '开场地点',
        control: customLocationInput,
        htmlFor: 'sb-custom-location',
        hint: '留空则使用世界书默认地点。',
      }),
    ),
    field({
      label: '开场叙事',
      control: customOpeningInput,
      htmlFor: 'sb-custom-opening',
      hint: '至少 20 字；可用 {player} 代表角色名。',
    }),
    h(
      'div',
      { class: 'form-grid two' },
      field({
        label: '初始行动选项',
        control: customChoicesInput,
        htmlFor: 'sb-custom-choices',
        hint: '每行一个，至少 1 个。',
      }),
      field({
        label: '初始物品',
        control: customInventoryInput,
        htmlFor: 'sb-custom-inventory',
        hint: '可选；每行：名称|数量|说明。',
      }),
    ),
    field({
      label: '初始名号',
      control: customTitleLabelInput,
      htmlFor: 'sb-custom-title-label',
      hint: '可选；留空使用角色初始身份。',
    }),
    h(
      'div',
      { class: 'sandbox-opening-review-note' },
      icon('shield'),
      h('span', {
        text: '仅历史类会触发 AI 审查。审查范围仅限：是否与当前世界、年份、地点和角色相容，是否具备可行动的起点；AI 不会修改你的文字。',
      }),
    ),
    customVerdictBox,
  );

  const templateSelect = h(
    'select',
    { class: 'input select', id: 'sb-template', 'aria-label': '选择人物模板' },
    ...SANDBOX_HISTORICAL_TEMPLATES.map((template) =>
      h('option', {
        value: template.id,
        text: `${template.label} · ${template.description}`,
        selected: template.id === templateId,
      }),
    ),
  );
  const templateHelp = h('p', { class: 'sandbox-template-help' });
  const pointHint = h(
    'div',
    { class: 'sandbox-point-hint' },
    icon('info'),
    h(
      'span',
      {},
      h('strong', { text: '点数提示：' }),
      h('span', {
        text: '普通常人单项基准 9；普通 8～10，优秀 11～13，顶尖 14～18，弱小 3～7。',
      }),
    ),
  );
  const fixedBanner = h('div', { class: 'sandbox-fixed-banner', hidden: true });
  const templatePanel = h(
    'div',
    { class: 'sandbox-template-panel' },
    h(
      'div',
      { class: 'sandbox-difficulty-row' },
      h('span', { class: 'field-label', text: '人物模板' }),
      templateSelect,
    ),
    templateHelp,
    pointHint,
    fixedBanner,
  );

  const nameInput = input({ id: 'sb-name', maxLength: 40, required: true, value: '', placeholder: '角色姓名' });
  const genderSelect = h(
    'select',
    { class: 'input select', id: 'sb-gender' },
    h('option', { value: '未设定', text: '未设定' }),
    h('option', { value: '男', text: '男' }),
    h('option', { value: '女', text: '女' }),
    h('option', { value: '其他', text: '其他' }),
  );
  const ageInput = input({ id: 'sb-age', type: 'number', min: 6, max: 120, value: '20' });
  const originInput = input({ id: 'sb-origin', maxLength: 160, placeholder: '例如：寒门庶子 / 边镇孤儿 / 白港流民' });
  const identityInput = input({ id: 'sb-identity', maxLength: 160, placeholder: '进入世界时的身份' });
  const saveNameInput = input({ id: 'sb-save-name', maxLength: 80, placeholder: '不填则使用「角色名·世界名」' });
  const appearanceInput = textarea({ id: 'sb-appearance', rows: 2, maxLength: 500, placeholder: '外貌、衣着、值得被世界记住的细节' });
  const backgroundInput = textarea({ id: 'sb-background', rows: 4, maxLength: 1200, placeholder: '出身、经历、技能、债务、牵挂或秘密。世界会记住这些。' });
  const traitsInput = input({ id: 'sb-traits', maxLength: 200, placeholder: '寡言、记仇、擅长骑射（逗号分隔）' });

  const checksToggle = h('input', { type: 'checkbox', checked: true, id: 'sb-checks' });
  const difficultySelect = h(
    'select',
    { class: 'input select', id: 'sb-difficulty' },
    ...SANDBOX_DIFFICULTIES.map((difficulty) =>
      h('option', {
        value: difficulty.id,
        text: `${difficulty.label} · ${difficulty.hint}`,
        selected: difficulty.id === difficultyId,
      }),
    ),
  );
  const attributeInputs = new Map();
  let currentAttributes = createDefaultAttributes(
    getSandboxDifficulty(difficultyId).budget,
    getSandboxAbilityKeys(categoryId, templateId),
  );

  function currentCategory() {
    return getSandboxCategory(categoryId);
  }

  function currentAbilities() {
    return getSandboxAbilities(categoryId, templateId);
  }

  function currentTemplate() {
    return getHistoricalTemplate(templateId);
  }

  function currentAbilityKeys() {
    return currentAbilities().map((ability) => ability.key);
  }

  function resetAttributesForTemplate() {
    currentAttributes = createDefaultAttributes(currentBudget(), currentAbilityKeys());
    renderAttributes();
  }

  function updateTemplateUi() {
    const isHistorical = categoryId === 'historical';
    templatePanel.hidden = !isHistorical;
    if (!isHistorical) {
      fixedBanner.hidden = true;
      return;
    }
    const template = currentTemplate();
    templateHelp.textContent = `${template.description} 六项：${template.abilities
      .map((ability) => ability.label)
      .join('、')}。`;
    if (fixedFigure) {
      fixedBanner.hidden = false;
      fixedBanner.replaceChildren(
        h('strong', { text: `固定历史人物：${fixedFigure.name}` }),
        h('span', {
          text: `${fixedFigure.title || '历史人物'} · 只能分配点数，不能创建虚拟角色。`,
        }),
      );
    } else {
      fixedBanner.hidden = true;
      fixedBanner.replaceChildren();
    }
  }

  function setLockedFields(locked) {
    for (const element of [
      nameInput,
      genderSelect,
      ageInput,
      originInput,
      identityInput,
      appearanceInput,
      backgroundInput,
      traitsInput,
    ]) {
      element.disabled = locked;
      element.classList.toggle('is-locked', locked);
    }
    templateSelect.disabled = locked;
  }

  function applyScenarioMode(scenario) {
    const nextFixed = scenario?.fixedFigure || null;
    if (nextFixed) {
      const changed = fixedFigure?.name !== nextFixed.name;
      fixedFigure = nextFixed;
      templateId = nextFixed.template || 'civil';
      templateSelect.value = templateId;
      nameInput.value = nextFixed.name || '';
      genderSelect.value = nextFixed.gender || '未设定';
      ageInput.value = nextFixed.age || '30';
      originInput.value = '历史人物';
      identityInput.value = nextFixed.title || '';
      appearanceInput.value = '';
      backgroundInput.value = nextFixed.description || '';
      traitsInput.value = '';
      setLockedFields(true);
      if (changed) resetAttributesForTemplate();
      updateTemplateUi();
      return;
    }

    const nextTemplate =
      categoryId === 'historical' && scenario?.template
        ? scenario.template
        : 'commoner';
    if (fixedFigure) {
      fixedFigure = null;
      setLockedFields(false);
      nameInput.value = '';
      genderSelect.value = '未设定';
      ageInput.value = '20';
      originInput.value = '';
      identityInput.value = '';
      appearanceInput.value = '';
      backgroundInput.value = '';
      traitsInput.value = '';
    }
    if (templateId !== nextTemplate) {
      templateId = nextTemplate;
      templateSelect.value = templateId;
      resetAttributesForTemplate();
    }
    updateTemplateUi();
  }

  function currentBudget() {
    return getSandboxDifficulty(difficultyId).budget;
  }

  function needsOpeningReview() {
    return scenarioId === CUSTOM_SCENARIO_ID && categoryId === 'historical';
  }

  function persistPlayerDraft() {
    return {
      name: nameInput.value.trim(),
      gender: genderSelect.value,
      age: ageInput.value.trim(),
      origin: originInput.value.trim(),
      identity: identityInput.value.trim(),
      appearance: appearanceInput.value.trim(),
      background: backgroundInput.value.trim(),
      traits: traitsInput.value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      template: categoryId === 'historical' ? templateId : 'sandbox',
      attributes: currentAttributes,
      totalPoints: attributeTotal(currentAttributes),
      aging: createAgingState(ageInput.value),
      fixedFigureId: fixedFigure?.name || '',
      creationMode: fixedFigure ? 'fixed' : 'virtual',
    };
  }

  function customChoices() {
    return customChoicesInput.value
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  function customInventory() {
    return customInventoryInput.value
      .split(/\n/)
      .map((line) => {
        const [name, qty, note] = line.split('|').map((part) => part.trim());
        if (!name) return null;
        return {
          name,
          qty: Math.max(1, Number(qty) || 1),
          note: note || '',
        };
      })
      .filter(Boolean)
      .slice(0, 30);
  }

  function buildCustomScenario() {
    const category = currentCategory();
    return {
      id: customScenarioId,
      title: customTitleInput.value.trim() || '自定义开场',
      description:
        truncateText(customOpeningInput.value.trim(), 160) ||
        '你亲手写下的开场。',
      location:
        customLocationInput.value.trim() ||
        worldbook?.defaults?.location ||
        '未知之地',
      opening: customOpeningInput.value.trim(),
      choices: customChoices(),
      inventory: customInventory(),
      money: null,
      realm: category.id === 'historical' ? '白身' : '凡人',
      titleLabel:
        customTitleLabelInput.value.trim() ||
        identityInput.value.trim() ||
        '初入此世',
      custom: true,
    };
  }

  function setBusy(busy, label = '处理中…') {
    createPending = Boolean(busy);
    createButton.disabled = Boolean(busy);
    createButton.classList.toggle('is-busy', Boolean(busy));
    if (createButtonLabel) {
      createButtonLabel.textContent = busy
        ? label
        : needsOpeningReview()
          ? '验证并进入世界'
          : '进入这个世界';
    }
  }

  function clearVerdict() {
    customVerdict = null;
    customVerdictBox.hidden = true;
    customVerdictBox.className = 'sandbox-opening-verdict';
    customVerdictBox.replaceChildren();
  }

  function showVerdict(verdict) {
    customVerdict = verdict;
    customVerdictBox.hidden = false;
    customVerdictBox.className = `sandbox-opening-verdict ${
      verdict.feasible ? 'is-approved' : 'is-rejected'
    }`;
    customVerdictBox.replaceChildren(
      h(
        'div',
        { class: 'sandbox-opening-verdict-head' },
        icon(verdict.feasible ? 'check' : 'x'),
        h('strong', {
          text: verdict.feasible ? '开场可行，正在创建世界' : '开场被驳回',
        }),
      ),
      h('p', {
        text: verdict.feasible
          ? '与当前世界、年份和角色相容，可以开始。'
          : verdict.reason || '开场与当前世界存在冲突。',
      }),
      h('small', {
        text: 'AI 只做了可行性判定，没有修改你的开场文字。',
      }),
    );
  }

  function showPendingVerdict() {
    customVerdict = null;
    customVerdictBox.hidden = false;
    customVerdictBox.className = 'sandbox-opening-verdict is-pending';
    customVerdictBox.replaceChildren(
      h(
        'div',
        { class: 'sandbox-opening-verdict-head' },
        icon('clock'),
        h('strong', { text: '正在审查开场可行性' }),
      ),
      h('p', {
        text: '只判断能否开始，不会改写、续写或提供替代开场。',
      }),
    );
  }

  function refreshCustomPanel() {
    const isCustom = scenarioId === CUSTOM_SCENARIO_ID;
    customPanel.hidden = !isCustom;
    if (isCustom && !customLocationInput.value.trim()) {
      customLocationInput.value = worldbook?.defaults?.location || '';
    }
    if (createButtonLabel && !createPending) {
      createButtonLabel.textContent = needsOpeningReview()
        ? '验证并进入世界'
        : '进入这个世界';
    }
  }

  function renderCategoryGrid() {
    categoryGrid.replaceChildren(
      ...SANDBOX_CATEGORIES.map((category) =>
        h(
          'label',
          {
            class: `sandbox-category-choice ${categoryId === category.id ? 'is-selected' : ''}`.trim(),
            style: { '--sandbox-accent': category.accent },
          },
          h('input', {
            type: 'radio',
            name: 'sandbox-category',
            value: category.id,
            checked: categoryId === category.id,
            onchange: () => switchCategory(category.id),
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

  function switchCategory(nextCategory) {
    categoryId = nextCategory;
    const options = state.sandboxWorldbooks.filter(
      (book) => book.category === categoryId,
    );
    worldbook = options[0] || null;
    scenarioId = worldbook?.scenarios?.[0]?.id || CUSTOM_SCENARIO_ID;
    year = worldbook?.era?.enabled
      ? worldbook.era.defaultYear
      : worldbook?.defaults?.date?.year || 1;
    templateId = 'commoner';
    currentAttributes = createDefaultAttributes(
      currentBudget(),
      getSandboxAbilityKeys(categoryId, templateId),
    );
    renderCategoryGrid();
    renderBookSelect();
    renderBookDetail();
    renderYearPanel();
    renderScenarios();
    renderAttributes();
    updateTemplateUi();
    updatePreview();
  }

  function renderBookSelect() {
    const options = state.sandboxWorldbooks
      .filter((book) => book.category === categoryId)
      .sort(
        (a, b) =>
          (a.era?.startYear ?? Number.POSITIVE_INFINITY) -
            (b.era?.startYear ?? Number.POSITIVE_INFINITY) ||
          a.name.localeCompare(b.name, 'zh-Hans-CN'),
      );
    bookSelect.replaceChildren(
      ...options.map((book) =>
        h('option', {
          value: book.id,
          text: book.era?.enabled
            ? `${book.name}（${formatHistoricalYearRange(book.era.startYear, book.era.endYear)} 年）`
            : book.name,
          selected: book.id === worldbook?.id,
        }),
      ),
    );
  }

  bookSelect.addEventListener('change', () => {
    worldbook = app.store.getSandboxWorldbook(bookSelect.value);
    scenarioId = worldbook?.scenarios?.[0]?.id || CUSTOM_SCENARIO_ID;
    year = worldbook?.era?.enabled
      ? worldbook.era.defaultYear
      : worldbook?.defaults?.date?.year || 1;
    renderBookDetail();
    renderYearPanel();
    renderScenarios();
    updatePreview();
  });

  function renderBookDetail() {
    if (!worldbook) {
      bookDetail.replaceChildren(
        h('div', { class: 'empty-state compact' }, h('p', { text: '这个分类还没有世界书。' })),
      );
      return;
    }
    const category = getSandboxCategory(worldbook.category);
    bookDetail.replaceChildren(
      h(
        'div',
        { class: 'sandbox-book-detail-head' },
        h('span', { class: 'sandbox-book-emblem' }, icon(category.icon)),
        h(
          'div',
          {},
          h('h3', { text: worldbook.name }),
          h('p', { text: worldbook.description }),
        ),
      ),
      h(
        'div',
        { class: 'sandbox-book-facts' },
        h('span', {}, icon('book'), h('span', { text: `${worldbook.entries.length} 个设定条目` })),
        h('span', {}, icon('play'), h('span', { text: `${worldbook.scenarios.length} 个开场` })),
        h('span', {}, icon('dice'), h('span', { text: `货币：${worldbook.defaults.currency}` })),
      ),
    );
  }

  function renderYearPanel() {
    if (!worldbook?.era?.enabled) {
      yearPanel.replaceChildren(
        h(
          'div',
          { class: 'sandbox-era-free' },
          icon('calendar'),
          h(
            'div',
            {},
            h('strong', { text: '架空纪年' }),
            h('p', { text: `本世界从 ${worldbook?.defaults?.date?.year || 1} 年开始，年份会随行动推进。` }),
          ),
        ),
      );
      return;
    }
    const era = worldbook.era;
    const current = resolveHistoricalEra(worldbook, year);
    const suggested = getSuggestedYears(worldbook);
    const range = h('input', {
      type: 'range',
      min: era.startYear,
      max: era.endYear,
      step: 1,
      value: year,
      class: 'sandbox-year-range',
      'aria-label': '选择年份',
    });
    const number = input({
      type: 'number',
      id: 'sb-year',
      min: era.startYear,
      max: era.endYear,
      value: year,
      class: 'sandbox-year-input',
    });

    const setYear = (value, source = null) => {
      year = Math.max(
        era.startYear,
        Math.min(era.endYear, Math.round(Number(value) || era.defaultYear)),
      );
      if (source !== number) number.value = String(year);
      if (source !== range) range.value = String(year);
      clearVerdict();
      renderYearReadout();
      renderScenarios();
      updatePreview();
    };
    number.addEventListener('change', () => setYear(number.value, number));
    range.addEventListener('input', () => setYear(range.value, range));

    const yearReadout = h('div', { class: 'sandbox-year-readout' });
    function renderYearReadout() {
      const resolved = resolveHistoricalEra(worldbook, year);
      yearReadout.replaceChildren(
        h(
          'div',
          { class: 'sandbox-year-readout-inner' },
          h('span', {
            class: 'sandbox-year-number',
            text: formatHistoricalYearShort(year),
          }),
          h('strong', { text: resolved?.yearLabel || formatHistoricalYear(year) }),
          h('p', { text: resolved?.period?.summary || '该年份没有额外分期摘要。' }),
          resolved?.recentEvents?.length
            ? h(
                'div',
                { class: 'sandbox-year-events' },
                h('small', { text: '近年史事（不会剧透未来）' }),
                ...resolved.recentEvents
                  .slice(-3)
                  .map((event) =>
                    h('span', {
                      text: `${formatHistoricalYear(event.year)} · ${event.title}`,
                    }),
                  ),
              )
            : null,
        ),
      );
    }

    yearPanel.replaceChildren(
      h(
        'div',
        { class: 'sandbox-year-head' },
        h(
          'div',
          {},
          h('h3', { text: `${era.label || era.dynasty} · 选择年份` }),
          h('p', {
            text: `${formatHistoricalYearRange(era.startYear, era.endYear)} 年。历史背景只加载当前年份及以前的内容。`,
          }),
        ),
        h('span', { class: 'sandbox-year-badge' }, icon('scroll'), h('span', { text: era.dynasty || '历史' })),
      ),
      h('div', { class: 'sandbox-year-controls' }, number, range),
      h(
        'div',
        { class: 'sandbox-year-quick' },
        ...suggested.map((item) =>
          h(
            'button',
            {
              class: 'sandbox-year-chip',
              type: 'button',
              onclick: () => setYear(item.year),
            },
            h('strong', { text: formatHistoricalYearShort(item.year) }),
            h('span', { text: item.label }),
          ),
        ),
      ),
      yearReadout,
    );
    renderYearReadout();
  }

  function renderScenarios() {
    const allPresets = worldbook?.scenarios || [];
    const isHistorical = Boolean(worldbook?.era?.enabled);
    const presets = isHistorical
      ? allPresets.filter((scenario) => isSandboxScenarioAvailable(scenario, year))
      : allPresets;
    if (!presets.some((scenario) => scenario.id === scenarioId) && scenarioId !== CUSTOM_SCENARIO_ID) {
      scenarioId = presets[0]?.id || CUSTOM_SCENARIO_ID;
    }

    scenarioGrid.replaceChildren(
      ...presets.map((scenario) =>
        h(
          'label',
          {
            class: `sandbox-scenario-choice ${scenario.id === scenarioId ? 'is-selected' : ''}`.trim(),
          },
          h('input', {
            type: 'radio',
            name: 'sandbox-scenario',
            value: scenario.id,
            checked: scenario.id === scenarioId,
            onchange: () => {
              scenarioId = scenario.id;
              clearVerdict();
              renderScenarios();
              updatePreview();
            },
          }),
          h(
            'span',
            {},
            h('strong', { text: scenario.title }),
            h('small', {
              text: scenario.location || worldbook?.defaults?.location || '地点未定',
            }),
            h('p', { text: scenario.description }),
          ),
          h('span', { class: 'choice-check' }, icon('check')),
        ),
      ),
      h(
        'label',
        {
          class: `sandbox-scenario-choice sandbox-custom-choice ${
            scenarioId === CUSTOM_SCENARIO_ID ? 'is-selected' : ''
          }`.trim(),
        },
        h('input', {
          type: 'radio',
          name: 'sandbox-scenario',
          value: CUSTOM_SCENARIO_ID,
          checked: scenarioId === CUSTOM_SCENARIO_ID,
          onchange: () => {
            scenarioId = CUSTOM_SCENARIO_ID;
            clearVerdict();
            renderScenarios();
            updatePreview();
            requestAnimationFrame(() => {
              customPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
              customTitleInput.focus({ preventScroll: true });
            });
          },
        }),
        h('span', { class: 'sandbox-custom-choice-icon' }, icon('edit')),
        h(
          'span',
          {},
          h('strong', { text: '自定义开场' }),
          h('small', { text: '三类世界都可用' }),
          h('p', { text: '写下只属于这次历险的起点；历史类会先做 AI 可行性审查，其他世界直接创建。' }),
        ),
        h('span', { class: 'choice-check' }, icon('check')),
      ),
    );
    refreshCustomPanel();
    applyScenarioMode(
      scenarioId === CUSTOM_SCENARIO_ID
        ? null
        : worldbook?.scenarios?.find((item) => item.id === scenarioId) || null,
    );
  }

  function renderAttributes() {
    attributeInputs.clear();
    attributesGrid.replaceChildren(
      ...currentAbilities().map((attribute) => {
        const value = currentAttributes[attribute.key] ?? 9;
        const inputElement = input({
          type: 'number',
          min: SANDBOX_LIMITS.minAttributes,
          max: SANDBOX_LIMITS.maxAttributes,
          value,
          class: 'attribute-number',
          id: `sb-attr-${attribute.key}`,
        });
        attributeInputs.set(attribute.key, inputElement);
        inputElement.addEventListener('input', () => {
          currentAttributes[attribute.key] = Math.max(
            SANDBOX_LIMITS.minAttributes,
            Math.min(SANDBOX_LIMITS.maxAttributes, Number(inputElement.value) || SANDBOX_LIMITS.minAttributes),
          );
          inputElement.value = String(currentAttributes[attribute.key]);
          refreshBudget();
          updatePreview();
        });
        return h(
          'div',
          { class: 'sandbox-attribute' },
          h(
            'div',
            { class: 'sandbox-attribute-head' },
            h('span', { text: attribute.label }),
            h('small', { text: attribute.hint }),
          ),
          inputElement,
        );
      }),
    );
    refreshBudget();
  }

  function refreshBudget() {
    const total = attributeTotal(currentAttributes);
    const budget = currentBudget();
    attributeBudget.textContent = `已分配 ${total} / ${budget} · 剩余 ${budget - total}`;
    attributeBudget.classList.toggle('is-over', total > budget);
  }

  difficultySelect.addEventListener('change', () => {
    difficultyId = difficultySelect.value;
    refreshBudget();
    updatePreview();
  });

  templateSelect.addEventListener('change', () => {
    if (fixedFigure) {
      templateSelect.value = fixedFigure.template || 'civil';
      return;
    }
    templateId = templateSelect.value;
    resetAttributesForTemplate();
    updatePreview();
  });

  function randomizeAttributes() {
    const budget = currentBudget();
    const keys = currentAbilities().map((ability) => ability.key);
    const values = Object.fromEntries(keys.map((key) => [key, SANDBOX_LIMITS.minAttributes]));
    let remaining = budget - keys.length * SANDBOX_LIMITS.minAttributes;
    while (remaining > 0) {
      const key = keys[Math.floor(Math.random() * keys.length)];
      if (values[key] < SANDBOX_LIMITS.maxAttributes) {
        values[key] += 1;
        remaining -= 1;
      }
    }
    currentAttributes = values;
    for (const [key, element] of attributeInputs) {
      element.value = String(values[key]);
    }
    refreshBudget();
    updatePreview();
  }

  function updatePreview() {
    const category = currentCategory();
    const resolved = worldbook?.era?.enabled
      ? resolveHistoricalEra(worldbook, year)
      : null;
    const isCustom = scenarioId === CUSTOM_SCENARIO_ID;
    const scenario = isCustom
      ? buildCustomScenario()
      : worldbook?.scenarios?.find((item) => item.id === scenarioId);
    const playerName = nameInput.value.trim() || '无名旅人';
    summaryTitle.textContent = saveNameInput.value.trim() || `${playerName}·${worldbook?.name || '沙盒世界'}`;
    summaryMeta.textContent = [
      category.label,
      categoryId === 'historical' ? currentTemplate().label : '',
      worldbook?.name,
      resolved
        ? resolved.yearLabel
        : formatHistoricalYear(worldbook?.defaults?.date?.year || 1),
      getSandboxDifficulty(difficultyId).label,
    ]
      .filter(Boolean)
      .join(' · ');
    summaryDesc.textContent = isCustom
      ? truncateText(
          customOpeningInput.value.trim() || '写下你进入这个世界的第一段情境。',
          160,
        )
      : scenario?.description || worldbook?.description || '选择一个世界与开场。';
    scenarioSummary.replaceChildren(
      h('span', { class: 'sandbox-preview-label', text: isCustom ? '自定义开场' : '开场' }),
      h('strong', {
        text: scenario?.title || (isCustom ? '自定义开场' : '通用开场'),
      }),
      h('p', {
        text: scenario?.location || worldbook?.defaults?.location || '未知之地',
      }),
      scenario?.fixedFigure
        ? h('small', {
            class: 'sandbox-preview-note',
            text: `进入时将由 AI 按 ${resolved?.yearLabel || formatHistoricalYear(worldbook?.defaults?.date?.year || 1)} 与人物身份推演专属开场，不使用通用模板。`,
          })
        : null,
    );
    const attrs = currentAbilities();
    const total = attributeTotal(currentAttributes);
    const aging =
      categoryId === 'historical'
        ? describeAging(createAgingState(ageInput.value).agingE, templateId)
        : null;
    previewCard.replaceChildren(
      summaryTitle,
      summaryMeta,
      summaryDesc,
      h(
        'div',
        { class: 'sandbox-preview-attributes' },
        ...attrs.map((attribute) =>
          h(
            'span',
            {},
            h('small', { text: attribute.label }),
            h('strong', { text: String(currentAttributes[attribute.key] ?? 9) }),
          ),
        ),
      ),
      ...(categoryId === 'historical'
        ? [
            h(
              'div',
              { class: 'sandbox-preview-points' },
              h('span', {
                text: `总点 ${total} / ${currentBudget()} · 上限 ${SANDBOX_TOTAL_POINT_MAX}`,
              }),
              h('span', {
                text: `${getHistoricalOverallLabel(total, templateId)} · ${aging?.label || '青壮'}`,
              }),
            ),
          ]
        : []),
      scenarioSummary,
      h(
        'div',
        { class: 'sandbox-preview-resources' },
        h('span', { text: `生命 100 · 精力 100` }),
        h('span', {
          text: `${scenario?.money ?? worldbook?.defaults?.startingMoney ?? 0} ${
            worldbook?.defaults?.currency || category.currency
          }`,
        }),
        h('span', { text: scenario?.realm || '凡人' }),
      ),
      h(
        'p',
        { class: 'sandbox-preview-note' },
        icon('info'),
        h('span', {
          text: fixedFigure
            ? `固定历史人物「${fixedFigure.name}」：身份与生平锁定，只能分配六项能力点数。`
            : isCustom
              ? categoryId === 'historical'
                ? '历史类自定义开场会先调用 AI 只做可行性审查：通过就创建，驳回则不创建；不会改写你的文字。'
                : '修仙 / 西方玄幻的自定义开场直接创建，不调用 AI 审查，也不消耗审查 token。'
              : '预设开场创建不调用 AI，不消耗 token。进入后才会开始按回合生成。',
        }),
      ),
    );
  }

  const form = h(
    'form',
    {
      id: 'sandbox-create-form',
      class: 'sandbox-create-form',
      onsubmit: (event) => {
        event.preventDefault();
        create();
      },
    },
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '01' }),
        h('div', {}, h('h2', { text: '选择世界' }), h('p', { text: '三个类型各自有完全不同的世界书与规则。' })),
      ),
      categoryGrid,
      h('div', { class: 'sandbox-field-block' }, h('label', { class: 'field-label', text: '沙盒世界书' }), bookSelect),
      bookDetail,
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '02' }),
        h('div', {}, h('h2', { text: '时间与开场' }), h('p', { text: '历史朝代可以直接选择年份；其他世界从预设纪年开始。' })),
      ),
      yearPanel,
      h('h3', { class: 'form-subhead', text: '开场处境' }),
      h('p', {
        class: 'sandbox-scenario-note',
        text: '可以选择世界书预设开场，也可以为当前世界写一个自定义开场。只有历史类会在创建前做一次 AI 可行性审查；修仙与西方玄幻直接创建，审查不会改写正文。',
      }),
      scenarioGrid,
      customPanel,
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '03' }),
        h('div', {}, h('h2', { text: '你是谁' }), h('p', { text: '身份、出身与性格会影响 NPC 的态度、可用的关系和判定方式。' })),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({ label: '角色姓名', required: true, control: nameInput, htmlFor: 'sb-name' }),
        field({ label: '性别', control: genderSelect, htmlFor: 'sb-gender' }),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({ label: '年龄', control: ageInput, htmlFor: 'sb-age' }),
        field({ label: '存档名称', control: saveNameInput, htmlFor: 'sb-save-name', hint: '可留空。' }),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({ label: '出身', control: originInput, htmlFor: 'sb-origin' }),
        field({ label: '初始身份', control: identityInput, htmlFor: 'sb-identity' }),
      ),
      field({ label: '外貌', control: appearanceInput, htmlFor: 'sb-appearance' }),
      field({ label: '过往', control: backgroundInput, htmlFor: 'sb-background' }),
      field({ label: '特质', control: traitsInput, htmlFor: 'sb-traits', hint: '用逗号分隔，2–4 个即可。' }),
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '04' }),
        h('div', {}, h('h2', { text: '属性与规则' }), h('p', { text: '属性影响行动判定。难度会改变属性预算与失败代价。' })),
      ),
      templatePanel,
      h(
        'div',
        { class: 'sandbox-difficulty-row' },
        h('span', { class: 'field-label', text: '难度' }),
        difficultySelect,
      ),
      h(
        'div',
        { class: 'sandbox-attribute-head-row' },
        h('span', { class: 'field-label', text: '属性分配' }),
        attributeBudget,
        h(
          'button',
          { class: 'btn btn-ghost btn-sm', type: 'button', onclick: randomizeAttributes },
          icon('dice'),
          h('span', { text: '随机分配' }),
        ),
      ),
      attributesGrid,
      h(
        'label',
        { class: 'checkbox-row sandbox-check-row' },
        h('span', { class: 'checkbox' }, checksToggle, h('span', { class: 'checkbox-box' }, icon('check'))),
        h(
          'span',
          {},
          h('strong', { text: '启用行动判定' }),
          h('small', { text: '每次行动掷 d20 + 属性修正，结果会写入提示词，失败不会被 AI 改写。' }),
        ),
      ),
    ),
  );

  const aside = h(
    'aside',
    { class: 'create-preview sandbox-create-preview' },
    h(
      'div',
      { class: 'preview-sticky' },
      h(
        'div',
        { class: 'preview-head' },
        h(
          'div',
          {},
          h('p', { class: 'eyebrow', text: 'World entry' }),
          h('h2', { class: 'preview-title', text: '即将进入' }),
        ),
        h('span', { class: 'local-only-badge' }, icon('shield'), h('span', { text: '本地创建' })),
      ),
      h('div', { class: 'sandbox-create-preview-card' }, previewCard),
      createButton,
      h('p', {
        class: 'sandbox-preview-footnote',
        text: '创建后，所有行动、状态、编年史都会保存在当前沙盒存档中。不会写入恋爱对话存档。',
      }),
    ),
  );

  const page = h(
    'div',
    { class: 'page page-sandbox-create' },
    pageHeader({
      eyebrow: 'New sandbox journey',
      title: '创建沙盒世界',
      lede: '先选世界与年份，再决定你是谁。这个角色只属于沙盒模式。',
      actions: [
        h(
          'a',
          { class: 'btn btn-ghost', href: '#/sandbox' },
          icon('arrowLeft'),
          h('span', { text: '返回大厅' }),
        ),
      ],
    }),
    h('div', { class: 'create-layout sandbox-create-layout' }, form, aside),
  );

  root.appendChild(page);
  renderCategoryGrid();
  renderBookSelect();
  renderBookDetail();
  renderYearPanel();
  renderScenarios();
  renderAttributes();
  updateTemplateUi();
  updatePreview();

  for (const element of [nameInput, saveNameInput, genderSelect, ageInput, originInput, identityInput, appearanceInput, backgroundInput, traitsInput]) {
    element.addEventListener('input', updatePreview);
    element.addEventListener('change', updatePreview);
  }

  for (const element of [
    customTitleInput,
    customLocationInput,
    customOpeningInput,
    customChoicesInput,
    customInventoryInput,
    customTitleLabelInput,
  ]) {
    element.addEventListener('input', () => {
      clearVerdict();
      updatePreview();
    });
  }

  async function validateCustomOpening(scenario) {
    const settings = clone(app.store.state.settings);
    if (settings.demoMode) {
      return {
        feasible: false,
        reason: '演示模式不会调用模型，无法完成开场可行性审查。请配置模型，或改用预设开场。',
      };
    }
    const prompt = buildOpeningValidationPrompt({
      worldbook,
      categoryId,
      year,
      scenario,
      player: persistPlayerDraft(),
    });
    const providerId = settings.provider;
    const promptText = prompt.messages.map((message) => message.content).join('\n');
    try {
      const result = await completeChat({
        settings: {
          ...settings,
          maxTokens: 260,
          temperature: 0.1,
          stream: false,
        },
        messages: prompt.messages,
        apiKey: app.getEffectiveApiKey(providerId),
        useCache: false,
      });
      const verdict = parseOpeningVerdict(result.text);
      const usage = normalizeUsage(result.usage, promptText, result.text);
      if (usage?.totalTokens) {
        app.store.recordUsage({ provider: providerId, usage });
      }
      const detail = {
        category: categoryId,
        year: worldbook?.era?.enabled ? year : null,
        feasible: verdict.feasible,
        reasonChars: verdict.reason.length,
        provider: providerId,
        model: result.model || settings.model,
        tokens: usage?.totalTokens || 0,
      };
      app.store.log(
        verdict.feasible ? 'info' : 'warn',
        'sandbox.opening.validation',
        `自定义开场审查：${verdict.feasible ? '通过' : '驳回'}。${verdict.reason}`,
        { detail },
      );
      app.updateTokenHud();
      return verdict;
    } catch (error) {
      app.store.logError('sandbox.opening.validation.failed', error, {
        detail: { category: categoryId, year: worldbook?.era?.enabled ? year : null },
      });
      return {
        feasible: false,
        reason: `无法完成开场可行性审查：${error.message}`,
      };
    }
  }

  function validate() {
    if (!worldbook) {
      toastError('请选择一个沙盒世界书。');
      return false;
    }
    if (!nameInput.value.trim()) {
      nameInput.focus();
      toastError('请给角色起一个名字。');
      return false;
    }
    const total = attributeTotal(currentAttributes);
    if (total !== currentBudget()) {
      toastError(
        `当前总点为 ${total}，必须正好分配到 ${currentBudget()} 点（${getSandboxDifficulty(difficultyId).label}难度）。`,
      );
      return false;
    }
    if (worldbook.era?.enabled) {
      if (year < worldbook.era.startYear || year > worldbook.era.endYear) {
        toastError(
          `年份必须在 ${formatHistoricalYearRange(
            worldbook.era.startYear,
            worldbook.era.endYear,
          )} 年之间。`,
        );
        return false;
      }
    }
    if (scenarioId === CUSTOM_SCENARIO_ID) {
      if (customOpeningInput.value.trim().length < 20) {
        customOpeningInput.focus();
        toastError('自定义开场至少需要 20 字，才能判断是否有可行动的起点。');
        return false;
      }
      if (!customChoices().length) {
        customChoicesInput.focus();
        toastError('自定义开场至少需要一个初始行动选项。');
        return false;
      }
    }
    return true;
  }

  async function generateFixedOpening(scenario) {
    if (categoryId !== 'historical' || !scenario?.fixedFigure) return null;
    const settings = clone(app.store.state.settings);
    if (settings.demoMode || settings.aiOpening === false) return null;
    const providerId = settings.provider;
    const apiKey = app.getEffectiveApiKey(providerId);
    if (!apiKey && !settings.useServerKey) return null;
    try {
      const prompt = buildHistoricalOpeningPrompt({
        worldbook,
        scenario,
        year,
        player: persistPlayerDraft(),
        difficulty: getSandboxDifficulty(difficultyId),
      });
      const result = await completeChat({
        settings: {
          ...settings,
          maxTokens: 900,
          temperature: 0.55,
          stream: false,
        },
        messages: prompt.messages,
        apiKey,
        useCache: false,
      });
      const parsed = parseHistoricalOpening(result.text);
      const usage = normalizeUsage(
        result.usage,
        prompt.messages.map((message) => message.content).join('\n'),
        result.text,
      );
      if (usage?.totalTokens) {
        app.store.recordUsage({ provider: providerId, usage });
        app.updateTokenHud();
      }
      if (!parsed) {
        app.store.warn(
          'sandbox.opening.generated.invalid',
          'AI 开场推演没有返回可用结构，已使用内置开场。',
          { detail: { year, figure: scenario.fixedFigure.name } },
        );
        return null;
      }
      if (detectPlayerAgency(parsed.opening, scenario.fixedFigure.name).risky) {
        parsed.opening = stripPlayerAgency(
          parsed.opening,
          scenario.fixedFigure.name,
        );
      }
      app.store.info(
        'sandbox.opening.generated',
        `已按 ${year} 年与「${scenario.fixedFigure.name}」生成专属开场。`,
        {
          detail: {
            year,
            figure: scenario.fixedFigure.name,
            chars: parsed.opening.length,
          },
        },
      );
      return parsed;
    } catch (error) {
      app.store.warn(
        'sandbox.opening.generated.failed',
        `AI 开场推演失败，使用内置开场：${error.message}`,
        { detail: { year, figure: scenario.fixedFigure.name } },
      );
      return null;
    }
  }

  async function create() {
    if (createPending || !validate()) return;
    const isCustom = scenarioId === CUSTOM_SCENARIO_ID;
    const reviewRequired = isCustom && categoryId === 'historical';
    const scenario = isCustom
      ? buildCustomScenario()
      : worldbook.scenarios.find((item) => item.id === scenarioId);
    if (!scenario) {
      toastError('没有找到可用的开场。');
      return;
    }

    try {
      if (reviewRequired) {
        setBusy(true, '正在审查开场…');
        showPendingVerdict();
        const verdict = await validateCustomOpening(scenario);
        if (!verdict.feasible) {
          showVerdict(verdict);
          toastError(`开场被驳回：${verdict.reason}`, '未创建世界');
          return;
        }
        showVerdict(verdict);
        toast('开场可行性审查通过。', { type: 'success', duration: 2_000 });
      }

      let openingOverride = null;
      if (!isCustom) {
        setBusy(true, '正在推演此年份的开场…');
        openingOverride = await generateFixedOpening(scenario);
      }
      setBusy(true, '正在创建…');
      const save = createSandboxSave({
        name: saveNameInput.value.trim(),
        category: categoryId,
        worldbook,
        year,
        scenario,
        player: persistPlayerDraft(),
        difficulty: difficultyId,
        checksEnabled: checksToggle.checked,
        openingOverride,
      });
      app.store.addSandboxSave(save);
      app.store.info(
        'sandbox.created',
        `创建沙盒历险「${save.name}」，世界书「${worldbook.name}」。`,
        {
          archiveId: save.id,
          detail: {
            category: categoryId,
            worldbook: worldbook.name,
            year: save.world.date.year,
            difficulty: difficultyId,
            customOpening: isCustom,
            openingReviewed: reviewRequired,
            aiOpening: Boolean(openingOverride),
          },
        },
      );
      app.navigate('sandbox/play');
    } catch (error) {
      app.store.logError('sandbox.create.failed', error, {
        detail: { category: categoryId, worldbook: worldbook?.id },
      });
      toastError(`创建失败：${error.message}`);
    } finally {
      if (!document.querySelector('.page-sandbox-play')) setBusy(false);
    }
  }

  return { cleanup() {} };
}
