import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

import { auth } from "@/config/firebase";
import {
  clearFriendChatMediaGrantCache,
  getFriendChatMediaDownloadUrl,
} from "@/services/chatService";
import {
  friendChatImageCacheIdentity,
  selectFriendChatImageCacheEvictions,
  type FriendChatImageCacheEntry,
  type FriendChatImageCacheVariant,
} from "@/utils/friendChatImageCacheCore";
import { measureDevelopmentPerformance, startDevelopmentPerformanceTrace } from "@/utils/performanceDiagnostics";

type ExpoImageCacheApi = {
  Image?: {
    clearMemoryCache?: () => Promise<boolean> | boolean;
  };
};

type CacheManifest = {
  entries: FriendChatImageCacheEntry[];
  version: 2;
};

export type FriendChatImageMediaRequest = {
  conversationId: string;
  expectedSizeBytes: number;
  mediaProfileVersion: 1 | 2;
  messageId: string;
  signal?: AbortSignal;
  priority?: "visible" | "nearby";
  storagePath: string;
  variant: FriendChatImageCacheVariant;
};

type DownloadTask = {
  cancelled: boolean;
  generation: number;
  key: string;
  promise: Promise<string>;
  reject: (error: unknown) => void;
  request: FriendChatImageMediaRequest;
  uid: string;
  priority: number;
  finishQueueWait: (() => number) | null;
  resolve: (uri: string) => void;
  started: boolean;
  subscribers: Set<symbol>;
};

const CACHE_DIRECTORY_NAME = "friend-chat-images-v2";
const CACHE_MANIFEST_KEY = "sidelineSocial.friendChatImageCache.v2";
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 128;
const MAX_CONCURRENT_DOWNLOADS = 3;
const inFlightDownloads = new Map<string, DownloadTask>();
const downloadQueue: DownloadTask[] = [];
let activeDownloadCount = 0;
let cacheGeneration = 0;
const messageInvalidations = new Map<string, number>();
const pendingMessageClears = new Map<string, Promise<void>>();
let manifestQueue = Promise.resolve();
let manifestLoad: Promise<CacheManifest> | null = null;
let accessWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCacheClear: Promise<void> | null = null;

export async function loadFriendChatImageMedia(request: FriendChatImageMediaRequest) {
  const uid = currentUserId();
  const generation = cacheGeneration;
  const messageKey = messageScopeKey(uid, request.messageId);
  const invalidation = messageInvalidations.get(messageKey) ?? 0;
  if (request.signal?.aborted) throw abortError();
  const key = await mediaKey(uid, request);
  if (pendingCacheClear) await pendingCacheClear;
  const pendingMessageClear = pendingMessageClears.get(messageKey);
  if (pendingMessageClear) await pendingMessageClear;
  if (request.signal?.aborted || generation !== cacheGeneration || invalidation !== (messageInvalidations.get(messageKey) ?? 0) || auth.currentUser?.uid !== uid) throw abortError();
  let task = inFlightDownloads.get(key);
  if (!task) {
    task = createDownloadTask(uid, key, request);
    inFlightDownloads.set(key, task);
    const subscription = subscribeToDownload(task, request.signal);
    // Share the cache lookup as well as the grant/download. Cache hits never wait
    // behind network work or manifest writes for unrelated images.
    void prepareDownloadTask(task);
    return subscription;
  }
  task.priority = Math.min(task.priority, downloadPriority(request));
  return subscribeToDownload(task, request.signal);
}

export async function primeFriendChatImageCache(input: Omit<FriendChatImageMediaRequest, "signal" | "storagePath"> & {
  localUri: string;
}) {
  const uid = currentUserId();
  const generation = cacheGeneration;
  const messageKey = messageScopeKey(uid, input.messageId);
  const invalidation = messageInvalidations.get(messageKey) ?? 0;
  const key = await mediaKey(uid, input);
  if (pendingCacheClear) await pendingCacheClear;
  const pendingMessageClear = pendingMessageClears.get(messageKey);
  if (pendingMessageClear) await pendingMessageClear;
  const sourceInfo = await FileSystem.getInfoAsync(input.localUri);
  const sourceSize = (sourceInfo as { exists?: boolean; size?: number }).size;
  if (!sourceInfo.exists || sourceSize !== input.expectedSizeBytes) return false;
  const destination = cacheFileUri(key);
  await ensureCacheDirectory();
  await recordCacheEntry(uid, input.messageId, key, input.expectedSizeBytes, async () => {
    if (generation !== cacheGeneration || invalidation !== (messageInvalidations.get(messageKey) ?? 0) || auth.currentUser?.uid !== uid) throw abortError();
    await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.copyAsync({ from: input.localUri, to: destination });
    if (generation !== cacheGeneration || invalidation !== (messageInvalidations.get(messageKey) ?? 0) || auth.currentUser?.uid !== uid) {
      await FileSystem.deleteAsync(destination, { idempotent: true });
      throw abortError();
    }
  });
  return true;
}

export async function clearFriendChatImageCacheForMessages(messageIds: readonly string[]) {
  if (!messageIds.length) return;
  clearFriendChatMediaGrantCache(messageIds);
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const targets = new Set(messageIds);
  const scopeKeys = messageIds.map((messageId) => messageScopeKey(uid, messageId));
  const priorClears = scopeKeys.flatMap((key) => pendingMessageClears.get(key) ?? []);
  scopeKeys.forEach((key) => messageInvalidations.set(key, (messageInvalidations.get(key) ?? 0) + 1));
  for (const task of inFlightDownloads.values()) {
    if (task.uid === uid && targets.has(task.request.messageId)) cancelDownloadTask(task);
  }
  const clearing = Promise.allSettled(priorClears).then(async () => {
    const messageHashes = new Set(await Promise.all(messageIds.map((messageId) => secureHash(`${uid}\u001f${messageId}`))));
    await withManifest(async (manifest) => {
      const removed = manifest.entries.filter((entry) => messageHashes.has(entry.messageHash));
      await Promise.allSettled(removed.map((entry) => FileSystem.deleteAsync(cacheFileUri(entry.mediaKey), { idempotent: true })));
      manifest.entries = manifest.entries.filter((entry) => !messageHashes.has(entry.messageHash));
      await persistManifest(manifest);
    });
    await clearExpoImageMemoryCache();
  });
  scopeKeys.forEach((key) => pendingMessageClears.set(key, clearing));
  try { await clearing; } finally {
    scopeKeys.forEach((key) => { if (pendingMessageClears.get(key) === clearing) pendingMessageClears.delete(key); });
  }
}

export async function clearFriendChatImageMemoryCache() {
  cacheGeneration += 1;
  messageInvalidations.clear();
  clearFriendChatMediaGrantCache();
  for (const task of inFlightDownloads.values()) cancelDownloadTask(task);
  downloadQueue.splice(0);
  if (accessWriteTimer) clearTimeout(accessWriteTimer);
  accessWriteTimer = null;
  const clearing = Promise.resolve(pendingCacheClear).catch(() => undefined).then(async () => {
    await Promise.all([
      clearExpoImageMemoryCache(),
      withManifest(async (manifest) => {
        manifest.entries = [];
        await Promise.allSettled([
          removeCacheDirectory(),
          AsyncStorage.removeItem(CACHE_MANIFEST_KEY),
        ]);
      }),
    ]);
  });
  pendingCacheClear = clearing;
  try { await clearing; } finally {
    if (pendingCacheClear === clearing) pendingCacheClear = null;
  }
}

function createDownloadTask(uid: string, key: string, request: FriendChatImageMediaRequest): DownloadTask {
  let resolve!: (uri: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    cancelled: false,
    generation: cacheGeneration,
    key,
    promise,
    reject,
    request,
    uid,
    priority: downloadPriority(request),
    finishQueueWait: null,
    resolve,
    started: false,
    subscribers: new Set(),
  };
}

function subscribeToDownload(task: DownloadTask, signal?: AbortSignal) {
  const subscriber = Symbol("friend-chat-image-download");
  task.subscribers.add(subscriber);
  return new Promise<string>((resolve, reject) => {
    const removeSubscriber = () => {
      task.subscribers.delete(subscriber);
      if (!task.started && task.subscribers.size === 0) {
        cancelDownloadTask(task);
      }
    };
    const onAbort = () => {
      removeSubscriber();
      reject(abortError());
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      removeSubscriber();
    };
    task.promise.then((uri) => { cleanup(); resolve(uri); }, (error) => { cleanup(); reject(error); });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function downloadPriority(request: FriendChatImageMediaRequest) {
  return request.variant === "display" ? 0 : request.priority === "nearby" ? 2 : 1;
}

function messageScopeKey(uid: string, messageId: string) {
  return `${uid}\u001f${messageId}`;
}

function cancelDownloadTask(task: DownloadTask) {
  task.cancelled = true;
  task.finishQueueWait?.();
  task.finishQueueWait = null;
  task.reject(abortError());
  releaseDownloadTask(task);
}

function releaseDownloadTask(task: DownloadTask) {
  if (inFlightDownloads.get(task.key) === task) inFlightDownloads.delete(task.key);
}

function assertDownloadCurrent(task: DownloadTask) {
  if (task.cancelled || task.generation !== cacheGeneration || auth.currentUser?.uid !== task.uid) throw abortError();
}

async function prepareDownloadTask(task: DownloadTask) {
  try {
    assertDownloadCurrent(task);
    const cachedUri = await measureDevelopmentPerformance("friend-chat.image-cache-lookup", () => cachedMediaUri(task));
    assertDownloadCurrent(task);
    logCacheResult(cachedUri ? "hit" : "miss");
    if (cachedUri) {
      task.resolve(cachedUri);
      releaseDownloadTask(task);
      return;
    }
    task.finishQueueWait = startDevelopmentPerformanceTrace("friend-chat.image-download-queue");
    downloadQueue.push(task);
    pumpDownloadQueue();
  } catch (error) {
    task.reject(error);
    releaseDownloadTask(task);
  }
}

function pumpDownloadQueue() {
  while (activeDownloadCount < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    downloadQueue.sort((first, second) => first.priority - second.priority);
    const task = downloadQueue.shift()!;
    if (task.cancelled || task.subscribers.size === 0) {
      task.reject(abortError());
      releaseDownloadTask(task);
      continue;
    }
    task.started = true;
    task.finishQueueWait?.();
    task.finishQueueWait = null;
    activeDownloadCount += 1;
    void runDownloadTask(task)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeDownloadCount -= 1;
        releaseDownloadTask(task);
        pumpDownloadQueue();
      });
  }
}

async function runDownloadTask(task: DownloadTask) {
  assertDownloadCurrent(task);
  const uid = task.uid;
  const destination = cacheFileUri(task.key);
  const temporaryUri = `${destination}.${Crypto.randomUUID()}.download`;
  await ensureCacheDirectory();
  try {
    const grant = await getFriendChatMediaDownloadUrl({
      messageId: task.request.messageId,
      storagePath: task.request.storagePath,
    });
    assertDownloadCurrent(task);
    const traceName = task.request.variant === "thumbnail"
      ? "friend-chat.image-thumbnail-download"
      : "friend-chat.image-full-download";
    const result = await measureDevelopmentPerformance(
      traceName,
      () => FileSystem.downloadAsync(grant.url, temporaryUri),
    );
    if (result.status < 200 || result.status >= 300) throw new Error("image_download_failed");
    const info = await FileSystem.getInfoAsync(temporaryUri);
    const downloadedSize = (info as { exists?: boolean; size?: number }).size;
    if (!info.exists || downloadedSize !== task.request.expectedSizeBytes) throw new Error("image_download_failed");
    assertDownloadCurrent(task);
    await recordCacheEntry(uid, task.request.messageId, task.key, task.request.expectedSizeBytes, async () => {
      assertDownloadCurrent(task);
      await FileSystem.deleteAsync(destination, { idempotent: true });
      await FileSystem.moveAsync({ from: temporaryUri, to: destination });
      try { assertDownloadCurrent(task); } catch (error) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
        throw error;
      }
    });
    assertDownloadCurrent(task);
    return destination;
  } catch (error) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

async function cachedMediaUri(task: DownloadTask) {
  const { key, request: { expectedSizeBytes } } = task;
  const manifest = await readManifest();
  assertDownloadCurrent(task);
  const entry = manifest.entries.find((candidate) => candidate.mediaKey === key);
  if (!entry || entry.sizeBytes !== expectedSizeBytes) return null;
  const uri = cacheFileUri(key);
  const info = await FileSystem.getInfoAsync(uri);
  assertDownloadCurrent(task);
  const actualSize = (info as { exists?: boolean; size?: number }).size;
  if (!info.exists || actualSize !== expectedSizeBytes) {
    await removeCacheEntries(new Set([key]));
    return null;
  }
  if (!manifest.entries.includes(entry)) return null;
  entry.lastAccessedAt = Date.now();
  scheduleAccessWrite();
  return uri;
}

async function recordCacheEntry(uid: string, messageId: string, key: string, sizeBytes: number, storeFile: () => Promise<void>) {
  const [accountHash, messageHash] = await Promise.all([
    secureHash(uid),
    secureHash(`${uid}\u001f${messageId}`),
  ]);
  await withManifest(async (manifest) => {
    await storeFile();
    manifest.entries = manifest.entries.filter((entry) => entry.mediaKey !== key);
    manifest.entries.push({ accountHash, lastAccessedAt: Date.now(), mediaKey: key, messageHash, sizeBytes });
    const evictions = selectFriendChatImageCacheEvictions(manifest.entries, {
      maxBytes: CACHE_MAX_BYTES,
      maxEntries: CACHE_MAX_ENTRIES,
    });
    const removed = manifest.entries.filter((entry) => evictions.has(entry.mediaKey));
    manifest.entries = manifest.entries.filter((entry) => !evictions.has(entry.mediaKey));
    await Promise.allSettled(removed.map((entry) => FileSystem.deleteAsync(cacheFileUri(entry.mediaKey), { idempotent: true })));
    await persistManifest(manifest);
  });
}

async function removeCacheEntries(keys: Set<string>) {
  await withManifest(async (manifest) => {
    manifest.entries = manifest.entries.filter((entry) => !keys.has(entry.mediaKey));
    await persistManifest(manifest);
  });
  await Promise.allSettled([...keys].map((key) => FileSystem.deleteAsync(cacheFileUri(key), { idempotent: true })));
}

function withManifest<T>(operation: (manifest: CacheManifest) => Promise<T>) {
  const result = manifestQueue.then(async () => operation(await readManifest()));
  manifestQueue = result.then(() => undefined, () => undefined);
  return result;
}

function scheduleAccessWrite() {
  if (accessWriteTimer) return;
  accessWriteTimer = setTimeout(() => {
    accessWriteTimer = null;
    void withManifest(persistManifest).catch(() => undefined);
  }, 1_000);
}

function readManifest(): Promise<CacheManifest> {
  // One shared load per process; mutations keep this same manifest current.
  manifestLoad ??= loadManifest();
  return manifestLoad;
}

async function loadManifest(): Promise<CacheManifest> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_MANIFEST_KEY);
    if (!raw) return { entries: [], version: 2 };
    const parsed = JSON.parse(raw) as Partial<CacheManifest>;
    if (parsed.version !== 2 || !Array.isArray(parsed.entries)) return { entries: [], version: 2 };
    return { entries: parsed.entries.filter(isCacheEntry), version: 2 };
  } catch {
    return { entries: [], version: 2 };
  }
}

function isCacheEntry(value: unknown): value is FriendChatImageCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<FriendChatImageCacheEntry>;
  return [entry.accountHash, entry.mediaKey, entry.messageHash].every((item) => typeof item === "string" && /^[a-f0-9]{64}$/u.test(item)) &&
    Number.isFinite(entry.lastAccessedAt) &&
    Number.isInteger(entry.sizeBytes) && Number(entry.sizeBytes) > 0;
}

async function persistManifest(manifest: CacheManifest) {
  await AsyncStorage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(manifest));
}

async function mediaKey(uid: string, request: Pick<FriendChatImageMediaRequest, "conversationId" | "mediaProfileVersion" | "messageId" | "variant">) {
  return secureHash(friendChatImageCacheIdentity({ ...request, uid }));
}

function currentUserId() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("chat/unauthenticated");
  return uid;
}

async function secureHash(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

async function ensureCacheDirectory() {
  await FileSystem.makeDirectoryAsync(cacheDirectory(), { intermediates: true });
}

function cacheDirectory() {
  if (!FileSystem.cacheDirectory) throw new Error("image_cache_unavailable");
  return `${FileSystem.cacheDirectory}${CACHE_DIRECTORY_NAME}/`;
}

function cacheFileUri(key: string) {
  return `${cacheDirectory()}${key}.jpg`;
}

async function removeCacheDirectory() {
  if (!FileSystem.cacheDirectory) return;
  await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${CACHE_DIRECTORY_NAME}/`, { idempotent: true });
}

async function clearExpoImageMemoryCache() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Best-effort cleanup for protected thumbnails already held by expo-image.
    const { Image } = require("expo-image") as ExpoImageCacheApi;
    await Promise.resolve(Image?.clearMemoryCache?.());
  } catch {
    // Authorization remains server-enforced if platform memory cleanup is unavailable.
  }
}

function abortError() {
  const error = new Error("image_download_cancelled");
  error.name = "AbortError";
  return error;
}

function logCacheResult(result: "hit" | "miss") {
  if (__DEV__) console.info("[Performance]", { name: `friend-chat.image-cache-${result}` });
}
