/**
 * 暖屿 · 手机版通用行为。
 *
 * 只处理纯移动端增强：
 * - iOS/Android 动态视口高度与软键盘；
 * - 侧栏/状态抽屉的滑动关闭；
 * - 触屏设备标记。
 *
 * 不修改任何存档数据，也不介入桌面布局。
 */

(() => {
  // iOS 15.4 以下没有 Array.prototype.at；补一个等价实现。
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value(index) {
        const length = this.length >>> 0;
        if (!length) return undefined;
        let position = Math.trunc(Number(index)) || 0;
        if (position < 0) position += length;
        return position >= 0 && position < length ? this[position] : undefined;
      },
    });
  }

  const root = document.documentElement;
  const coarse = window.matchMedia?.('(pointer: coarse)');
  let lastVisualHeight = window.visualViewport?.height || window.innerHeight;

  function syncViewport() {
    const viewport = window.visualViewport;
    const height = Math.round(viewport?.height || window.innerHeight);
    lastVisualHeight = height;
    root.style.setProperty('--app-height', `${height}px`);
    root.classList.toggle('is-mobile', Boolean(coarse?.matches));
    const keyboardOpen = Boolean(
      coarse?.matches && window.innerHeight - height > 140,
    );
    root.classList.toggle('keyboard-open', keyboardOpen);
    document.body.classList.toggle('keyboard-open', keyboardOpen);
  }

  syncViewport();
  window.addEventListener('resize', syncViewport, { passive: true });
  window.addEventListener('orientationchange', () => {
    setTimeout(syncViewport, 120);
  });
  window.visualViewport?.addEventListener('resize', syncViewport, {
    passive: true,
  });
  window.visualViewport?.addEventListener('scroll', syncViewport, {
    passive: true,
  });
  window.addEventListener('pageshow', syncViewport, { passive: true });
  coarse?.addEventListener?.('change', syncViewport);

  let touchStart = null;
  document.addEventListener(
    'touchstart',
    (event) => {
      if (!event.touches?.length) return;
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    (event) => {
      if (!touchStart) return;
      const touch = event.changedTouches?.[0];
      const start = touchStart;
      touchStart = null;
      if (!touch || Date.now() - start.at > 700) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.4) return;

      // 左滑关闭侧栏（侧栏从左侧打开）。
      if (dx < 0 && document.body.classList.contains('sidebar-open')) {
        document.querySelector('#sidebar-scrim')?.click();
        return;
      }

      // 右滑关闭全屏状态抽屉。
      const statusPanel = document.querySelector('.status-panel.is-open');
      if (dx > 0 && statusPanel) {
        document.querySelector('.status-backdrop')?.click();
      }
    },
    { passive: true },
  );

  // 键盘收起后恢复可视高度，避免部分 Android 浏览器停留在缩小视口。
  window.addEventListener('focusout', () => {
    setTimeout(() => {
      if (Math.abs((window.visualViewport?.height || window.innerHeight) - lastVisualHeight) < 2) {
        syncViewport();
      }
    }, 80);
  });

  // PWA 安装与离线壳。HTTP 局域网访问不注册，避免浏览器安全上下文报错。
  const secureContext =
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
  if (secureContext && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // 安装失败不影响正常在线使用。
      });
    });
  }
})();
