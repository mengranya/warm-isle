/**
 * 持久化层。
 *
 * - 主存储：IndexedDB（容量大，不阻塞主线程）。
 * - 备份：LocalStorage + gzip 压缩（CompressionStream），用于 IndexedDB 不可用时兜底。
 * - 所有写入都做异步化与去抖，避免聊天时卡顿。
 */

import { STORAGE } from '../core/constants.js';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('当前浏览器不支持 IndexedDB。'));
      return;
    }
    const request = indexedDB.open(STORAGE.dbName, STORAGE.dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORAGE.storeName)) {
        db.createObjectStore(STORAGE.storeName);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('无法打开本地数据库。'));
    request.onblocked = () => reject(new Error('本地数据库被其他页面占用，请关闭后重试。'));
  });
  return dbPromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('数据库事务失败。'));
    transaction.onabort = () => reject(transaction.error || new Error('数据库事务已取消。'));
  });
}

async function idbGet(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORAGE.storeName, 'readonly');
    const request = transaction.objectStore(STORAGE.storeName).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('读取数据库失败。'));
  });
}

async function idbPut(key, value) {
  const db = await openDatabase();
  const transaction = db.transaction(STORAGE.storeName, 'readwrite');
  transaction.objectStore(STORAGE.storeName).put(value, key);
  await transactionDone(transaction);
}

async function idbDelete(key) {
  const db = await openDatabase();
  const transaction = db.transaction(STORAGE.storeName, 'readwrite');
  transaction.objectStore(STORAGE.storeName).delete(key);
  await transactionDone(transaction);
}

/* ------------------------------------------------------------------ */
/* gzip <-> base64                                                     */
/* ------------------------------------------------------------------ */

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function supportsCompression() {
  return (
    typeof CompressionStream !== 'undefined' &&
    typeof DecompressionStream !== 'undefined' &&
    typeof Response !== 'undefined'
  );
}

export async function compressSnapshot(json) {
  if (!supportsCompression()) return `raw:${json}`;
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    return `gz:${bytesToBase64(new Uint8Array(buffer))}`;
  } catch {
    return `raw:${json}`;
  }
}

export async function decompressSnapshot(payload) {
  if (typeof payload !== 'string') throw new Error('备份格式不正确。');
  if (payload.startsWith('raw:')) return payload.slice(4);
  if (!payload.startsWith('gz:')) return payload;
  if (!supportsCompression()) throw new Error('当前浏览器无法解压该备份。');
  const bytes = base64ToBytes(payload.slice(3));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/* ------------------------------------------------------------------ */
/* 公共 API                                                            */
/* ------------------------------------------------------------------ */

function writeLocalBackup(payload) {
  try {
    globalThis.localStorage?.setItem(STORAGE.backupKey, payload);
  } catch (error) {
    // 配额不足时只放弃备份，主存储仍然有效。
    console.warn('LocalStorage 备份写入失败：', error?.name || error);
  }
}

/**
 * 保存状态。返回实际使用的存储源。
 * 传入的对象必须是纯数据（不包含 File/Blob/函数）。
 */
export async function saveState(state) {
  const snapshot = {
    ...state,
    meta: {
      ...state.meta,
      savedAt: new Date().toISOString(),
    },
  };
  const json = JSON.stringify(snapshot);
  let idbSaved = false;

  try {
    await idbPut(STORAGE.stateKey, snapshot);
    idbSaved = true;
  } catch (error) {
    console.warn('IndexedDB 写入失败：', error?.message || error);
  }

  // 备份始终写（压缩后通常很小），同时支持没有 IndexedDB 的环境。
  try {
    const compressed = await compressSnapshot(json);
    // 避免极端情况下写爆 LocalStorage；超过约 4.2MB 时跳过。
    if (compressed.length < 4.2 * 1024 * 1024) writeLocalBackup(compressed);
  } catch (error) {
    console.warn('压缩备份失败：', error?.message || error);
  }

  if (!idbSaved) {
    // 确认 LocalStorage 确实可读。
    const fallback = globalThis.localStorage?.getItem(STORAGE.backupKey);
    if (!fallback) throw new Error('所有本地存储方式均不可用，请检查浏览器隐私设置。');
  }
  return { idbSaved };
}

/** 读取状态；返回 { state, source, savedAt }。 */
export async function loadState() {
  try {
    const stored = await idbGet(STORAGE.stateKey);
    if (stored && typeof stored === 'object') {
      return {
        state: stored,
        source: 'indexeddb',
        savedAt: stored.meta?.savedAt || null,
      };
    }
  } catch (error) {
    console.warn('IndexedDB 读取失败，尝试 LocalStorage 备份：', error?.message || error);
  }

  const backup = globalThis.localStorage?.getItem(STORAGE.backupKey);
  if (backup) {
    try {
      const json = await decompressSnapshot(backup);
      const state = JSON.parse(json);
      return {
        state,
        source: 'localstorage',
        savedAt: state.meta?.savedAt || null,
      };
    } catch (error) {
      console.warn('备份恢复失败：', error?.message || error);
    }
  }

  return { state: null, source: 'none', savedAt: null };
}

export async function clearStoredState() {
  try {
    await idbDelete(STORAGE.stateKey);
  } catch (error) {
    console.warn('清空 IndexedDB 失败：', error?.message || error);
  }
  try {
    globalThis.localStorage?.removeItem(STORAGE.backupKey);
  } catch {
    /* ignore */
  }
}

/** 当前持久化环境说明，显示在设置页。 */
export async function getStorageInfo() {
  let indexedDb = false;
  try {
    await openDatabase();
    indexedDb = true;
  } catch {
    indexedDb = false;
  }
  return {
    indexedDb,
    compression: supportsCompression(),
    localBackup: Boolean(globalThis.localStorage?.getItem(STORAGE.backupKey)),
  };
}
