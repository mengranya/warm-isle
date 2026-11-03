/**
 * API Key 本地保险箱。
 *
 * - 使用 WebCrypto AES-GCM 加密。
 * - 主密钥以 non-extractable CryptoKey 的形式保存在 IndexedDB，无法导出。
 * - 未勾选“记住”的 Key 只放 sessionStorage，关闭标签页即清除。
 *
 * 说明：这能避免明文直接出现在 LocalStorage 中，但无法抵御同源 XSS。
 * 因此项目不使用第三方脚本，并设置了严格 CSP。
 */

import { STORAGE } from '../core/constants.js';

let masterKeyPromise = null;

function openVaultDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('当前环境无法使用本地密钥保险箱。'));
      return;
    }
    const request = indexedDB.open(STORAGE.vaultDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORAGE.vaultStoreName)) {
        db.createObjectStore(STORAGE.vaultStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开密钥保险箱。'));
  });
}

function getOrCreateMasterKey() {
  if (masterKeyPromise) return masterKeyPromise;
  masterKeyPromise = (async () => {
    if (!globalThis.crypto?.subtle) {
      throw new Error('当前环境不支持 WebCrypto，无法安全保存 API Key。');
    }
    const db = await openVaultDb();
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORAGE.vaultStoreName, 'readonly');
      const request = tx.objectStore(STORAGE.vaultStoreName).get('master');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('读取密钥失败。'));
    });
    if (existing) {
      db.close();
      return existing;
    }

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // 不可导出
      ['encrypt', 'decrypt'],
    );
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORAGE.vaultStoreName, 'readwrite');
      tx.objectStore(STORAGE.vaultStoreName).put(key, 'master');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('保存主密钥失败。'));
    });
    db.close();
    return key;
  })().catch((error) => {
    masterKeyPromise = null;
    throw error;
  });
  return masterKeyPromise;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encryptSecret(plaintext) {
  if (!plaintext) return '';
  const key = await getOrCreateMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload) {
  if (!payload) return '';
  const parts = String(payload).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('密钥密文格式不正确。');
  }
  const key = await getOrCreateMasterKey();
  const iv = base64ToBytes(parts[1]);
  const cipher = base64ToBytes(parts[2]);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export function readSessionKeys() {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE.sessionKeysKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSessionKeys(keys) {
  try {
    if (!keys || !Object.keys(keys).length) {
      globalThis.sessionStorage?.removeItem(STORAGE.sessionKeysKey);
      return;
    }
    globalThis.sessionStorage?.setItem(STORAGE.sessionKeysKey, JSON.stringify(keys));
  } catch {
    /* sessionStorage 不可用时静默降级为仅当前页面内存 */
  }
}

/** 从加密字段 + 会话字段恢复当前页面可用的 Key 映射。 */
export async function hydrateKeys(settings) {
  const keys = { ...readSessionKeys() };
  const failures = [];

  for (const [provider, cipher] of Object.entries(settings?.keyVault || {})) {
    try {
      const plaintext = await decryptSecret(cipher);
      if (plaintext) keys[provider] = plaintext;
    } catch (error) {
      failures.push({ provider, message: error?.message || '解密失败' });
    }
  }
  return { keys, failures };
}

/**
 * 持久化某个提供商的 Key。
 * @returns {Promise<string|null>} 写入 settings.keyVault 的密文，未记住时为 null。
 */
export async function persistKey(provider, plaintext, remember) {
  const sessionKeys = readSessionKeys();
  if (remember) {
    if (!plaintext) {
      delete sessionKeys[provider];
      writeSessionKeys(sessionKeys);
      return null;
    }
    const cipher = await encryptSecret(plaintext);
    delete sessionKeys[provider];
    writeSessionKeys(sessionKeys);
    return cipher;
  }

  if (plaintext) sessionKeys[provider] = plaintext;
  else delete sessionKeys[provider];
  writeSessionKeys(sessionKeys);
  return null;
}

export async function forgetKey(provider) {
  const sessionKeys = readSessionKeys();
  delete sessionKeys[provider];
  writeSessionKeys(sessionKeys);
}

export function maskKey(key) {
  const value = String(key || '').trim();
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}
