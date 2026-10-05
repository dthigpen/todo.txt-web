import test from "node:test";
import assert from "node:assert/strict";
import { buildServerFileTree, countServerFiles } from "./serverFileTree.js";

test("groups server files into a sorted directory tree", () => {
  const tree = buildServerFileTree([
    "z-last.txt",
    "household/chores/todo.txt",
    "household/todo.txt",
    "alpha.txt",
  ]);

  assert.deepEqual(
    tree.map(({ name, type }) => [name, type]),
    [
      ["household", "directory"],
      ["alpha.txt", "file"],
      ["z-last.txt", "file"],
    ],
  );
  assert.equal(tree[0].children[0].name, "chores");
  assert.equal(countServerFiles(tree), 4);
});

test("filters paths by query without losing their directory structure", () => {
  const tree = buildServerFileTree(
    ["household/todo.txt", "recipes/dinners.txt", "todo-backup.txt"],
    "todo",
  );

  assert.deepEqual(
    tree.map((node) => node.path),
    ["household", "todo-backup.txt"],
  );
  assert.equal(countServerFiles(tree), 2);
});
