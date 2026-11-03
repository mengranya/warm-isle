/** 原生 <dialog> 封装：焦点管理、ESC、遮罩关闭与异步按钮状态。 */

import { h, icon } from './dom.js';
import { toastError } from './toast.js';

let currentModal = null;

function getModalRoot() {
  let root = document.getElementById('modal-root');
  if (!root) {
    root = h('div', { id: 'modal-root' });
    document.body.appendChild(root);
  }
  return root;
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string=} options.eyebrow
 * @param {string=} options.subtitle
 * @param {Node|Node[]} options.body
 * @param {Array<object>=} options.actions
 * @param {'sm'|'md'|'lg'|'xl'} options.size
 * @param {boolean=} options.dismissible
 * @param {Function=} options.onClose
 */
export function openModal({
  title,
  eyebrow = '',
  subtitle = '',
  body = null,
  actions = [],
  size = 'md',
  dismissible = true,
  onClose = null,
}) {
  if (currentModal) currentModal.close({ reason: 'replaced' });

  const titleId = `modal-title-${Date.now().toString(36)}`;
  const bodyElement = h('div', { class: 'modal-body' });
  const footer = h('footer', { class: 'modal-actions' });
  const closeButton = h(
    'button',
    {
      class: 'icon-btn modal-close',
      type: 'button',
      'aria-label': '关闭',
    },
    icon('x'),
  );

  const dialog = h('dialog', {
    class: `modal modal-${size}`,
    'aria-labelledby': titleId,
  });

  const card = h(
    'div',
    { class: 'modal-card' },
    h(
      'header',
      { class: 'modal-head' },
      h(
        'div',
        { class: 'modal-heading' },
        eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
        h('h2', { id: titleId, class: 'modal-title', text: title }),
        subtitle ? h('p', { class: 'modal-subtitle', text: subtitle }) : null,
      ),
      closeButton,
    ),
    bodyElement,
    footer,
  );
  dialog.appendChild(card);
  getModalRoot().appendChild(dialog);
  document.body.classList.add('modal-open');

  if (body) {
    if (Array.isArray(body)) bodyElement.append(...body.filter(Boolean));
    else bodyElement.appendChild(body);
  }

  let busy = false;
  let closed = false;
  const actionButtons = [];

  const cleanup = (reason = 'close') => {
    if (closed) return;
    closed = true;
    document.body.classList.remove('modal-open');
    if (currentModal?.dialog === dialog) currentModal = null;
    try {
      onClose?.(reason);
    } catch (error) {
      console.error('onClose 回调异常：', error);
    }
    dialog.remove();
  };

  const close = (value = {}) => {
    if (busy) return false;
    if (dialog.open) dialog.close();
    else cleanup('closed');
    return true;
  };

  const controller = {
    dialog,
    card,
    body: bodyElement,
    footer,
    close,
    setBusy(nextBusy, label = '处理中…') {
      busy = Boolean(nextBusy);
      dialog.classList.toggle('is-busy', busy);
      closeButton.disabled = busy;
      for (const button of actionButtons) {
        button.disabled = busy || button.dataset.wasDisabled === 'true';
        if (busy && button.classList.contains('btn-primary')) {
          if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
          button.textContent = label;
        } else if (!busy && button.dataset.idleLabel) {
          button.textContent = button.dataset.idleLabel;
          delete button.dataset.idleLabel;
        }
      }
    },
    setTitle(nextTitle) {
      dialog.querySelector('.modal-title').textContent = nextTitle;
    },
    setActions(nextActions) {
      renderActions(nextActions);
    },
  };

  function renderActions(nextActions = []) {
    footer.replaceChildren();
    actionButtons.length = 0;
    if (!nextActions.length) {
      footer.hidden = true;
      return;
    }
    footer.hidden = false;
    for (const action of nextActions) {
      const button = h(
        'button',
        {
          class: `btn ${action.variant === 'primary' ? 'btn-primary' : action.variant === 'danger' ? 'btn-danger' : 'btn-ghost'} ${action.className || ''}`.trim(),
          type: action.type || 'button',
          disabled: Boolean(action.disabled),
        },
        action.icon ? icon(action.icon) : null,
        h('span', { text: action.label || '确定' }),
      );
      if (action.disabled) button.dataset.wasDisabled = 'true';
      button.addEventListener('click', async () => {
        if (busy || button.disabled) return;
        if (!action.onClick) {
          close();
          return;
        }
        const originalLabel = button.querySelector('span')?.textContent;
        button.classList.add('is-busy');
        button.disabled = true;
        try {
          const result = await action.onClick(controller);
          if (result === false) {
            button.classList.remove('is-busy');
            button.disabled = false;
            return;
          }
          if (action.closeAfter !== false) close();
          else {
            button.classList.remove('is-busy');
            button.disabled = false;
            if (originalLabel && button.querySelector('span')) {
              button.querySelector('span').textContent = originalLabel;
            }
          }
        } catch (error) {
          console.error(error);
          toastError(error?.message || '操作失败，请稍后重试。');
          button.classList.remove('is-busy');
          button.disabled = false;
        }
      });
      actionButtons.push(button);
      footer.appendChild(button);
    }
  }

  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', (event) => {
    if (!dismissible || busy) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    close({ reason: 'cancel' });
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && dismissible && !busy) close({ reason: 'backdrop' });
  });
  dialog.addEventListener('close', () => cleanup('closed'));

  renderActions(actions);
  currentModal = controller;
  dialog.showModal();

  requestAnimationFrame(() => {
    const autoFocus = dialog.querySelector('[autofocus], input:not([type="hidden"]), textarea, select');
    (autoFocus || closeButton)?.focus();
  });

  return controller;
}

export function closeModal() {
  currentModal?.close();
}

export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  eyebrow = '',
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const modal = openModal({
      title,
      eyebrow,
      size: 'sm',
      body: h('p', { class: 'confirm-message', text: message }),
      actions: [
        {
          label: cancelText,
          variant: 'ghost',
          onClick: () => {
            finish(false);
          },
        },
        {
          label: confirmText,
          variant: danger ? 'danger' : 'primary',
          onClick: () => {
            finish(true);
          },
        },
      ],
      onClose: () => finish(false),
    });
    modal.dialog.addEventListener('close', () => finish(false), { once: true });
  });
}

export function isModalOpen() {
  return Boolean(currentModal);
}
