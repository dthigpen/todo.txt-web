import test from "node:test";
import assert from "node:assert/strict";
import { createMergeRows, serializeMergeRows } from "./conflictMerge.js";

test("merges server and device tasks without duplicating shared lines", () => {
  const rows = createMergeRows(
    "shared task\n",
    "shared task\nserver task\n",
    "shared task\ndevice task\n",
  );
  assert.deepEqual(
    rows.map(({ line, change }) => ({ line, change })),
    [
      { line: "shared task", change: "unchanged" },
      { line: "server task", change: "added-server" },
      { line: "device task", change: "added-device" },
    ],
  );
  assert.equal(
    serializeMergeRows(rows),
    "shared task\nserver task\ndevice task\n",
  );
});

test("preserves the larger number of identical task lines", () => {
  const rows = createMergeRows("repeat\n", "repeat\nrepeat\n", "repeat\n");
  assert.deepEqual(
    rows.map(({ change }) => change),
    ["unchanged", "added-server"],
  );
  assert.equal(serializeMergeRows(rows), "repeat\nrepeat\n");
});

test("serializes only tasks selected for the merged list", () => {
  const rows = createMergeRows("", "server task\n", "device task\n");
  rows[0].keep = false;
  assert.equal(serializeMergeRows(rows), "device task\n");
});

test("flags deletion on one side and excludes it from the default merge", () => {
  const rows = createMergeRows(
    "keep\nremoved intentionally\n",
    "keep\n",
    "keep\nremoved intentionally\n",
  );
  assert.deepEqual(
    rows.map(({ line, change, keep }) => ({ line, change, keep })),
    [
      { line: "keep", change: "unchanged", keep: true },
      {
        line: "removed intentionally",
        change: "removed-server",
        keep: false,
      },
    ],
  );
  rows[1].keep = true;
  assert.equal(serializeMergeRows(rows), "keep\nremoved intentionally\n");
});
