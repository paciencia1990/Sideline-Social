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
import { measureDevelopmentPerformance } from "@/utils/performanceDiagnostics";

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
let manifestQueue = Promise.resolve();

export async function loadFriendChatImageMedia(request: FriendChatImageMediaRequest) {
  const uid = currentUserId();
  const key = await mediaKey(uid, request);
  const cachedUri = await cachedMediaUri(key, request.expectedSizeBytes);
  if (cachedUri) {
    logCacheResult("hit");
    return cachedUri;
  }
  logCacheResult("miss");

  let task = inFlightDownloads.get(key);
  if (!task) {
    task = createDownloadTask(key, request);
    inFlightDownloads.set(key, task);
    const subscription = subscribeToDownload(task, request.signal);
    downloadQueue.push(task);
    pumpDownloadQueue();
    return subscription;
  }
  return subscribeToDownload(task, request.signal);
}

export async function primeFriendChatImageCache(input: Omit<FriendChatImageMediaRequest, "signal" | "storagePath"> & {
  localUri: string;
}) {
  const uid = currentUserId();
  const key = await mediaKey(uid, input);
  const sourceInfo = await FileSystem.getInfoAsync(input.localUri);
  const sourceSize = (sourceInfo as { exists?: boolean; size?: number }).size;
  if (!sourceInfo.exists || sourceSize !== input.expectedSizeBytes) return false;
  const destination = cacheFileUri(key);
  await ensureCacheDirectory();
  await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
  await FileSystem.copyAsync({ from: input.localUri, to: destination });
  await recordCacheEntry(uid, input.messageId, key, input.expectedSizeBytes);
  return true;
}

export async function clearFriendChatImageCacheForMessages(messageIds: readonly string[]) {
  if (!messageIds.length) return;
  cacheGeneration += 1;
  clearFriendChatMediaGrantCache(messageIds);
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const messageHashes = new Set(await Promise.all(messageIds.map((messageId) => secureHash(`${uid}\u001f${messageId}`))));
  await withManifest(async (manifest) => {
    const removed = manifest.entries.filter((entry) => messageHashes.has(entry.messageHash));
    await Promise.allSettled(removed.map((entry) => FileSystem.deleteAsync(cacheFileUri(entry.mediaKey), { idempotent: true })));
    manifest.entries = manifest.entries.filter((entry) => !messageHashes.has(entry.messageHash));
    await persistManifest(manifest);
  });
  await clearExpoImageMemoryCache();
}

export async function clearFriendChatImageMemoryCache() {
  cacheGeneration += 1;
  clearFriendChatMediaGrantCache();
  downloadQueue.splice(0).forEach((task) => {
    task.cancelled = true;
    task.reject(abortError());
    inFlightDownloads.delete(task.key);
  });
  await Promise.all([
    clearExpoImageMemoryCache(),
    withManifest(async () => {
      await Promise.allSettled([
        removeCacheDirectory(),
        AsyncStorage.removeItem(CACHE_MANIFEST_KEY),
      ]);
    }),
  ]);
}

function createDownloadTask(key: string, request: FriendChatImageMediaRequest): DownloadTask {
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
        task.cancelled = true;
        pumpDownloadQueue();
      }
    };
    const onAbort = () => {
      removeSubscriber();
      reject(abortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    task.promise.then(resolve, reject).finally(() => {
      signal?.removeEventListener("abort", onAbort);
      removeSubscriber();
    });
  });
}

function pumpDownloadQueue() {
  while (activeDownloadCount < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const task = downloadQueue.shift()!;
    if (task.cancelled || task.subscribers.size === 0) {
      task.reject(abortError());
      inFlightDownloads.delete(task.key);
      continue;
    }
    task.started = true;
    activeDownloadCount += 1;
    void runDownloadTask(task)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeDownloadCount -= 1;
        inFlightDownloads.delete(task.key);
        pumpDownloadQueue();
      });
  }
}

async function runDownloadTask(task: DownloadTask) {
  const uid = currentUserId();
  const destination = cacheFileUri(task.key);
  const temporaryUri = `${destination}.${Crypto.randomUUID()}.download`;
  await ensureCacheDirectory();
  try {
    const grant = await getFriendChatMediaDownloadUrl({
      messageId: task.request.messageId,
      storagePath: task.request.storagePath,
    });
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
    if (task.generation !== cacheGeneration || auth.currentUser?.uid !== uid) throw abortError();
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: temporaryUri, to: destination });
    await recordCacheEntry(uid, task.request.messageId, task.key, task.request.expectedSizeBytes);
    return destination;
  } catch (error) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

async function cachedMediaUri(key: string, expectedSizeBytes: number) {
  const entry = await withManifest(async (manifest) => manifest.entries.find((candidate) => candidate.mediaKey === key) ?? null);
  if (!entry || entry.sizeBytes !== expectedSizeBytes) return null;
  const uri = cacheFileUri(key);
  const info = await FileSystem.getInfoAsync(uri);
  const actualSize = (info as { exists?: boolean; size?: number }).size;
  if (!info.exists || actualSize !== expectedSizeBytes) {
    await removeCacheEntries(new Set([key]));
    return null;
  }
  await withManifest(async (manifest) => {
    const current = manifest.entries.find((candidate) => candidate.mediaKey === key);
    if (current) current.lastAccessedAt = Date.now();
    await persistManifest(manifest);
  });
  return uri;
}

async function recordCacheEntry(uid: string, messageId: string, key: string, sizeBytes: number) {
  const [accountHash, messageHash] = await Promise.all([
    secureHash(uid),
    secureHash(`${uid}\u001f${messageId}`),
  ]);
  await withManifest(async (manifest) => {
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

async function readManifest(): Promise<CacheManifest> {
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
