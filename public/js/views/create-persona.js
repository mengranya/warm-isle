/**
 * 辅助创建人格。
 *
 * 关键约束：这个页面只做“表单 -> 标准 JSON”的本地转换，不调用任何 AI。
 * 输出可直接保存、复制、下载，也可作为插件/世界书表单的交互参考。
 */

import { DIALOGUE_ANIMATIONS, DEFAULT_EMOJIS } from '../core/constants.js';
import { appendEmojiTail } from '../core/parse.js';
import {
  createId,
  downloadJson,
  safeColor,
  truncateText,
} from '../core/utils.js';
import { copyText } from '../ui/dom.js';
import { normalizePersona } from '../data/schemas.js';
import {
  checkbox,
  field,
  input,
  pageHeader,
  select,
  tag,
  textarea,
} from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';

const DRAFT_ID = createId('persona');

export async function render(root, app) {
  const animationRadios = [];
  let previewJson = '';
  let saved = false;

  const nameInput = input({
    id: 'p-name',
    maxLength: 40,
    required: true,
    placeholder: '比如：沈知夏',
    autocomplete: 'off',
  });
  const ageInput = input({
    id: 'p-age',
    maxLength: 24,
    placeholder: '比如：27',
  });
  const pronounSelect = select({
    id: 'p-pronouns',
    options: [
      { value: '她', label: '她 / 女性' },
      { value: '他', label: '他 / 男性' },
      { value: 'TA', label: 'TA / 不指定' },
    ],
    value: '她',
  });
  const identityInput = input({
    id: 'p-identity',
    maxLength: 160,
    required: true,
    placeholder: '比如：旧城区白昼书店的主理人',
  });
  const personalityInput = textarea({
    id: 'p-personality',
    rows: 4,
    required: true,
    maxLength: 1_200,
    placeholder: 'TA 的性格、矛盾之处、面对亲密关系时的样子…',
  });
  const appearanceInput = textarea({
    id: 'p-appearance',
    rows: 3,
    maxLength: 800,
    placeholder: '外貌、经常穿的衣物、气味、标志性小动作…',
  });
  const backgroundInput = textarea({
    id: 'p-background',
    rows: 3,
    maxLength: 1_200,
    placeholder: 'TA 经历过什么？现在为什么会出现在这里？',
  });
  const likesInput = input({
    id: 'p-likes',
    maxLength: 600,
    placeholder: '旧书、雨天、手冲咖啡（用逗号分隔）',
  });
  const addressInput = input({
    id: 'p-address',
    maxLength: 40,
    required: true,
    placeholder: '比如：阿屿 / 小朋友 / 搭档',
  });
  const greetingInput = textarea({
    id: 'p-greeting',
    rows: 3,
    maxLength: 800,
    placeholder: '第一次见到玩家时说的话。可留空。',
  });
  const habitsInput = textarea({
    id: 'p-habits',
    rows: 4,
    maxLength: 800,
    placeholder: '语速、句长、口头禅、如何表达关心、什么时候会沉默…',
  });
  const tagsInput = input({
    id: 'p-tags',
    maxLength: 300,
    placeholder: '治愈、年上、海边小镇（用逗号分隔）',
  });
  const emojiEnabled = checkbox({
    id: 'p-emoji-enabled',
    label: '在对话结尾自动显示 emoji',
    checked: true,
    description: '由界面添加，不占用模型 token。',
  });
  const emojiInput = input({
    id: 'p-emojis',
    maxLength: 120,
    value: DEFAULT_EMOJIS.slice(0, 3).join(' '),
    placeholder: '🌷 ☕ 🍂',
  });

  const colorValue = h('input', {
    class: 'input hex-input',
    id: 'p-color-hex',
    value: '#c56b57',
    maxlength: '7',
    'aria-label': '字体颜色 HEX',
  });
  const colorPicker = h('input', {
    type: 'color',
    class: 'color-input',
    id: 'p-color',
    value: '#c56b57',
    'aria-label': '选择字体颜色',
  });
  const colorSwatch = h('span', { class: 'color-swatch', style: { background: '#c56b57' } });
  const colorError = h('span', { class: 'field-error', hidden: true, text: '请输入 #RGB 或 #RRGGBB 格式。' });

  const animationChoices = h(
    'div',
    { class: 'animation-choices' },
    ...DIALOGUE_ANIMATIONS.map((animation) => {
      const radio = h('input', {
        type: 'radio',
        name: 'animation',
        value: animation.id,
        checked: animation.id === 'bounce',
        onchange: () => scheduleUpdate(),
      });
      animationRadios.push(radio);
      return h(
        'label',
        { class: 'animation-choice' },
        radio,
        h(
          'span',
          { class: 'animation-choice-copy' },
          h('strong', { text: animation.label }),
          h('small', { text: animation.hint }),
        ),
        h('span', { class: 'animation-dot', style: { '--choice-color': '#c56b57' } }),
      );
    }),
  );

  const livePreview = h('div', { class: 'persona-live-preview' });
  const jsonPreview = h('pre', { class: 'json-preview', spellcheck: 'false' });
  const jsonStats = h('span', { class: 'muted small' });

  const form = h(
    'form',
    {
      class: 'persona-form',
      id: 'persona-form',
      onsubmit: (event) => {
        event.preventDefault();
        savePersona();
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
          h('h2', { text: '使 TA 成为一个人' }),
          h('p', { text: '这些字段会以明确、紧凑的方式进入提示词，因此越具体越好。' }),
        ),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({ label: '姓名', required: true, control: nameInput, htmlFor: 'p-name' }),
        field({ label: '年龄', control: ageInput, htmlFor: 'p-age' }),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({ label: '代称', control: pronounSelect, htmlFor: 'p-pronouns' }),
        field({
          label: '对玩家的称呼',
          required: true,
          control: addressInput,
          htmlFor: 'p-address',
          hint: '会直接影响角色怎么叫你。',
        }),
      ),
      field({ label: '身份', required: true, control: identityInput, htmlFor: 'p-identity' }),
      field({
        label: '性格',
        required: true,
        control: personalityInput,
        htmlFor: 'p-personality',
      }),
      field({ label: '外貌', control: appearanceInput, htmlFor: 'p-appearance' }),
      field({ label: '过往', control: backgroundInput, htmlFor: 'p-background' }),
      field({
        label: '喜欢的事物',
        control: likesInput,
        htmlFor: 'p-likes',
        hint: '多项用中文或英文逗号分隔。',
      }),
      field({ label: '标签', control: tagsInput, htmlFor: 'p-tags' }),
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '02' }),
        h(
          'div',
          {},
          h('h2', { text: '对话习惯' }),
          h('p', { text: '这里决定 TA 在屏幕上的视觉与语言质感，不额外消耗模型 token。' }),
        ),
      ),
      field({
        label: '说话习惯',
        control: habitsInput,
        htmlFor: 'p-habits',
        hint: '例如：句子偏短，关心藏在命令句里，很少使用感叹号。',
      }),
      h(
        'div',
        { class: 'color-field' },
        h(
          'div',
          { class: 'field-label-row' },
          h('span', { class: 'field-label', text: '字体颜色' }),
          h('span', { class: 'field-hint', text: '支持自定义 HEX 颜色。' }),
        ),
        h(
          'div',
          { class: 'color-control' },
          colorSwatch,
          colorPicker,
          colorValue,
          colorError,
        ),
      ),
      h(
        'div',
        { class: 'field color-animation-field' },
        h('span', { class: 'field-label', text: '字体动画' }),
        animationChoices,
      ),
      emojiEnabled,
      h(
        'div',
        { class: 'emoji-config' },
        field({
          label: '常用 emoji',
          control: emojiInput,
          htmlFor: 'p-emojis',
          hint: '用空格分隔；界面会从这些 emoji 中选一个放在结尾。',
        }),
        h(
          'div',
          { class: 'emoji-preview-row' },
          ...safeEmojiPreview(emojiInput.value).map((emoji) => h('span', { text: emoji })),
        ),
      ),
      field({ label: '开场白', control: greetingInput, htmlFor: 'p-greeting' }),
    ),
    h(
      'div',
      { class: 'create-form-actions' },
      h('a', { class: 'btn btn-ghost', href: '#/personas' }, icon('arrowLeft'), h('span', { text: '返回' })),
      h(
        'button',
        { class: 'btn btn-primary btn-lg', type: 'submit', form: 'persona-form' },
        icon('persona'),
        h('span', { text: '保存人格' }),
      ),
    ),
  );

  const previewAside = h(
    'aside',
    { class: 'create-preview persona-preview-aside' },
    h(
      'div',
      { class: 'preview-sticky' },
      h(
        'div',
        { class: 'preview-head' },
        h(
          'div',
          {},
          h('p', { class: 'eyebrow', text: 'Live preview' }),
          h('h2', { class: 'preview-title', text: 'TA 会怎样出现' }),
        ),
        h('span', { class: 'local-only-badge' }, icon('shield'), h('span', { text: '本地生成 · 不调用 AI' })),
      ),
      livePreview,
      h(
        'div',
        { class: 'json-panel' },
        h(
          'div',
          { class: 'json-panel-head' },
          h('strong', { text: '人格 JSON' }),
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
                  downloadJson('persona-draft.json', JSON.parse(previewJson));
                  app.store.info('persona.draft.exported', '下载了人格 JSON 草稿。');
                },
              },
              icon('download'),
            ),
          ),
        ),
        jsonPreview,
      ),
      h('p', { class: 'preview-footnote', text: '保存后仍可随时从人格卡片导出 JSON。' }),
    ),
  );

  const page = h(
    'div',
    { class: 'page page-persona-create' },
    pageHeader({
      eyebrow: 'Persona studio · local generator',
      title: '创建人格',
      lede: '填写你脑海里的 TA。此页面不接入 AI，只负责把设定整理成标准人格 JSON。',
      actions: [
        h(
          'span',
          { class: 'local-only-badge page-badge' },
          icon('shield'),
          h('span', { text: '不消耗 token' }),
        ),
      ],
    }),
    h('div', { class: 'create-layout persona-create-layout' }, form, previewAside),
  );

  root.appendChild(page);

  /* ------------------------------ 交互 ------------------------------ */

  function selectedAnimation() {
    return animationRadios.find((radio) => radio.checked)?.value || 'none';
  }

  function parseList(value) {
    return String(value || '')
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function buildDraft() {
    return {
      schemaVersion: 1,
      kind: 'warm-isle.persona',
      id: DRAFT_ID,
      name: nameInput.value.trim(),
      age: ageInput.value.trim(),
      pronouns: pronounSelect.value,
      identity: identityInput.value.trim(),
      personality: personalityInput.value.trim(),
      appearance: appearanceInput.value.trim(),
      background: backgroundInput.value.trim(),
      likes: parseList(likesInput.value),
      address: addressInput.value.trim(),
      greeting: greetingInput.value.trim(),
      dialogue: {
        color: safeColor(colorValue.value, '#c56b57'),
        animation: selectedAnimation(),
        emojiEnabled: emojiEnabled.querySelector('input').checked,
        emojis: parseEmojiList(emojiInput.value),
        habits: habitsInput.value.trim(),
      },
      tags: parseList(tagsInput.value),
      builtin: false,
      createdAt: new Date().toISOString(),
    };
  }

  function parseEmojiList(value) {
    const candidates = String(value || '')
      .split(/[\s,，、]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return candidates.length ? candidates.slice(0, 12) : ['🌷'];
  }

  function safePreviewPersona() {
    const draft = buildDraft();
    return {
      ...draft,
      name: draft.name || '未命名人格',
      identity: draft.identity || '身份未设定',
      address: draft.address || '你',
      dialogue: {
        ...draft.dialogue,
        color: safeColor(colorValue.value, '#c56b57'),
      },
    };
  }

  function updateColor() {
    const raw = colorValue.value.trim();
    const valid = /^#[0-9a-f]{3,6}$/i.test(raw) && (raw.length === 4 || raw.length === 7);
    colorError.hidden = valid;
    colorValue.classList.toggle('is-invalid', !valid);
    if (valid) {
      const normalized = safeColor(raw, '#c56b57');
      colorPicker.value = normalized;
      colorSwatch.style.background = normalized;
      for (const dot of animationChoices.querySelectorAll('.animation-dot')) {
        dot.style.setProperty('--choice-color', normalized);
      }
    }
  }

  function updatePreview() {
    let draft;
    try {
      draft = safePreviewPersona();
    } catch {
      draft = safePreviewPersona();
    }
    const color = draft.dialogue.color;
    const animation = draft.dialogue.animation;
    const greeting = draft.greeting || '（TA 看了你一眼，像是已经等了很久。）';
    livePreview.replaceChildren(
      h(
        'div',
        { class: 'preview-scene persona-preview-scene', style: { '--preview-accent': color } },
        h('span', { class: 'preview-grain', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'preview-persona-line' },
          h(
            'span',
            { class: 'avatar avatar-lg', style: { '--avatar-color': color } },
            h('span', { class: 'avatar-initial', text: Array.from(draft.name)[0] || '?' }),
          ),
          h(
            'div',
            {},
            h('strong', { text: draft.name }),
            h('span', { text: draft.identity }),
          ),
        ),
        h(
          'div',
          { class: `bubble assistant-bubble anim-${animation} preview-bubble`, style: { '--persona-color': color } },
          h('p', { text: appendEmojiTail(truncateText(greeting, 130), draft, 'live') }),
        ),
        h(
          'div',
          { class: 'preview-address' },
          h('span', { text: '对玩家的称呼' }),
          h('strong', { text: `「${draft.address}」` }),
        ),
      ),
      h(
        'div',
        { class: 'preview-tags' },
        ...(draft.tags.length ? draft.tags : ['尚未添加标签']).slice(0, 4).map((text) =>
          tag(text, 'neutral'),
        ),
      ),
    );

    try {
      const normalized = normalizePersona(draft, { id: DRAFT_ID, builtin: false });
      previewJson = JSON.stringify(
        {
          ...normalized,
          builtin: false,
        },
        null,
        2,
      );
    } catch (error) {
      previewJson = JSON.stringify(
        {
          error: error.message,
          hint: '填写姓名后即可生成完整 JSON。',
        },
        null,
        2,
      );
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
      updateColor();
      updatePreview();
    });
  }

  colorValue.addEventListener('input', scheduleUpdate);
  colorPicker.addEventListener('input', () => {
    colorValue.value = colorPicker.value;
    colorValue.classList.remove('is-invalid');
    colorError.hidden = true;
    colorSwatch.style.background = colorPicker.value;
    updatePreview();
  });
  emojiInput.addEventListener('input', () => {
    const row = page.querySelector('.emoji-preview-row');
    if (row) {
      row.replaceChildren(
        ...safeEmojiPreview(emojiInput.value).map((emoji) => h('span', { text: emoji })),
      );
    }
    scheduleUpdate();
  });
  form.addEventListener('input', scheduleUpdate);
  form.addEventListener('change', scheduleUpdate);

  function savePersona() {
    if (saved) return;
    if (!nameInput.value.trim()) {
      nameInput.focus();
      toastError('请先填写人格姓名。');
      return;
    }
    if (!identityInput.value.trim() || !personalityInput.value.trim() || !addressInput.value.trim()) {
      toastError('身份、性格和对玩家的称呼都需要填写完整。');
      const firstInvalid = !identityInput.value.trim()
        ? identityInput
        : !personalityInput.value.trim()
          ? personalityInput
          : addressInput;
      firstInvalid.focus();
      return;
    }
    try {
      const draft = buildDraft();
      const persona = normalizePersona(draft, { id: DRAFT_ID, builtin: false });
      const duplicate = app.store.state.personas.find(
        (item) => item.name.toLowerCase() === persona.name.toLowerCase(),
      );
      if (duplicate) {
        persona.name = `${persona.name}（${app.store.state.personas.length + 1}）`;
      }
      app.store.update(
        (state) => {
          state.personas.push(persona);
        },
        { reason: 'persona-created' },
      );
      app.store.info('persona.created', `创建了人格「${persona.name}」。`, {
        detail: { color: persona.dialogue.color, animation: persona.dialogue.animation },
      });
      saved = true;
      toastSuccess(`「${persona.name}」已经准备好见面了。`, '人格已保存');
      app.navigate('personas');
    } catch (error) {
      saved = false;
      app.store.logError('persona.create.failed', error);
      toastError(`保存人格失败：${error.message}`);
    }
  }

  updateColor();
  updatePreview();

  return { cleanup() {} };
}

function safeEmojiPreview(value) {
  return String(value || '')
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}
