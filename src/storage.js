const STORAGE_KEY = 'st_novel_translator_state_v1';

export async function loadState() {
  try {
    if (globalThis.localforage) {
      return await globalThis.localforage.getItem(STORAGE_KEY);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('[st-novel-translator] Failed to load state', error);
    return null;
  }
}

export async function saveState(state) {
  try {
    if (globalThis.localforage) {
      await globalThis.localforage.setItem(STORAGE_KEY, state);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[st-novel-translator] Failed to save state', error);
  }
}
