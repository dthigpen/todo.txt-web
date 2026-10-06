import test from "node:test";
import assert from "node:assert/strict";
import { classifyRemoteContent, settlePendingWrite } from "./syncQueue.js";

test("removes a queued write after the same content is confirmed", () => {
  const queue = {
    "server:https://files/api:todo.txt": {
      content: "task\n",
      status: "pending",
    },
  };
  assert.deepEqual(
    settlePendingWrite(
      queue,
      "server:https://files/api:todo.txt",
      "task\n",
      '"etag-2"',
    ),
    {},
  );
  assert.equal(Object.keys(queue).length, 1);
});

test("keeps edits made during a request and advances their ETag", () => {
  const queue = {
    "server:https://files/api:todo.txt": {
      content: "newer task\n",
      baseContent: "old task\n",
      status: "pending",
      etag: '"etag-1"',
    },
  };
  assert.deepEqual(
    settlePendingWrite(
      queue,
      "server:https://files/api:todo.txt",
      "older task\n",
      '"etag-2"',
    ),
    {
      "server:https://files/api:todo.txt": {
        content: "newer task\n",
        baseContent: "older task\n",
        status: "pending",
        etag: '"etag-2"',
      },
    },
  );
});

test("classifies remote changes for safe fast-forward and conflict handling", () => {
  const remote = { exists: true, unchanged: false, content: "server\n" };
  assert.equal(classifyRemoteContent("old\n", null, remote), "fast-forward");
  assert.equal(classifyRemoteContent("server\n", null, remote), "unchanged");
  assert.equal(
    classifyRemoteContent(
      "device\n",
      { content: "device\n", baseContent: "old\n", status: "pending" },
      remote,
    ),
    "conflict",
  );
  assert.equal(
    classifyRemoteContent(
      "device\n",
      { content: "device\n", baseContent: "old\n", status: "pending" },
      { ...remote, content: "old\n" },
    ),
    "retry",
  );
  assert.equal(
    classifyRemoteContent(
      "device\n",
      { content: "device\n", baseContent: "old\n", status: "pending" },
      { ...remote, unchanged: true, content: null },
    ),
    "retry",
  );
  assert.equal(
    classifyRemoteContent(
      "device\n",
      { content: "device\n", baseContent: "old\n", status: "pending" },
      { ...remote, content: "device\n" },
    ),
    "already-synced",
  );
  assert.equal(
    classifyRemoteContent(
      "device\n",
      { content: "device\n", baseContent: "old\n", status: "pending" },
      { exists: false, unchanged: false, content: "" },
    ),
    "deleted",
  );
  assert.equal(
    classifyRemoteContent(
      "device\n",
      { content: "device\n", baseContent: "old\n", status: "conflict" },
      { ...remote, unchanged: true, content: null },
    ),
    "conflict",
  );
});
