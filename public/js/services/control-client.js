/**
 * 控制台连接：同源心跳、启用中的通告。
 * 客户端无需填写地址；Node/Worker 同源代理负责转发到控制台。
 */
import { APP_VERSION } from '../core/constants.js';

const DEVICE_KEY = 'warm-isle:control-device';
const SEEN_PREFIX = 'warm-isle:control-seen:';
const HEARTBEAT_MS = 10_000;

function makeDeviceId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function getDeviceId() {
  try {
    const saved = globalThis.localStorage?.getItem(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,80}$/.test(saved)) return saved;
    const next = makeDeviceId();
    globalThis.localStorage?.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return makeDeviceId();
  }
}

function controlEndpoint() {
  // 始终走同源代理；Node/Worker 再转发到控制台，访客无需填写任何地址。
  return '/api/control/heartbeat';
}

function showAnnouncement(announcement) {
  if (!announcement?.title || document.querySelector('[data-warm-announcement]')) return;
  const overlay = document.createElement('div');
  overlay.dataset.warmAnnouncement = announcement.id || '1';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'display:grid',
    'place-items:center',
    'padding:22px',
    'background:rgba(35,24,18,.42)',
    'backdrop-filter:blur(4px)',
  ].join(';');
  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(440px,100%)',
    'max-height:min(70vh,520px)',
    'overflow:auto',
    'padding:24px',
    'border:1px solid rgba(205,177,145,.7)',
    'border-radius:18px',
    'background:#fffaf1',
    'box-shadow:0 24px 70px rgba(58,34,20,.24)',
    'color:#49372d',
    'font:14px/1.8 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
  ].join(';');
  const kicker = document.createElement('div');
  kicker.textContent = announcement.mode === 'forced' ? '系统通告' : '来自暖屿的留言';
  kicker.style.cssText = 'font-size:10px;letter-spacing:.15em;color:#a2765d;margin-bottom:6px;';
  const title = document.createElement('h2');
  title.textContent = announcement.title;
  title.style.cssText = 'margin:0 0 12px;font-size:22px;line-height:1.35;color:#3f2e25;';
  const body = document.createElement('p');
  body.textContent = announcement.body || '';
  body.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:#574338;';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '知道了';
  close.style.cssText = [
    'display:block',
    'margin:20px 0 0 auto',
    'padding:9px 20px',
    'border:0',
    'border-radius:999px',
    'background:#b7654f',
    'color:#fff',
    'font:600 13px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
    'cursor:pointer',
  ].join(';');
  close.addEventListener('click', () => overlay.remove());
  card.append(kicker, title, body, close);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  close.focus();
}

export function startControlClient(app) {
  if (!app?.store) return () => {};
  const deviceId = getDeviceId();
  let stopped = false;
  let timer = null;
  let initial = true;
  let running = false;
  const seen = new Set();

  const readSeen = (id) => {
    if (seen.has(id)) return true;
    try {
      if (sessionStorage.getItem(SEEN_PREFIX + id) === '1') {
        seen.add(id);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  };
  const markSeen = (id) => {
    seen.add(id);
    try {
      sessionStorage.setItem(SEEN_PREFIX + id, '1');
    } catch {
      /* ignore */
    }
  };

  async function heartbeat() {
    if (stopped || running || document.visibilityState === 'hidden') return;
    const archive = app.store.getActiveArchive();
    const persona = archive ? app.store.getPersona(archive.personaId) : null;
    const payload = {
      deviceId,
      appVersion: APP_VERSION,
      personaName: persona?.name || '',
      archiveName: archive?.name || '',
      route: window.location.hash.replace(/^#\/?/, '') || 'archives',
      platform: navigator.platform || '',
      language: navigator.language || '',
      userAgent: navigator.userAgent || '',
      screen: `${screen.width || 0}x${screen.height || 0}`,
    };
    running = true;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(controlEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return;
      const body = await response.json().catch(() => null);
      const announcements = Array.isArray(body?.announcements) ? body.announcements : [];
      for (const item of announcements) {
        if (!item?.id || readSeen(item.id)) continue;
        if (initial && item.mode === 'startup') {
          markSeen(item.id);
          showAnnouncement(item);
          break;
        }
        if (item.mode === 'forced') {
          markSeen(item.id);
          showAnnouncement(item);
          break;
        }
      }
      initial = false;
    } catch {
      /* 控制台离线时静默，不影响主应用 */
    } finally {
      clearTimeout(abortTimer);
      running = false;
    }
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      heartbeat().finally(schedule);
    }, HEARTBEAT_MS);
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') heartbeat();
  };
  const onPageHide = () => {
    try {
      navigator.sendBeacon?.(
        controlEndpoint(),
        new Blob([JSON.stringify({ deviceId, appVersion: APP_VERSION, route: 'offline' })], {
          type: 'application/json',
        }),
      );
    } catch {
      /* ignore */
    }
  };

  setTimeout(heartbeat, 1_200);
  schedule();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onPageHide);
  };
}
