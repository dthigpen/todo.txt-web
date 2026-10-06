import test from "node:test";
import assert from "node:assert/strict";
import {
  completeTask,
  metadataValue,
  nextRecurringTask,
  parseDocument,
  parseRecurrence,
  parseTask,
  reopenTask,
  serializeDocument,
  serializeTask,
  setMetadataValue,
  sortTasks,
} from "./todoTxt.js";

test("parses and serializes todo.txt fields without changing their meaning", () => {
  const task = parseTask(
    "(A) 2026-03-01 Call dentist +health @phone due:2026-03-05",
  );
  assert.equal(task.priority, "A");
  assert.equal(task.creationDate, "2026-03-01");
  assert.equal(task.description, "Call dentist");
  assert.deepEqual(task.projects, ["health"]);
  assert.deepEqual(task.contexts, ["phone"]);
  assert.deepEqual(task.metadata, [{ key: "due", value: "2026-03-05" }]);
  assert.equal(
    serializeTask(task),
    "(A) 2026-03-01 Call dentist +health @phone due:2026-03-05",
  );
});

test("recognizes creation dates and priorities in either leading-token order", () => {
  const dateFirst = parseTask("2026-03-01 (A) Call dentist");
  const priorityFirst = parseTask("(A) 2026-03-01 Call dentist");
  for (const task of [dateFirst, priorityFirst]) {
    assert.equal(task.priority, "A");
    assert.equal(task.creationDate, "2026-03-01");
    assert.equal(task.description, "Call dentist");
  }
});

test("completion moves a priority to pri: metadata and reopening restores it", () => {
  const task = parseTask("(B) 2026-03-01 File taxes +home");
  const completed = completeTask(task, "2026-03-10");
  assert.equal(
    serializeTask(completed),
    "x 2026-03-10 2026-03-01 File taxes +home pri:B",
  );
  assert.equal(serializeTask(reopenTask(completed)), serializeTask(task));
});

test("sorts open before completed, then priority, creation date, and text", () => {
  const tasks = parseDocument(
    "later no priority\n(A) 2026-02-01 Zebra\n(B) 2026-01-01 Alpha\n(A) 2026-01-01 Beta\nx 2026-03-01 2026-01-01 done pri:B\nx 2026-03-01 2026-01-01 done first pri:A",
  );
  assert.deepEqual(
    sortTasks(tasks).map((task) => task.description),
    ["Beta", "Zebra", "Alpha", "later no priority", "done first", "done"],
  );
});

test("serializes a document with one newline per task", () => {
  assert.equal(serializeDocument(parseDocument("One\r\n\nTwo")), "One\nTwo\n");
});

test("parses recurrence modes and rejects malformed or excessive intervals", () => {
  assert.deepEqual(parseRecurrence("2w"), {
    strict: false,
    interval: 2,
    unit: "w",
  });
  assert.deepEqual(parseRecurrence("+10b"), {
    strict: true,
    interval: 10,
    unit: "b",
  });
  assert.equal(parseRecurrence("0d"), null);
  assert.equal(parseRecurrence("10000d"), null);
  assert.equal(parseRecurrence("+w"), null);
});

test("recurrence and threshold tags round-trip as todo.txt metadata", () => {
  const line = "Take vitamins t:2026-01-01 rec:+1d due:2026-01-02";
  assert.equal(serializeTask(parseTask(line)), line);
});

test("normal recurrence schedules from completion and carries the threshold offset", () => {
  const task = parseTask(
    "2026-01-01 Change filter +home due:2026-01-10 t:2026-01-08 rec:1w",
  );
  const next = nextRecurringTask(task, "2026-01-12", 20);
  assert.equal(
    serializeTask(next),
    "2026-01-12 Change filter +home due:2026-01-19 t:2026-01-17 rec:1w",
  );
  assert.equal(next.id, 20);
  assert.equal(next.completed, false);
});

test("strict recurrence skips missed dates to the next future occurrence", () => {
  const task = parseTask(
    "2026-01-01 Send report due:2026-01-10 t:2026-01-08 rec:+1w",
  );
  const next = nextRecurringTask(task, "2026-01-25");
  assert.equal(metadataValue(next, "due"), "2026-01-31");
  assert.equal(metadataValue(next, "t"), "2026-01-29");
  assert.equal(next.creationDate, "2026-01-25");
});

test("strict recurrence uses completion date without a due date", () => {
  const task = parseTask("Pay bills rec:+1m");
  const next = nextRecurringTask(task, "2026-01-31");
  assert.equal(metadataValue(next, "due"), "2026-02-28");
});

test("early completion keeps the next strict occurrence on its schedule", () => {
  const task = parseTask("Send report due:2026-01-10 rec:+1w");
  assert.equal(
    metadataValue(nextRecurringTask(task, "2026-01-01"), "due"),
    "2026-01-17",
  );
});

test("recurrence supports business days and month-end dates", () => {
  const businessTask = parseTask("Work task due:2026-03-02 rec:+1b");
  assert.equal(
    metadataValue(nextRecurringTask(businessTask, "2026-03-06"), "due"),
    "2026-03-09",
  );
  const monthlyTask = parseTask("Monthly task due:2026-01-31 rec:+1m");
  assert.equal(
    metadataValue(nextRecurringTask(monthlyTask, "2026-03-15"), "due"),
    "2026-03-31",
  );
});

test("metadata updates preserve token order and remove keys case-insensitively", () => {
  const task = parseTask("Task due:2026-01-01 rec:1d");
  const updated = setMetadataValue(task, "due", "2026-01-02");
  assert.equal(serializeTask(updated), "Task due:2026-01-02 rec:1d");
  assert.equal(
    serializeTask(setMetadataValue(updated, "REC", "")),
    "Task due:2026-01-02",
  );
});
