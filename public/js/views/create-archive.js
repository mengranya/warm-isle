/** 创建存档：选人格、世界书、主人公，预览后进入故事。 */

import { appendEmojiTail } from '../core/parse.js';
import { safeColor, truncateText } from '../core/utils.js';
import {
  buildInitialStatus,
  createArchiveRecord,
  normalizeProtagonist,
  personalizeGreeting,
} from '../data/schemas.js';
import {
  avatar,
  field,
  input,
  pageHeader,
  select,
  tag,
  textarea,
} from '../ui/components.js';
import { h, icon } from '../ui/dom.js';
import { toastError, toastSuccess } from '../ui/toast.js';

export async function render(root, app) {
  const state = app.store.state;
  const queryPersona = app.runtime.query?.get('persona');
  const queryWorldbook = app.runtime.query?.get('worldbook');
  let selectedPersonaId =
    state.personas.find((persona) => persona.id === queryPersona)?.id || state.personas[0]?.id;
  let selectedWorldbookId =
    state.worldbooks.find((worldbook) => worldbook.id === queryWorldbook)?.id ||
    state.worldbooks.find((worldbook) => worldbook.id === 'world_mist_harbor')?.id ||
    state.worldbooks[0]?.id ||
    '';
  let greetingTouched = false;
  let nameTouched = false;
  let creating = false;

  const page = h('div', { class: 'page page-create' });
  root.appendChild(page);

  const personaGrid = h('div', { class: 'choice-grid persona-choice-grid' });
  const worldbookSelect = select({
    id: 'archive-worldbook',
    options: [
      { value: '', label: '不使用世界书 · 纯人格对话' },
      ...state.worldbooks.map((worldbook) => ({
        value: worldbook.id,
        label: `${worldbook.name}${worldbook.builtin ? ' · 预设' : ''}`,
      })),
    ],
    value: selectedWorldbookId,
  });

  const archiveName = input({
    id: 'archive-name',
    placeholder: '不填则以人格名自动命名',
    maxLength: 80,
  });
  archiveName.addEventListener('input', () => {
    nameTouched = true;
    updatePreview();
  });

  const playerName = input({
    id: 'player-name',
    maxLength: 40,
    required: true,
    placeholder: '你在这个故事里的名字',
  });
  const playerAge = input({ id: 'player-age', maxLength: 24, placeholder: '如 25' });
  const playerIdentity = input({
    id: 'player-identity',
    maxLength: 200,
    placeholder: '如：刚搬回海边的插画编辑',
  });
  const playerLikes = textarea({
    id: 'player-likes',
    rows: 3,
    maxLength: 600,
    placeholder: '喜欢的东西、在意的小事、随身携带的物件…',
  });
  const extrasContainer = h('div', { class: 'stack-sm' });
  const greetingInput = textarea({
    id: 'archive-greeting',
    rows: 4,
    maxLength: 2_000,
  });

  const previewCard = h('aside', { class: 'create-preview' });
  const form = h(
    'form',
    {
      class: 'create-form',
      id: 'create-archive-form',
      onsubmit: (event) => {
        event.preventDefault();
        createArchive();
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
          h('h2', { text: '选择人格' }),
          h('p', { text: '一段故事只属于一个人格；之后可在存档页并列切换。' }),
        ),
        h('a', { class: 'text-link', href: '#/personas' }, '管理人格'),
      ),
      personaGrid,
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
          h('h2', { text: '选择世界书' }),
          h('p', { text: '世界书会作为背景事实进入提示词，只挑选相关条目，避免浪费 token。' }),
        ),
      ),
      field({
        label: '世界书',
        control: worldbookSelect,
        htmlFor: 'archive-worldbook',
      }),
      h('div', { class: 'worldbook-inline-preview' }),
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '03' }),
        h(
          'div',
          {},
          h('h2', { text: '写下主人公' }),
          h('p', { text: '这是“你”。AI 只能依据这里的信息理解你，不能替你行动。' }),
        ),
      ),
      h(
        'div',
        { class: 'form-grid two' },
        field({
          label: '姓名',
          required: true,
          control: playerName,
          htmlFor: 'player-name',
        }),
        field({ label: '年龄', control: playerAge, htmlFor: 'player-age' }),
      ),
      field({
        label: '身份',
        control: playerIdentity,
        htmlFor: 'player-identity',
      }),
      field({
        label: '喜好',
        control: playerLikes,
        htmlFor: 'player-likes',
      }),
      h(
        'div',
        { class: 'form-section' },
        h(
          'div',
          { class: 'form-section-head' },
          h('h3', { class: 'form-section-title', text: '其他自定义字段' }),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () => addExtra(),
            },
            icon('plus'),
            h('span', { text: '添加字段' }),
          ),
        ),
        h('p', { class: 'muted small', text: '例如：随身物品、秘密、与角色的旧识关系。' }),
        extrasContainer,
      ),
    ),
    h(
      'section',
      { class: 'form-card' },
      h(
        'div',
        { class: 'form-card-head' },
        h('span', { class: 'step-number', text: '04' }),
        h(
          'div',
          {},
          h('h2', { text: '给故事一个名字' }),
          h('p', { text: '存档名只用于本地书架；开场白可以保留人格的默认问候，也可以改写。' }),
        ),
      ),
      field({ label: '存档名称', control: archiveName, htmlFor: 'archive-name' }),
      field({
        label: '开场白',
        control: greetingInput,
        htmlFor: 'archive-greeting',
        hint: '支持 {player} 占位符。留空会使用人格默认开场。',
      }),
    ),
    h(
      'div',
      { class: 'create-form-actions' },
      h('a', { class: 'btn btn-ghost', href: '#/archives' }, icon('arrowLeft'), h('span', { text: '返回' })),
      h(
        'button',
        { class: 'btn btn-primary btn-lg', type: 'submit', form: 'create-archive-form' },
        icon('spark'),
        h('span', { text: '点亮这座岛' }),
      ),
    ),
  );

  page.append(
    pageHeader({
      eyebrow: '新故事 · New story',
      title: '创建存档',
      lede: '先选一个人，再选一个世界。剩下的，从第一句话开始。',
      actions: [
        h('a', { class: 'btn btn-ghost', href: '#/archives' }, icon('arrowLeft'), h('span', { text: '返回存档' })),
      ],
    }),
    h('div', { class: 'create-layout' }, form, previewCard),
  );

  /* ------------------------------ 交互 ------------------------------ */

  function addExtra(label = '', value = '') {
    const row = h('div', { class: 'repeater-row' });
    const labelField = input({
      placeholder: '字段名，如：随身物品',
      value: label,
      maxLength: 40,
      'aria-label': '自定义字段名',
    });
    const valueField = input({
      placeholder: '内容',
      value,
      maxLength: 500,
      'aria-label': '自定义字段内容',
    });
    const remove = h(
      'button',
      {
        class: 'icon-btn subtle',
        type: 'button',
        'aria-label': '删除这个字段',
        onclick: () => {
          row.remove();
          updatePreview();
        },
      },
      icon('x'),
    );
    for (const element of [labelField, valueField]) {
      element.addEventListener('input', updatePreview);
    }
    row.append(labelField, valueField, remove);
    extrasContainer.appendChild(row);
  }

  function buildPersonaChoices() {
    personaGrid.replaceChildren(
      ...state.personas.map((persona) => {
        const color = safeColor(persona.dialogue?.color, '#c56b57');
        const selected = persona.id === selectedPersonaId;
        const label = h(
          'label',
          {
            class: `choice-card persona-choice ${selected ? 'is-selected' : ''}`.trim(),
            style: { '--choice-color': color },
          },
          h('input', {
            type: 'radio',
            name: 'archive-persona',
            value: persona.id,
            checked: selected,
            onchange: () => {
              if (!greetingTouched) {
                greetingInput.value = personalGreeting(persona);
              }
              if (!nameTouched) archiveName.value = '';
              selectedPersonaId = persona.id;
              buildPersonaChoices();
              updatePreview();
            },
          }),
          avatar(persona, { size: 'md' }),
          h(
            'span',
            { class: 'choice-copy' },
            h(
              'span',
              { class: 'choice-title-row' },
              h('strong', { text: persona.name }),
              h('span', { class: 'choice-age', text: persona.age ? `${persona.age} 岁` : '' }),
            ),
            h('span', { class: 'choice-sub', text: persona.identity }),
            h(
              'span',
              { class: 'choice-tags' },
              ...(persona.tags || []).slice(0, 3).map((tagText) => tag(tagText, 'neutral')),
            ),
          ),
          h('span', { class: 'choice-check' }, icon('check')),
        );
        return label;
      }),
    );
  }

  function personalGreeting(persona) {
    return personalizeGreeting(persona.greeting || '', { name: playerName.value || '{player}' }, persona);
  }

  function getPersona() {
    return state.personas.find((persona) => persona.id === selectedPersonaId) || state.personas[0];
  }

  function currentWorldbook() {
    return state.worldbooks.find((worldbook) => worldbook.id === worldbookSelect.value) || null;
  }

  function updateWorldbookPreview() {
    const target = page.querySelector('.worldbook-inline-preview');
    const worldbook = currentWorldbook();
    if (!target) return;
    target.replaceChildren(
      worldbook
        ? h(
            'div',
            { class: 'worldbook-preview-inline' },
            h('span', { class: 'worldbook-glyph' }, icon('book')),
            h(
              'div',
              {},
              h('strong', { text: worldbook.name }),
              h('p', { text: truncateText(worldbook.description, 150) }),
              h('span', {
                class: 'muted small',
                text: `${worldbook.entries.length} 个条目 · 相关性挑选后进入提示词`,
              }),
            ),
          )
        : h('p', {
            class: 'muted small',
            text: '不使用世界书也可以对话；AI 会主要依靠人格与当前状态。',
          }),
    );
  }

  function updatePreview() {
    const persona = getPersona();
    const worldbook = currentWorldbook();
    const greeting = greetingInput.value.trim() || personalGreeting(persona);
    const name = archiveName.value.trim() || `${persona?.name || '我们'}的故事`;
    const color = safeColor(persona?.dialogue?.color, '#c56b57');
    const animation = persona?.dialogue?.animation || 'none';

    previewCard.replaceChildren(
      h(
        'div',
        { class: 'preview-sticky' },
        h(
          'div',
          { class: 'preview-head' },
          h('p', { class: 'eyebrow', text: '故事预览' }),
          h(
            'button',
            {
              class: 'btn btn-primary btn-block',
              type: 'submit',
              form: 'create-archive-form',
            },
            icon('spark'),
            h('span', { text: '创建并开始' }),
          ),
        ),
        h(
          'div',
          { class: 'preview-scene', style: { '--preview-accent': color } },
          h('span', { class: 'preview-grain', 'aria-hidden': 'true' }),
          h(
            'div',
            { class: 'preview-persona-line' },
            avatar(persona, { size: 'md' }),
            h(
              'div',
              {},
              h('strong', { text: persona?.name || '人格' }),
              h('span', { text: persona?.identity || '' }),
            ),
          ),
          h(
            'div',
            { class: 'preview-chat' },
            h(
              'div',
              {
                class: `bubble assistant-bubble anim-${animation} preview-bubble`,
                style: { '--persona-color': color },
              },
              h('p', {
                text: appendEmojiTail(
                  truncateText(greeting, 150),
                  persona,
                  `${persona?.id}:preview`,
                ),
              }),
            ),
            h(
              'div',
              { class: 'bubble user-bubble preview-user-bubble' },
              h('p', { text: playerName.value.trim() ? '（第一句话由你说）' : '（等你说第一句话）' }),
            ),
          ),
          h(
            'div',
            { class: 'preview-world' },
            worldbook
              ? h('span', { class: 'preview-world-tag' }, icon('book'), h('span', { text: worldbook.name }))
              : h('span', { class: 'preview-world-tag muted' }, icon('moon'), h('span', { text: '无世界书' })),
            h('span', { class: 'preview-world-tag' }, icon('user'), h('span', { text: playerName.value.trim() || '未命名主人公' })),
          ),
        ),
        h(
          'div',
          { class: 'preview-summary' },
          h('h3', { text: name }),
          h(
            'p',
            {},
            h('span', { text: '称呼：' }),
            h('strong', { text: persona?.address || '你' }),
          ),
          h(
            'p',
            {},
            h('span', { text: '对话颜色：' }),
            h('span', { class: 'inline-color-dot', style: { background: color } }),
            h('span', { text: color }),
          ),
          h(
            'p',
            { class: 'muted small' },
            '创建存档本身不调用 AI，也不消耗 token。',
          ),
        ),
      ),
    );
  }

  function createArchive() {
    if (creating) return;
    const persona = getPersona();
    if (!persona) {
      toastError('当前没有可用人格，请先创建一个人格。');
      return;
    }
    if (!playerName.value.trim()) {
      playerName.focus();
      toastError('请先写下主人公的姓名。');
      return;
    }
    const worldbook = currentWorldbook();
    const extras = Array.from(extrasContainer.querySelectorAll('.repeater-row'))
      .map((row) => {
        const [labelField, valueField] = row.querySelectorAll('input');
        return { label: labelField?.value, value: valueField?.value };
      })
      .filter((extra) => extra.label?.trim() && extra.value?.trim());

    const protagonist = normalizeProtagonist({
      name: playerName.value,
      age: playerAge.value,
      identity: playerIdentity.value,
      likes: playerLikes.value,
      extras,
    });
    const greeting =
      greetingInput.value.trim() ||
      personalizeGreeting(persona.greeting || '', protagonist, persona);
    const archive = createArchiveRecord({
      name: archiveName.value.trim() || `${persona.name}的故事`,
      persona,
      worldbook,
      protagonist,
      greeting,
      openingStatus: buildInitialStatus(persona, worldbook),
    });

    creating = true;
    app.store.addArchive(archive);
    app.store.info('archive.created', `创建了存档「${archive.name}」。`, {
      archiveId: archive.id,
      detail: {
        persona: persona.name,
        worldbook: worldbook?.name || null,
        player: protagonist.name,
      },
    });
    toastSuccess('新故事已经开始。', '存档已创建');
    app.navigate('chat');
  }

  /* ------------------------------ 初始化 ------------------------------ */

  for (const element of [playerName, playerAge, playerIdentity, playerLikes, greetingInput]) {
    element.addEventListener('input', () => {
      if (element === greetingInput) {
        greetingTouched = true;
      } else if (element === playerName && !greetingTouched) {
        // 开场白里可能含有 {player}，主人公开写姓名时同步替换。
        greetingInput.value = personalGreeting(getPersona());
      }
      updatePreview();
    });
  }
  greetingInput.addEventListener('input', () => {
    greetingTouched = true;
  });
  worldbookSelect.addEventListener('change', () => {
    selectedWorldbookId = worldbookSelect.value;
    updateWorldbookPreview();
    updatePreview();
  });

  buildPersonaChoices();
  const initialPersona = getPersona();
  greetingInput.value = personalGreeting(initialPersona);
  addExtra();
  updateWorldbookPreview();
  updatePreview();

  return { cleanup() {} };
}
