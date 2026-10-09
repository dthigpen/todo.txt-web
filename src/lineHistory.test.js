import { test } from "node:test";
import assert from "node:assert/strict";
import { createMergeRows } from "./conflictMerge.js";
import {
  diffLines,
  groupMergeRows,
  operationsForKey,
  recordOperation,
} from "./lineHistory.js";

test("diffLines reports added and removed lines as a multiset", () => {
  const { removed, added } = diffLines(
    "2026-01-01 Get groceries\nKeep me",
    "Keep me\nx 2026-01-05 2026-01-01 Get groceries",
  );
  assert.deepEqual(removed, ["2026-01-01 Get groceries"]);
  assert.deepEqual(added, ["x 2026-01-05 2026-01-01 Get groceries"]);
});

test("recordOperation ignores no-op changes and caps history", () => {
  let history = {};
  history = recordOperation(history, {
    key: "a",
    label: "Completed",
    before: "Task",
    after: "Task",
  });
  assert.deepEqual(operationsForKey(history, "a"), []);

  for (let index = 0; index < 60; index += 1) {
    history = recordOperation(history, {
      key: "a",
      label: `Edit ${index}`,
      before: `line ${index}`,
      after: `line ${index} done`,
      timestamp: index + 1,
    });
  }
  assert.equal(operationsForKey(history, "a").length, 50);
  assert.equal(operationsForKey(history, "a")[0].label, "Edit 10");
});

test("groupMergeRows links a completion's removal and addition", () => {
  const base = "2026-01-01 Get groceries\nUnrelated task";
  const server = base;
  const device = "x 2026-01-05 2026-01-01 Get groceries\nUnrelated task";
  const rows = createMergeRows(base, server, device);

  const history = recordOperation(
    {},
    {
      key: "a",
      label: "Completed",
      before: base,
      after: device,
      timestamp: 1,
    },
  );

  const items = groupMergeRows(rows, operationsForKey(history, "a"));
  const group = items.find((item) => item.type === "group");
  assert.ok(group, "expected a grouped item");
  assert.equal(group.label, "Completed");
  assert.equal(group.rows.length, 2);
  assert.deepEqual(group.rows.map((row) => row.change).sort(), [
    "added-device",
    "removed-device",
  ]);
});

test("groupMergeRows leaves a lone change ungrouped", () => {
  const base = "Keep me";
  const server = base;
  const device = "Keep me\nBrand new task";
  const rows = createMergeRows(base, server, device);
  const history = recordOperation(
    {},
    { key: "a", label: "Added", before: base, after: device, timestamp: 1 },
  );
  const items = groupMergeRows(rows, operationsForKey(history, "a"));
  assert.ok(items.every((item) => item.type === "row"));
});
