/** 轻提示。错误信息保持可读，但不打断对话。 */

import { h, icon } from './dom.js';

const ICONS = {
  info: 'info',
  success: 'check',
  warn: 'warning',
  error: 'warning',
};

let activeToasts = [];

function getRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = h('div', { id: 'toast-region', class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(region);
  }
  return region;
}

export function dismissToast(toast) {
  if (!toast) return;
  // 立即从活跃列表移除，避免“数量达到上限 → 循环关闭同一个 toast”的死循环。
  const index = activeToasts.indexOf(toast);
  if (index >= 0) activeToasts.splice(index, 1);
  if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
  toast.classList.add('is-leaving');
  setTimeout(() => toast.remove(), 220);
}

/**
 * @param {string} message
 * @param {{type?:'info'|'success'|'warn'|'error', title?:string, duration?:number}} options
 */
export function toast(message, options = {}) {
  const type = ['info', 'success', 'warn', 'error'].includes(options.type)
    ? options.type
    : 'info';
  const duration = options.duration ?? (type === 'error' ? 7_500 : 3_800);
  const region = getRegion();

  while (activeToasts.length >= 2) {
    dismissToast(activeToasts[0]);
  }

  const element = h(
    'div',
    { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-icon' }, icon(ICONS[type])),
    h(
      'div',
      { class: 'toast-copy' },
      options.title ? h('strong', { class: 'toast-title', text: options.title }) : null,
      h('p', { class: 'toast-message', text: String(message || '') }),
    ),
    h(
      'button',
      {
        class: 'toast-close',
        type: 'button',
        'aria-label': '关闭提示',
        onclick: () => dismissToast(element),
      },
      icon('x'),
    ),
  );

  region.appendChild(element);
  activeToasts.push(element);
  requestAnimationFrame(() => element.classList.add('is-visible'));
  if (duration > 0) {
    setTimeout(() => dismissToast(element), duration);
  }
  return element;
}

export function toastError(message, title = '出了点小问题') {
  return toast(message, { type: 'error', title, duration: 8_000 });
}

export function toastSuccess(message, title = '已保存') {
  return toast(message, { type: 'success', title });
}
