// data/store.js
// Minimal in-memory store with get/set.
const _store = new Map();
export const Store = {
  get(key) { return _store.get(key); },
  set(key, val) { _store.set(key, val); },
  has(key) { return _store.has(key); },
  delete(key) { return _store.delete(key); },
  clear() { return _store.clear(); },
};
export default Store;
