import test from "node:test";
import assert from "node:assert/strict";
import { settlePendingWrite } from "./syncQueue.js";

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
