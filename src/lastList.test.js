import test from "node:test";
import assert from "node:assert/strict";
import { loadLastList, saveLastList } from "./lastList.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("restores the last selected list", () => {
  const storage = createStorage();
  saveLastList(storage, "server:https://files.example/api:home/todo.txt");
  assert.equal(
    loadLastList(storage, "local:todo.txt"),
    "server:https://files.example/api:home/todo.txt",
  );
});

test("uses the default when no valid saved list exists", () => {
  assert.equal(
    loadLastList(createStorage(), "local:todo.txt"),
    "local:todo.txt",
  );
  assert.equal(
    loadLastList(
      createStorage({ "todo-txt-web.last-list": "" }),
      "local:todo.txt",
    ),
    "local:todo.txt",
  );
});
