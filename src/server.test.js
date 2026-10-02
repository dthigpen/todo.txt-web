import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "./server.js";

test("reads a server file using its logical path and captures its ETag", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  try {
    globalThis.fetch = async (url) => {
      requestUrl = url;
      return new Response("task\n", {
        headers: { ETag: '"quoted-etag"' },
      });
    };
    const result = await readFile(
      "https://files.example/api/",
      "token",
      "household/todo list.txt",
    );
    assert.equal(
      requestUrl,
      "https://files.example/api/files/household/todo%20list.txt",
    );
    assert.deepEqual(result, {
      content: "task\n",
      etag: '"quoted-etag"',
      exists: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updates a remote file conditionally with its current ETag", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  try {
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(null, { status: 200 });
    };
    await writeFile(
      "https://files.example/api",
      "token",
      "todo.txt",
      "new task\n",
      '"current-etag"',
    );
    assert.equal(request.options.method, "PUT");
    assert.equal(request.options.headers["If-Match"], '"current-etag"');
    assert.equal(request.options.body, "new task\n");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves fetch network errors so offline sync can retry them", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(
      writeFile(
        "https://files.example/api",
        "token",
        "todo.txt",
        "task\n",
        '"current-etag"',
      ),
      (error) =>
        error instanceof TypeError && error.message === "Failed to fetch",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
