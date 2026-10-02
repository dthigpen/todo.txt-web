import test from "node:test";
import assert from "node:assert/strict";
import {
  completeTask,
  parseDocument,
  parseTask,
  reopenTask,
  serializeDocument,
  serializeTask,
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
