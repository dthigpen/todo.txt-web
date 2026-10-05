const LAST_LIST_KEY = "todo-txt-web.last-list";

export function loadLastList(storage, fallback) {
  const saved = storage.getItem(LAST_LIST_KEY);
  return typeof saved === "string" && saved.length > 0 ? saved : fallback;
}

export function saveLastList(storage, key) {
  storage.setItem(LAST_LIST_KEY, key);
}
