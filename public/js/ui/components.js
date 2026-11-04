/** 可复用 UI 片段与安全富文本渲染。 */

import { h, icon } from './dom.js';
import { safeColor, truncateText } from '../core/utils.js';

export function avatar(persona, { size = 'md', user = false, name = '' } = {}) {
  const displayName = name || persona?.name || '?';
  const initial = Array.from(displayName.trim())[0] || '屿';
  const color = safeColor(user ? '#b98f78' : persona?.dialogue?.color, '#c56b57');
  return h(
    'span',
    {
      class: `avatar avatar-${size} ${user ? 'avatar-user' : ''}`.trim(),
      style: { '--avatar-color': color },
      'aria-hidden': 'true',
    },
    h('span', { class: 'avatar-glow' }),
    h('span', { class: 'avatar-initial', text: initial }),
  );
}

export function tag(text, tone = 'neutral') {
  return h('span', { class: `tag tag-${tone}`, text: String(text) });
}

export function tagList(tags, { max = 4 } = {}) {
  return h(
    'span',
    { class: 'tag-list' },
    ...(tags || []).slice(0, max).map((item) => tag(item)),
  );
}

export function field({
  label,
  hint = '',
  required = false,
  control,
  htmlFor = '',
  className = '',
  compact = false,
}) {
  return h(
    'label',
    { class: `field ${compact ? 'field-compact' : ''} ${className}`.trim(), for: htmlFor || undefined },
    h(
      'span',
      { class: 'field-label' },
      label,
      required ? h('span', { class: 'required-mark', text: ' *', 'aria-hidden': 'true' }) : null,
    ),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null,
  );
}

export function input({
  id = '',
  name = '',
  type = 'text',
  value = '',
  placeholder = '',
  required = false,
  autofocus = false,
  maxLength = null,
  min = null,
  max = null,
  step = null,
  autocomplete = 'off',
  onInput = null,
  onChange = null,
  className = '',
  ...rest
} = {}) {
  return h('input', {
    id: id || undefined,
    name: name || undefined,
    type,
    value,
    placeholder,
    required,
    autofocus,
    maxlength: maxLength ?? undefined,
    min: min ?? undefined,
    max: max ?? undefined,
    step: step ?? undefined,
    autocomplete,
    class: `input ${className}`.trim(),
    onInput,
    onChange,
    ...rest,
  });
}

export function textarea({
  id = '',
  name = '',
  value = '',
  placeholder = '',
  required = false,
  rows = 4,
  maxLength = null,
  autofocus = false,
  onInput = null,
  className = '',
  ...rest
} = {}) {
  const element = h('textarea', {
    id: id || undefined,
    name: name || undefined,
    placeholder,
    required,
    rows,
    maxlength: maxLength ?? undefined,
    autofocus,
    class: `input textarea ${className}`.trim(),
    onInput,
    ...rest,
  });
  element.value = value;
  return element;
}

export function select({
  id = '',
  name = '',
  value = '',
  options = [],
  onChange = null,
  className = '',
  disabled = false,
  ...rest
} = {}) {
  const element = h('select', {
    id: id || undefined,
    name: name || undefined,
    class: `input select ${className}`.trim(),
    onChange,
    disabled,
    ...rest,
  });
  for (const option of options) {
    const optionElement = h('option', {
      value: option.value,
      disabled: option.disabled,
      text: option.label,
    });
    if (String(option.value) === String(value)) optionElement.selected = true;
    element.appendChild(optionElement);
  }
  return element;
}

export function checkbox({
  id = '',
  name = '',
  label,
  checked = false,
  description = '',
  onChange = null,
  disabled = false,
}) {
  const inputElement = h('input', {
    id: id || undefined,
    name: name || undefined,
    type: 'checkbox',
    checked,
    disabled,
    onChange,
  });
  return h(
    'label',
    { class: `check-field ${disabled ? 'is-disabled' : ''}`.trim(), for: id || undefined },
    inputElement,
    h('span', { class: 'check-box', 'aria-hidden': 'true' }, icon('check')),
    h(
      'span',
      { class: 'check-copy' },
      h('span', { class: 'check-label', text: label }),
      description ? h('span', { class: 'check-desc', text: description }) : null,
    ),
  );
}

export function emptyState({ iconName = 'spark', title, body = '', actions = null, className = '' }) {
  return h(
    'div',
    { class: `empty-state ${className}`.trim() },
    h('span', { class: 'empty-icon' }, icon(iconName)),
    h('h3', { class: 'empty-title', text: title }),
    body ? h('p', { class: 'empty-body', text: body }) : null,
    actions ? h('div', { class: 'empty-actions' }, actions) : null,
  );
}

export function pageHeader({ eyebrow = '', title, lede = '', actions = null, className = '' }) {
  return h(
    'header',
    { class: `page-head ${className}`.trim() },
    h(
      'div',
      { class: 'page-head-copy' },
      eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
      h('h1', { class: 'page-title', text: title }),
      lede ? h('p', { class: 'page-lede', text: lede }) : null,
    ),
    actions ? h('div', { class: 'page-actions' }, actions) : null,
  );
}

export function loadingBlock(label = '正在加载…') {
  return h(
    'div',
    { class: 'loading-block', role: 'status' },
    h('span', { class: 'spinner' }),
    h('span', { text: label }),
  );
}

export function sectionTitle(title, { eyebrow = '', aside = null } = {}) {
  return h(
    'div',
    { class: 'section-title-row' },
    h(
      'div',
      {},
      eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
      h('h2', { class: 'section-title', text: title }),
    ),
    aside,
  );
}

/**
 * 安全的轻量 Markdown 渲染：段落、换行、粗体、斜体、行内代码、引用对白。
 * 永远不解析原始 HTML。
 */
export function richText(text, { className = '' } = {}) {
  const root = h('div', { class: `rich-text ${className}`.trim() });
  const source = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!source) return root;
  if (source.length > 20_000) {
    // 超长百科/导出正文避免一次创建大量行内节点导致主线程卡住。
    root.classList.add('stream-plain-text');
    root.textContent = source;
    return root;
  }

  const blocks = source.split(/\n{2,}/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-•]\s+/.test(line))) {
      const list = h('ul', { class: 'rich-list' });
      for (const line of lines) {
        const item = h('li');
        appendInline(item, line.replace(/^\s*[-•]\s+/, ''));
        list.appendChild(item);
      }
      root.appendChild(list);
      continue;
    }

    const paragraph = h('p', { class: 'rich-paragraph' });
    lines.forEach((line, index) => {
      if (index > 0) paragraph.appendChild(h('br'));
      if (/^>\s?/.test(line)) {
        const quote = h('span', { class: 'rich-quote' });
        appendInline(quote, line.replace(/^>\s?/, ''));
        paragraph.appendChild(quote);
      } else {
        appendInline(paragraph, line);
      }
    });
    root.appendChild(paragraph);
  }
  return root;
}

function appendInline(parent, text) {
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|“[^”\n]+”|「[^」\n]+」)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      parent.appendChild(h('strong', { text: token.slice(2, -2) }));
    } else if (token.startsWith('*')) {
      parent.appendChild(h('em', { text: token.slice(1, -1) }));
    } else if (token.startsWith('`')) {
      parent.appendChild(h('code', { class: 'inline-code', text: token.slice(1, -1) }));
    } else {
      parent.appendChild(h('span', { class: 'spoken', text: token }));
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

export function keyValueList(items, { className = '' } = {}) {
  return h(
    'dl',
    { class: `kv-list ${className}`.trim() },
    ...items
      .filter((item) => item && item.value)
      .flatMap((item) => [
        h('dt', { text: item.label }),
        h('dd', { text: String(item.value) }),
      ]),
  );
}

export function compactSnippet(text, max = 80) {
  return truncateText(String(text || '').replace(/\s+/g, ' '), max);
}

export function iconText(iconName, text, className = '') {
  return h(
    'span',
    { class: `icon-text ${className}`.trim() },
    icon(iconName),
    h('span', { text }),
  );
}

export function divider(label = '') {
  return h(
    'div',
    { class: `divider ${label ? 'divider-labeled' : ''}`.trim(), role: 'separator' },
    label ? h('span', { text: label }) : null,
  );
}
