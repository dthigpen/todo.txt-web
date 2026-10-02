function apiUrl(base, endpoint) {
  return `${base.replace(/\/+$/, "")}${endpoint}`;
}

function headers(token, extras = {}) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extras,
  };
}

async function checked(response) {
  if (response.ok) return response;
  let details = "";
  try {
    const body = await response.json();
    details = body.error || body.message || "";
  } catch {
    // Error bodies are optional; status text still gives a useful failure.
  }
  const error = new Error(
    `${response.status} ${response.statusText}${details ? `: ${details}` : ""}`,
  );
  error.status = response.status;
  throw error;
}

export async function login(base, username, password) {
  const response = await checked(
    await fetch(apiUrl(base, "/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
  return response.json();
}

export async function listFiles(base, token) {
  const response = await checked(
    await fetch(apiUrl(base, "/files"), { headers: headers(token) }),
  );
  const body = await response.json();
  if (
    !Array.isArray(body.files) ||
    !body.files.every((path) => typeof path === "string")
  ) {
    throw new Error("The server returned an invalid file listing.");
  }
  return body.files;
}

function pathUrl(base, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return apiUrl(base, `/files/${encoded}`);
}

export async function readFile(base, token, path) {
  const response = await fetch(pathUrl(base, path), {
    headers: headers(token),
  });
  if (response.status === 404)
    return { content: "", etag: null, exists: false };
  await checked(response);
  return {
    content: await response.text(),
    etag: response.headers.get("ETag"),
    exists: true,
  };
}

export async function writeFile(base, token, path, content, etag) {
  return checked(
    await fetch(pathUrl(base, path), {
      method: "PUT",
      headers: headers(token, {
        "Content-Type": "text/plain; charset=utf-8",
        ...(etag ? { "If-Match": etag } : {}),
      }),
      body: content,
    }),
  );
}
