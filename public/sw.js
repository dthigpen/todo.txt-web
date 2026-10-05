const CACHE_NAME = "todo-txt-web-shell-v1";
const APP_SCOPE = self.registration.scope;
const SHELL_URLS = [
  new URL("./", APP_SCOPE).href,
  new URL("manifest.webmanifest", APP_SCOPE).href,
  new URL("icons/task-list-192.png", APP_SCOPE).href,
  new URL("icons/task-list-512.png", APP_SCOPE).href,
  new URL("icons/task-list.svg", APP_SCOPE).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(SHELL_URLS);
        const index = await cache.match(SHELL_URLS[0]);
        const html = await index.text();
        const bundledAssets = [
          ...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
        ].map(([, path]) => new URL(path, SHELL_URLS[0]).href);
        await cache.addAll(bundledAssets);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("todo-txt-web-shell-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.href.startsWith(APP_SCOPE)
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(request)) ||
            (await caches.match(new URL("./", APP_SCOPE).href));
          return (
            cached ||
            new Response("The app shell is not available offline yet.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  const assetDirectory = new URL("assets/", APP_SCOPE).pathname;
  const iconDirectory = new URL("icons/", APP_SCOPE).pathname;
  const manifestPath = new URL("manifest.webmanifest", APP_SCOPE).pathname;
  const isBundledAsset =
    url.pathname.startsWith(assetDirectory) &&
    /\.(?:js|css|woff2)$/.test(url.pathname);
  const isAppIcon =
    url.pathname.startsWith(iconDirectory) &&
    /\.(?:svg|png)$/.test(url.pathname);
  if (!isBundledAsset && !isAppIcon && url.pathname !== manifestPath) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
