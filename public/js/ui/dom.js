/**
 * 无依赖 DOM 工具。
 * h() 只通过 textContent 写入文本，默认不解释 HTML，从结构上避免 XSS。
 */

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const ICON_PATHS = {
  chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9a7.5 7.5 0 0 1 7.5-7.5h2A7.5 7.5 0 0 1 20 11.5Z"/><path d="M8 10h6M8 13.5h4"/>',
  archive: '<path d="M4 7.5h16v12H4z"/><path d="M3 4.5h18v3H3zM9 11.5h6"/>',
  persona: '<circle cx="12" cy="8.5" r="3.3"/><path d="M5.5 19c.7-3.2 3.3-5.1 6.5-5.1s5.8 1.9 6.5 5.1"/>',
  book: '<path d="M5 4.8A2.8 2.8 0 0 1 7.8 2H20v17.5H7.8A2.8 2.8 0 0 0 5 22V4.8Z"/><path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H20M9 6h7"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v5"/>',
  journal: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06A1.7 1.7 0 0 0 15.74 18a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V20h-3v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H4v-3h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06A1.7 1.7 0 0 0 9.36 6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V4h3v.1a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 18 9.36a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4H20v3h-.1a1.7 1.7 0 0 0-1.6 1.1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 17V5M7 10l5-5 5 5M5 21h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16v4ZM13.5 6.5l4 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  send: '<path d="m21 3-7.5 18-3.2-7.3L3 10.5 21 3Z"/><path d="m10.3 13.7 4.2-4.2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  spark: '<path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
  heart: '<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>',
  shirt: '<path d="m8 4-5 3 2.2 4L8 10v10h8V10l2.8 1L21 7l-5-3-1.5 2h-5L8 4Z"/>',
  pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  motion: '<path d="M4 17c4 0 4-10 8-10s4 10 8 10"/><path d="M5 21h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.2 1.8"/>',
  brain: '<path d="M9 4a3 3 0 0 0-5 2.2A3 3 0 0 0 4.5 12a3 3 0 0 0 3 3.5A3 3 0 0 0 12 18V6a3 3 0 0 0-3-2ZM15 4a3 3 0 0 1 5 2.2 3 3 0 0 1-.5 5.8 3 3 0 0 1-3 3.5A3 3 0 0 1 12 18V6a3 3 0 0 1 3-2Z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c.8-4 3.5-6 7-6s6.2 2 7 6"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c.5-3.5 2.8-5.5 6-5.5s5.5 2 6 5.5M16 5.3a2.8 2.8 0 0 1 0 5.4M18 14.8c2 .6 3.4 2.2 3.8 5.2"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="12" cy="12" r="1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8.2A7 7 0 0 1 19 10M17.9 15.8A7 7 0 0 1 5 14"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="m3 3 18 18M10.6 6.2A11.6 11.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 2.8M6.7 6.8C4 8.5 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-1M10 10a2.8 2.8 0 0 0 4 4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17.5v.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.2"/>',
  shield: '<path d="M12 3 4.5 6v6c0 5 3.2 8 7.5 9 4.3-1 7.5-4 7.5-9V6L12 3Z"/><path d="m8.5 12 2.4 2.4 4.6-5"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  wand: '<path d="m4 20 11-11M13 5l1.5-2L16 5l2-1.5L17 6l2 1.5-2 1L16 11l-1-2.5L12 8l2-1.5L13 5ZM5 5h4M7 3v4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1-1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  coffee: '<path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8ZM17 10h2a2.5 2.5 0 0 1 0 5h-2M7 3v2M11 3v2M15 3v2"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
  save: '<path d="M4 4h13l3 3v13H4V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
  terminal: '<path d="m5 7 4 4-4 4M11 17h8"/>',
  star: '<path d="m12 3 2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.7 6.7 19.5l1.1-6L3.4 9.3l6-.8L12 3Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z"/>',
  scroll: '<path d="M7 4h12v14a2 2 0 0 0 2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 0-2-2h2Z"/><path d="M7 4a2 2 0 0 0-2 2v14M19 20a2 2 0 0 0 2-2V4M10 8h7M10 12h7M10 16h4"/>',
  castle: '<path d="M4 21V8l3-2v4h3V6l2-2 2 2v4h3V6l3 2v13H4Z"/><path d="M9 21v-5h6v5M8 11h.01M16 11h.01"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
  bag: '<path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2M9 12h6"/>',
  swords: '<path d="m4 4 10 10M4 4h5M4 4v5M20 4 10 14M20 4h-5M20 4v5M6 18l-2 2M18 18l2 2M8 16l-2 2M16 16l2 2"/>',
  crown: '<path d="m3 8 4 3 5-6 5 6 4-3-2 11H5L3 8Z"/><path d="M6 22h12"/>',
  scrollText: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  footprints: '<path d="M8 3c2 0 3 2 3 4s-1 4-3 4-3-2-3-4 1-4 3-4ZM8 13c2 0 3 2 3 4s-1 4-3 4-3-2-3-4 1-4 3-4ZM17 7c1.5 0 2 1.5 2 3s-.5 3-2 3-2-1.5-2-3 .5-3 2-3ZM17 16c1.5 0 2 1.2 2 2.5S18.5 21 17 21s-2-1.2-2-2.5.5-2.5 2-2.5Z"/>',
  cornerDownLeft: '<path d="M9 10 4 15l5 5"/><path d="M4 15h10a6 6 0 0 0 6-6V5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
};

/**
 * 创建 DOM 元素。
 * @param {string} tag
 * @param {object} props
 * @param {...any} children
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  if (!props || typeof props !== 'object' || Array.isArray(props) || props instanceof Node) {
    if (props !== null && props !== undefined) children.unshift(props);
    props = {};
  }

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      element.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'text') {
      element.textContent = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [property, styleValue] of Object.entries(value)) {
        if (styleValue === null || styleValue === undefined) continue;
        if (property.startsWith('--')) element.style.setProperty(property, String(styleValue));
        else element.style[property] = String(styleValue);
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        element.dataset[dataKey] = String(dataValue);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      // 只允许项目内部可信图标使用；业务文本请用 text / children。
      element.innerHTML = String(value);
    } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled') {
      element[key] = value;
    } else if (key === 'for') {
      element.htmlFor = String(value);
    } else {
      element.setAttribute(key, String(value));
    }
  }

  appendChildren(element, children);
  return element;
}

function appendChildren(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export function fragment(...children) {
  const result = document.createDocumentFragment();
  appendChildren(result, children);
  return result;
}

export function clear(element) {
  while (element?.firstChild) element.removeChild(element.firstChild);
  return element;
}

export function replaceChildren(element, ...children) {
  clear(element);
  appendChildren(element, children);
  return element;
}

export function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.innerHTML = ICON_PATHS[name] || ICON_PATHS.spark;
  return svg;
}

/** 品牌 logo，与 favicon 视觉一致。 */
export function brandMark(className = '') {
  return h(
    'span',
    { class: `inline-brand-mark ${className}`.trim(), 'aria-hidden': 'true' },
    h('span', { class: 'inline-brand-sun' }),
    h('span', { class: 'inline-brand-sea' }),
  );
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function on(target, eventName, handler, options) {
  if (!target) return () => {};
  target.addEventListener(eventName, handler, options);
  return () => target.removeEventListener(eventName, handler, options);
}

export function autoGrow(textarea, maxHeight = 180) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const next = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${next}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

export function isNearBottom(element, threshold = 120) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

export function scrollToBottom(element, behavior = 'smooth') {
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior });
}

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let success = false;
    try {
      success = document.execCommand('copy');
    } catch {
      success = false;
    }
    textarea.remove();
    return success;
  }
}

export function readFormValue(form, name) {
  return form?.elements?.namedItem(name)?.value ?? '';
}

export function setButtonBusy(button, busy, busyLabel = '处理中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

export function setFieldError(input, message) {
  if (!input) return;
  const wrapper = input.closest('.field');
  if (!wrapper) return;
  wrapper.classList.toggle('has-error', Boolean(message));
  let error = wrapper.querySelector('.field-error');
  if (message) {
    if (!error) {
      error = h('p', { class: 'field-error' });
      wrapper.appendChild(error);
    }
    error.textContent = message;
  } else if (error) {
    error.remove();
  }
}

export function debounceFrame(fn) {
  let frame = 0;
  return (...args) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => fn(...args));
  };
}

export { SVG_ATTRS };
