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
      "https://files.example/api/v1/files/household/todo%20list.txt",
    );
    assert.deepEqual(result, {
      content: "task\n",
      etag: '"quoted-etag"',
      exists: true,
      unchanged: false,
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
    assert.equal(request.url, "https://files.example/api/v1/files/todo.txt");
    assert.equal(request.options.method, "PUT");
    assert.equal(request.options.headers["If-Match"], '"current-etag"');
    assert.equal(request.options.body, "new task\n");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates a remote file with an empty body when no ETag exists", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  try {
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(null, {
        status: 201,
        headers: { ETag: '"new-file-etag"' },
      });
    };
    const response = await writeFile(
      "https://files.example/api",
      "token",
      "household/foo/bar.txt",
      "",
      null,
    );
    assert.equal(
      request.url,
      "https://files.example/api/v1/files/household/foo/bar.txt",
    );
    assert.equal(request.options.method, "PUT");
    assert.equal(request.options.body, "");
    assert.equal(request.options.headers["If-Match"], undefined);
    assert.equal(response.headers.get("ETag"), '"new-file-etag"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checks a remote file conditionally and recognizes an unchanged response", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  try {
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(null, {
        status: 304,
        headers: { ETag: '"current-etag"' },
      });
    };
    const result = await readFile(
      "https://files.example/api",
      "token",
      "todo.txt",
      '"known-etag"',
    );
    assert.equal(request.url, "https://files.example/api/v1/files/todo.txt");
    assert.equal(request.options.headers["If-None-Match"], '"known-etag"');
    assert.deepEqual(result, {
      content: null,
      etag: '"current-etag"',
      exists: true,
      unchanged: true,
    });
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
