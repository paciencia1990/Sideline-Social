"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function compile(source, modules = {}) {
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.React,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "__DEV__", code)((name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  }, module, module.exports, false);
  return module.exports;
}
const core = compile(read("utils/friendChatImageCacheCore.ts"));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const request = (messageId, variant = "thumbnail", priority = "visible", signal) => ({
  conversationId: "fixture-conversation", expectedSizeBytes: 100, mediaProfileVersion: 2,
  messageId, priority, signal, storagePath: `fixture/${messageId}/${variant}`, variant,
});
const keyFor = (input, uid = "fixture-account") => hash(core.friendChatImageCacheIdentity({ ...input, uid }));

function cacheHarness(source = read("services/friendChatImageCacheService.ts")) {
  const files = new Map(), storage = new Map(), downloads = [], grants = [], traces = [];
  const auth = { currentUser: { uid: "fixture-account" } };
  let storageReads = 0, storageWrites = 0, fileReads = 0, active = 0, maxActive = 0;
  let writeGate = null, infoGate = null, grantGate = null, digestGate = null, deleteGate = null, autoDownloads = true;
  let sequence = 0;
  const cache = compile(source, {
    "@react-native-async-storage/async-storage": {
      async getItem(key) { storageReads++; return storage.get(key) ?? null; },
      async setItem(key, value) { storageWrites++; if (writeGate) await writeGate.promise; storage.set(key, value); },
      async removeItem(key) { storage.delete(key); },
    },
    "expo-crypto": { CryptoDigestAlgorithm: { SHA256: "SHA256" },
      async digestStringAsync(_algorithm, value) { if (digestGate) await digestGate.promise; return hash(value); },
      randomUUID: () => `fixture-${++sequence}` },
    "expo-file-system/legacy": {
      cacheDirectory: "file:///fixture-cache/",
      async makeDirectoryAsync() {},
      async getInfoAsync(uri) { fileReads++; if (infoGate) await infoGate.promise;
        return files.has(uri) ? { exists: true, size: files.get(uri) } : { exists: false }; },
      async deleteAsync(uri) { if (deleteGate) await deleteGate.promise;
        for (const key of files.keys()) if (key === uri || key.startsWith(uri.endsWith("/") ? uri : `${uri}/`)) files.delete(key); },
      async copyAsync({ from, to }) { assert.ok(files.has(from)); files.set(to, files.get(from)); },
      async moveAsync({ from, to }) { assert.ok(files.has(from)); files.set(to, files.get(from)); files.delete(from); },
      async downloadAsync(url, destination) {
        const job = { url, destination, gate: deferred(), size: 100 }; downloads.push(job);
        active++; maxActive = Math.max(maxActive, active);
        try { if (!autoDownloads) await job.gate.promise; files.set(destination, job.size); return { status: 200, uri: destination }; }
        finally { active--; }
      },
    },
    "@/config/firebase": { auth },
    "@/services/chatService": {
      clearFriendChatMediaGrantCache() {},
      async getFriendChatMediaDownloadUrl(input) { grants.push(input); if (grantGate) await grantGate.promise;
        return { url: `https://fixture.invalid/${input.storagePath}`, expiresAtMillis: Date.now() + 60_000 }; },
    },
    "@/utils/friendChatImageCacheCore": core,
    "@/utils/performanceDiagnostics": {
      measureDevelopmentPerformance: async (name, work) => { traces.push(name); return work(); },
      startDevelopmentPerformanceTrace: (name) => { traces.push(name); return () => 0; },
    },
    "expo-image": { Image: { clearMemoryCache: async () => true } },
  });
  return { ...cache, files, storage, downloads, grants, auth, traces,
    counts: () => ({ storageReads, storageWrites, fileReads, maxActive }),
    setWriteGate: (gate) => { writeGate = gate; }, setInfoGate: (gate) => { infoGate = gate; },
    setGrantGate: (gate) => { grantGate = gate; }, setDigestGate: (gate) => { digestGate = gate; },
    setDeleteGate: (gate) => { deleteGate = gate; },
    manualDownloads: () => { autoDownloads = false; },
    async prime(input) { const localUri = `file:///fixture-source/${input.messageId}/${input.variant}`;
      files.set(localUri, input.expectedSizeBytes); await cache.primeFriendChatImageCache({ ...input, localUri }); },
    async cleanup() { await cache.clearFriendChatImageMemoryCache(); },
  };
}

async function cacheReuseTests() {
  const h = cacheHarness(), image = request("shared");
  const results = await Promise.all([h.loadFriendChatImageMedia(image), h.loadFriendChatImageMedia(image)]);
  assert.equal(results[0], results[1]);
  assert.equal(h.downloads.length, 1, "Timeline and viewer share the same first download");
  assert.equal(h.counts().storageReads, 1, "Manifest is read once, including download recording");
  assert.equal(h.counts().fileReads, 1, "Shared first miss checks downloaded bytes once");
  const before = h.counts();
  await Promise.all([h.loadFriendChatImageMedia(image), h.loadFriendChatImageMedia(image)]);
  assert.equal(h.counts().fileReads - before.fileReads, 1, "Concurrent cache hits share their file validation");
  assert.equal(h.counts().storageWrites, before.storageWrites, "LRU access writes do not delay each cache hit");
  assert.equal(h.downloads.length, 1, "Reopening a cached image needs no download or grant");

  const writeGate = deferred(); h.setWriteGate(writeGate);
  const otherPrime = h.prime(request("other")); await flush();
  let cacheReady = false;
  const warm = h.loadFriendChatImageMedia(image).then(() => { cacheReady = true; });
  await flush(); assert.equal(cacheReady, true, "Cache hit is independent of an unrelated slow manifest write");
  h.setWriteGate(null); writeGate.resolve(); await Promise.all([otherPrime, warm]);
  h.files.set(results[0], 99);
  await h.loadFriendChatImageMedia(image);
  assert.equal(h.downloads.length, 2, "Corrupt or incomplete cached bytes are replaced");
  assert.equal(h.files.get(results[0]), 100);
  await h.cleanup();
}

async function priorityAndCancellationTests() {
  const h = cacheHarness(); h.manualDownloads();
  await h.prime(request("warm"));
  const running = ["first", "second", "third"].map((id) => h.loadFriendChatImageMedia(request(id, "thumbnail", "nearby")));
  await flush(); assert.equal(h.downloads.length, 3);
  let warmReady = false;
  const warm = h.loadFriendChatImageMedia(request("warm")).then(() => { warmReady = true; });
  await flush(); assert.equal(warmReady, true, "Cached thumbnails bypass occupied network slots");
  const queuedNearby = h.loadFriendChatImageMedia(request("nearby", "thumbnail", "nearby"));
  const queuedVisible = h.loadFriendChatImageMedia(request("visible"));
  const viewer = h.loadFriendChatImageMedia(request("viewer", "display"));
  const cancelledController = new AbortController();
  const cancelled = h.loadFriendChatImageMedia(request("cancelled", "thumbnail", "visible", cancelledController.signal));
  const cancelledResult = assert.rejects(cancelled, { name: "AbortError" });
  await flush(); cancelledController.abort(); await cancelledResult;
  h.downloads[0].gate.resolve(); await flush();
  assert.match(h.downloads[3].url, /viewer\/display$/u, "Tapped full image precedes speculative thumbnails");
  h.downloads[1].gate.resolve(); await flush();
  assert.match(h.downloads[4].url, /visible\/thumbnail$/u, "Visible thumbnail precedes nearby preview");
  h.downloads[2].gate.resolve(); await flush();
  assert.match(h.downloads[5].url, /nearby\/thumbnail$/u);
  assert.equal(h.grants.some((grant) => grant.messageId === "cancelled"), false, "Cancelled queued work acquires no grant");
  h.downloads.slice(3).forEach((job) => job.gate.resolve());
  await Promise.all([...running, warm, queuedNearby, queuedVisible, viewer]);
  assert.equal(h.counts().maxActive, 3, "Download concurrency remains bounded");
  await h.cleanup();

  const shared = cacheHarness(); shared.manualDownloads();
  const controller = new AbortController();
  const first = shared.loadFriendChatImageMedia(request("subscribers", "thumbnail", "nearby", controller.signal));
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = shared.loadFriendChatImageMedia(request("subscribers")); await flush();
  controller.abort(); await rejected;
  shared.downloads[0].gate.resolve(); await second;
  assert.equal(shared.downloads.length, 1, "One subscriber abort cannot cancel another subscriber");
  await shared.cleanup();
}

async function invalidationTests() {
  const h = cacheHarness(), gate = deferred(); h.setGrantGate(gate);
  const stale = h.loadFriendChatImageMedia(request("removed"));
  const rejected = assert.rejects(stale, { name: "AbortError" });
  const valid = h.loadFriendChatImageMedia(request("valid")); await flush();
  await h.clearFriendChatImageCacheForMessages(["removed"]); await rejected;
  h.setGrantGate(null);
  const replacement = h.loadFriendChatImageMedia(request("removed")); await replacement;
  gate.resolve(); await valid; await flush();
  assert.equal(h.downloads.filter((job) => /removed\//u.test(job.url)).length, 1, "Late invalidated grant cannot start an old download");
  assert.equal(h.downloads.filter((job) => /fixture\/valid\//u.test(job.url)).length, 1, "Deleting one image does not cancel unrelated images");
  await h.cleanup();

  const warm = cacheHarness(); await warm.prime(request("account"));
  const infoGate = deferred(); warm.setInfoGate(infoGate);
  const oldAccount = warm.loadFriendChatImageMedia(request("account"));
  const oldRejected = assert.rejects(oldAccount, { name: "AbortError" }); await flush();
  warm.auth.currentUser = { uid: "different-fixture-account" }; infoGate.resolve(); await oldRejected;
  warm.setInfoGate(null);
  await warm.loadFriendChatImageMedia(request("account"));
  assert.equal(warm.downloads.length, 1, "Account switch cannot reuse another account's cached file");
  await warm.cleanup();

  const hashing = cacheHarness(), digestGate = deferred(); hashing.setDigestGate(digestGate);
  const beforeClear = hashing.loadFriendChatImageMedia(request("hashing"));
  const hashRejected = assert.rejects(beforeClear, { name: "AbortError" });
  const hashClear = hashing.clearFriendChatImageCacheForMessages(["hashing"]);
  hashing.setDigestGate(null); digestGate.resolve(); await Promise.all([hashRejected, hashClear]);
  assert.equal(hashing.grants.length, 0, "Invalidation during key hashing cannot recreate a removed task");
  await hashing.cleanup();

  const unrelated = cacheHarness(), unrelatedGate = deferred(); unrelated.setDigestGate(unrelatedGate);
  const keep = unrelated.loadFriendChatImageMedia(request("keep"));
  const remove = unrelated.clearFriendChatImageCacheForMessages(["different"]);
  unrelated.setDigestGate(null); unrelatedGate.resolve(); await Promise.all([keep, remove]);
  assert.equal(unrelated.downloads.length, 1, "Per-message invalidation does not cancel another image's key lookup");
  await unrelated.cleanup();

  const clearing = cacheHarness(); await clearing.prime(request("clearing"));
  const deleteGate = deferred(); clearing.setDeleteGate(deleteGate);
  const cleanup = clearing.clearFriendChatImageMemoryCache();
  const reload = clearing.loadFriendChatImageMedia(request("clearing")); await flush();
  assert.equal(clearing.grants.length, 0, "A new request waits for in-progress full-cache cleanup");
  clearing.setDeleteGate(null); deleteGate.resolve(); await Promise.all([cleanup, reload]);
  assert.equal(clearing.downloads.length, 1, "Request after cleanup reloads bytes rather than returning a removed file");
  await clearing.cleanup();

  const retry = cacheHarness(); await retry.prime(request("retry"));
  const writeGate = deferred(); retry.setWriteGate(writeGate);
  const messageClear = retry.clearFriendChatImageCacheForMessages(["retry"]); await flush();
  const retryLoad = retry.loadFriendChatImageMedia(request("retry")); await flush();
  assert.equal(retry.grants.length, 0, "Retry cannot race ahead of same-message cleanup");
  retry.setWriteGate(null); writeGate.resolve(); await Promise.all([messageClear, retryLoad]);
  await retry.cleanup();

  const account = cacheHarness(), accountGate = deferred(); account.setGrantGate(accountGate);
  const pending = account.loadFriendChatImageMedia(request("signout"));
  const pendingRejected = assert.rejects(pending, { name: "AbortError" }); await flush();
  await account.clearFriendChatImageMemoryCache(); await pendingRejected;
  account.auth.currentUser = null; accountGate.resolve(); await flush();
  assert.equal(account.downloads.length, 0, "Sign-out cleanup prevents late network and cache publication");
  assert.equal([...account.files.keys()].filter((uri) => uri.startsWith("file:///fixture-cache/")).length, 0);
}

async function capacityTests() {
  const h = cacheHarness();
  for (let i = 0; i < 130; i++) await h.prime(request(`capacity-${i}`));
  const manifest = JSON.parse([...h.storage.values()][0]);
  assert.equal(manifest.entries.length, 128);
  const imageFiles = [...h.files.keys()].filter((uri) => uri.startsWith("file:///fixture-cache/"));
  assert.equal(imageFiles.length, 128, "LRU evictions remove bytes as well as entries");
  assert.equal(manifest.entries.some((entry) => entry.mediaKey === keyFor(request("capacity-0"))), false);
  await h.cleanup();

  const bytes = cacheHarness();
  for (let i = 0; i < 66; i++) await bytes.prime({ ...request(`bytes-${i}`), expectedSizeBytes: 1024 * 1024 });
  const limited = JSON.parse([...bytes.storage.values()][0]);
  assert.equal(limited.entries.length, 64);
  assert.equal(limited.entries.reduce((total, entry) => total + entry.sizeBytes, 0), 64 * 1024 * 1024);
  await bytes.cleanup();
}

async function grantTests() {
  const source = read("services/chatService.ts");
  const slice = source.slice(source.indexOf("export async function getFriendChatMediaDownloadUrl"), source.indexOf("export async function deleteFriendChatMessageForEveryone"));
  const calls = [], auth = { currentUser: { uid: "fixture-account" } };
  const adapter = compile(`const { auth, call, normalizeVoicePlaybackUrlResponse, currentUserId, measureDevelopmentPerformance } = require("fixture");\n${slice}`, {
    fixture: { auth, currentUserId: () => auth.currentUser?.uid,
      call: (_name, input) => { const next = deferred(); calls.push({ ...next, input }); return next.promise; },
      normalizeVoicePlaybackUrlResponse: (value) => value,
      measureDevelopmentPerformance: (_name, work) => work(),
    },
  });
  const input = { messageId: "grant", storagePath: "fixture/grant/thumbnail" };
  const old = adapter.getFriendChatMediaDownloadUrl(input);
  const oldRejected = assert.rejects(old, { name: "AbortError" });
  adapter.clearFriendChatMediaGrantCache(["grant"]);
  const replacement = adapter.getFriendChatMediaDownloadUrl(input);
  const replacementShared = adapter.getFriendChatMediaDownloadUrl(input);
  assert.equal(calls.length, 2);
  calls[0].resolve({ expiresAtMillis: Date.now() + 120_000, url: "https://fixture.invalid/stale" });
  await oldRejected;
  const stillShared = adapter.getFriendChatMediaDownloadUrl(input);
  assert.equal(calls.length, 2, "Old completion must not delete the replacement in-flight grant");
  calls[1].resolve({ expiresAtMillis: Date.now() + 120_000, url: "https://fixture.invalid/current" });
  const results = await Promise.all([replacement, replacementShared, stillShared]);
  assert.ok(results.every((result) => result.url.endsWith("current")));
  assert.equal((await adapter.getFriendChatMediaDownloadUrl(input)).url, results[0].url);
  adapter.clearFriendChatMediaGrantCache();
  const switching = adapter.getFriendChatMediaDownloadUrl(input);
  const switchedRejected = assert.rejects(switching, { name: "AbortError" });
  auth.currentUser = { uid: "different-fixture-account" };
  calls[2].resolve({ expiresAtMillis: Date.now() + 120_000, url: "https://fixture.invalid/other" });
  await switchedRejected;
}

function componentHarness(factory) {
  const hooks = []; let cursor = 0, effects = [], mounted = true, lateWrites = 0;
  const changed = (before, deps) => !before || deps.some((value, index) => value !== before.deps[index]);
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(initial) { const slot = cursor++; if (!hooks[slot]) hooks[slot] = { current: initial }; return hooks[slot]; },
    useState(initial) { const slot = cursor++; if (!hooks[slot]) hooks[slot] = { value: initial };
      return [hooks[slot].value, (value) => { if (!mounted) lateWrites++; hooks[slot].value = typeof value === "function" ? value(hooks[slot].value) : value; }]; },
    useEffect(effect, deps) { const slot = cursor++, previous = hooks[slot];
      if (changed(previous, deps)) effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup: effect() }; }); },
  };
  const component = factory(React);
  return { render(props) { cursor = 0; effects = []; const tree = component(props); effects.forEach((effect) => effect()); return tree; },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); mounted = false; }, lateWrites: () => lateWrites };
}
function find(tree, type) {
  if (Array.isArray(tree)) { for (const child of tree) { const found = find(child, type); if (found) return found; } }
  else if (tree && typeof tree === "object") return tree.type === type ? tree : find(tree.props?.children, type);
  return null;
}
async function thumbnailComponentTests() {
  const loads = [], clears = [], traces = [];
  const ui = componentHarness((React) => compile(read("components/FriendChatImageMessage.tsx"), {
    react: React, "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (value) => value } },
    "expo-image": { Image: "Image" }, "lucide-react-native": { ImageIcon: "ImageIcon" },
    "react-i18next": { useTranslation: () => ({ t: (key) => key }) },
    "@/constants/theme": { Colors: {}, Radius: {}, Typography: {} },
    "@/services/friendChatImageCacheService": {
      loadFriendChatImageMedia: (input) => { const next = deferred(); loads.push({ ...next, input }); return next.promise; },
      clearFriendChatImageCacheForMessages: () => { const next = deferred(); clears.push(next); return next.promise; },
    },
    "@/utils/performanceDiagnostics": { startDevelopmentPerformanceTrace: (name) => () => { traces.push(name); return 0; } },
  }).FriendChatImageMessage);
  const props = { active: true, conversationId: "fixture-conversation", image: { mediaProfileVersion: 2, thumbnailSizeBytes: 100,
    thumbnailPath: "fixture/thumbnail", thumbnailWidth: 100, thumbnailHeight: 100 }, loadMedia: true, messageId: "fixture-image", priority: "nearby",
    onLongPress() {}, onOpen() {}, onSelect() {}, onUnavailable() {}, selectionMode: false };
  ui.render(props); assert.equal(loads[0].input.priority, "nearby");
  ui.render({ ...props, priority: "visible" }); assert.equal(loads[0].input.signal.aborted, true);
  assert.equal(loads[1].input.priority, "visible");
  loads[0].resolve("file:///fixture-stale"); loads[1].resolve("file:///fixture-current"); await flush();
  let tree = ui.render({ ...props, priority: "visible" });
  assert.equal(find(tree, "Image").props.source.uri, "file:///fixture-current");
  find(tree, "Image").props.onDisplay();
  assert.ok(traces.includes("friend-chat.image-thumbnail-load"), "Time-to-display includes lookup, queue, grant and transfer");
  find(tree, "Image").props.onError(); tree = ui.render({ ...props, priority: "visible" });
  assert.equal(loads.length, 2, "Decode failure stays visible until explicit Retry, with no automatic request loop");
  const retry = find(tree, "Pressable").props.onPress; retry(); retry();
  assert.equal(clears.length, 1, "Repeated Retry taps share cleanup");
  ui.render({ ...props, priority: "visible" }); assert.equal(loads.length, 2, "Retry waits for authoritative cache cleanup");
  clears[0].resolve(); await flush(); ui.render({ ...props, priority: "visible" }); assert.equal(loads.length, 3);
  loads[2].reject(Error("fixture failure")); await flush(); tree = ui.render({ ...props, priority: "visible" });
  find(tree, "Pressable").props.onPress(); ui.unmount(); clears[1].resolve(); await flush();
  assert.equal(ui.lateWrites(), 0, "Late Retry cleanup cannot update an unmounted image");
}

async function main() {
  await cacheReuseTests(); await priorityAndCancellationTests(); await invalidationTests(); await capacityTests(); await grantTests(); await thumbnailComponentTests();
  console.log("Friend Chat image loading: shared cache hits/downloads, nonblocking LRU, priority, cancellation, invalidation, account isolation, size limits and grant races passed.");
}
module.exports = { cacheHarness, request };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
