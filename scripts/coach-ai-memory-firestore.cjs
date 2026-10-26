'use strict';
// Local transaction fixture, not an emulator replacement or release evidence.
// Read-version conflicts abort once; callbacks are never retried. Reads after
// writes are rejected to exercise the server's Firestore transaction ordering.
class Timestamp { constructor(ms) { this.ms = ms; } static fromMillis(ms) { return new Timestamp(ms); } static now() { return new Timestamp(Date.now()); } toMillis() { return this.ms; } }
const FieldValue = { serverTimestamp: () => Timestamp.now(), delete: () => ({ transform: 'delete' }), arrayRemove: value => ({ transform: 'arrayRemove', value }) };
const clone = value => value instanceof Timestamp ? new Timestamp(value.ms) : Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
function createMemoryFirestore() {
  const records = new Map(), versions = new Map();
  function snapshot(reference) { const value = clone(records.get(reference.path)); return { exists: records.has(reference.path), data: () => clone(value), ref: reference, id: reference.id }; }
  function write(path, value, merge = false, create = false, remove = false) {
    if (create && records.has(path)) throw new Error('already-exists');
    if (remove) records.delete(path);
    else {
      const data = merge ? clone(records.get(path) ?? {}) : {};
      for (const [key, item] of Object.entries(value)) {
        if (item?.transform === 'delete') delete data[key];
        else if (item?.transform === 'arrayRemove') data[key] = (data[key] ?? []).filter(v => v !== item.value);
        else data[key] = clone(item);
      }
      records.set(path, data);
    }
    versions.set(path, (versions.get(path) ?? 0) + 1);
    const parent = path.slice(0, path.lastIndexOf('/'));
    versions.set('query:' + parent, (versions.get('query:' + parent) ?? 0) + 1);
  }
  function doc(path) { return { path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`), get: async () => snapshot(doc(path)),
    set: async (value, options) => write(path, value, options?.merge), create: async value => write(path, value, false, true), update: async value => { if (!records.has(path)) throw Error('not-found'); write(path, value, true); }, delete: async () => write(path, {}, false, false, true) }; }
  function collection(path, filters = [], maximum = Infinity, fields = null) {
    return { path, isQuery: true, doc: id => doc(`${path}/${id}`), limit: n => collection(path, filters, n, fields), select: (...names) => collection(path, filters, maximum, names), where: (field, op, value) => collection(path, [...filters, [field, op, value]], maximum, fields), get: async () => {
      const docs = [...records.entries()].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1 && filters.every(([field, op, expected]) => op === 'array-contains' ? value[field]?.includes(expected) : value[field] === expected)).map(([key]) => snapshot(doc(key)));
      const selected = docs.slice(0, maximum).map(snap => !fields ? snap : { ...snap, data: () => {
        const source = snap.data(), output = {};
        for (const field of fields) {
          const parts = field.split('.'); let value = source;
          for (const part of parts) value = value?.[part];
          if (value === undefined) continue;
          let parent = output;
          for (const part of parts.slice(0,-1)) parent = parent[part] ||= {};
          parent[parts.at(-1)] = value;
        }
        return output;
      }});
      return { docs: selected, empty: selected.length === 0, size: selected.length };
    } };
  }
  const db = { doc, collection, runTransaction: async (callback, options) => {
    if (options?.maxAttempts !== 1) throw Error('fixture requires one transaction attempt');
    const reads = new Map(), writes = [];
    const transaction = { get: async reference => { if (writes.length) throw Error('reads-after-writes'); const key = reference.isQuery ? 'query:' + reference.path : reference.path; reads.set(key, versions.get(key) ?? 0); return reference.isQuery ? reference.get() : snapshot(reference); },
      set: (ref, value, options) => { writes.push(() => write(ref.path, value, options?.merge)); return transaction; },
      create: (ref, value) => { writes.push(() => write(ref.path, value, false, true)); return transaction; },
      update: (ref, value) => { writes.push(() => write(ref.path, value, true)); return transaction; }, delete: ref => { writes.push(() => write(ref.path, {}, false, false, true)); return transaction; } };
    const result = await callback(transaction);
    for (const [path, version] of reads) if ((versions.get(path) ?? 0) !== version) { const error = Error('fixture transaction aborted'); error.code = 10; throw error; }
    for (const apply of writes) apply();
    return result;
  }, bulkWriter: () => ({ onWriteError() {}, close: async () => {} }), recursiveDelete: async reference => {
    for (const path of [...records.keys()]) if (path === reference.path || path.startsWith(reference.path + '/')) write(path, {}, false, false, true);
  } };
  return { db, admin: { initializeApp() {}, firestore: () => db, app: () => ({ delete: async () => {} }) },
    overrides: { 'firebase-admin/firestore': { getFirestore: () => db, FieldValue, Timestamp }, 'firebase-admin/app': { getApp: () => ({}), initializeApp: () => ({}) } } };
}
module.exports = { createMemoryFirestore };
