import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const distDirectory = path.resolve("dist");
const html = await readFile(path.join(distDirectory, "index.html"), "utf8");

if (html.includes("/src/main.jsx") || html.includes("src/main.jsx")) {
  throw new Error(
    "dist/index.html still points at the Vite source entry instead of a built asset.",
  );
}

const bundledAssets = [
  ...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
].map(([, url]) => url);

if (!bundledAssets.some((url) => url.endsWith(".js"))) {
  throw new Error(
    "dist/index.html does not reference a bundled JavaScript file.",
  );
}
if (!bundledAssets.some((url) => url.endsWith(".css"))) {
  throw new Error("dist/index.html does not reference a bundled CSS file.");
}

for (const url of bundledAssets) {
  const assetPath = path.resolve(distDirectory, url);
  if (!assetPath.startsWith(`${distDirectory}${path.sep}`)) {
    throw new Error(`Built asset path escapes dist/: ${url}`);
  }
  await stat(assetPath);
}

for (const file of [
  "manifest.webmanifest",
  "sw.js",
  "icons/task-list-192.png",
  "icons/task-list-512.png",
]) {
  await stat(path.join(distDirectory, file));
}

console.log(
  `Pages artifact verified: built entry, ${bundledAssets.length} bundled assets, manifest, service worker, and icons.`,
);
