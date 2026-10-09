# todo.txt Web

**[Try it live →](https://dthigpen.github.io/todo.txt-web/)**

A simple, local-first task manager with projects, contexts, priorities, due
dates, start dates, and recurring tasks. Use it with browser storage alone, or
optionally connect it to
[Plain File Server](https://github.com/dthigpen/plain-file-server) to open your
task lists from a server. Lists stay portable as plain-text todo files.

![Screenshot of todo.txt Web showing the task list, filters, and scheduled tasks](todotxt-web.png)

## Get started

Requires Node.js 20.19 or newer.

```sh
npm install
npm run dev
```

The app starts in local mode and saves changes in your browser. Use **Files**
to switch between documents, import a todo.txt file, or export the current
file. Create additional lists there, or rename, delete, and export saved lists.
Switch lists from **Current list** beside the task filters. The default
document is `todo.txt`; the app remembers the last list you used. Install it
from a supported browser to launch it like an app. Its static app shell is
cached for offline startup, while your lists and edits are stored locally in
the browser.

## Optional Plain File Server

Connect to a [Plain File Server](https://github.com/dthigpen/plain-file-server)
to open your task lists from a server instead of browser storage.

**Connecting.** Open **Files & settings**, enter the server API URL (for
example, `http://127.0.0.1:3000/api`), and sign in. Pick an accessible path or
type your own (such as `household/todo.txt`); the server enforces permissions.
Use the checkboxes to mark which readable files are task lists, and the **+**
button to create a new file. The file browser has search and collapsible
folders.

**Offline and syncing.** Selected lists are cached locally, so you can view and
edit them offline or signed out. Edits are saved in this browser and sync
automatically when the server is reachable; a sync indicator shows which lists
are waiting. Completing, reopening, or editing a task offers a brief Undo.

**Conflicts.** The app writes conditionally (ETags) and never silently
overwrites newer server changes. If another client edited the file first,
**Review & resolve** loads the latest server copy and lets you keep the server
version, your device's version, or merge individual tasks. Related lines from a
single action (like completing a task) are grouped together for easier review.

**Security.** Use HTTPS or a trusted private network. The login token is stored
in this browser's localStorage, so log out on shared devices. For cross-origin
deployments, CORS must allow the app's GitHub Pages origin and the
`If-None-Match` request header. Login errors from mixed content, untrusted
certificates, or CORS include troubleshooting hints.

## Scripts

```sh
npm run dev          # local development
npm test             # parser and task behavior tests
npm run lint         # ESLint
npm run format       # apply Prettier
npm run format:check # verify formatting
npm run build        # static production build
npm run preview      # preview the production build
```

The Vite build uses relative paths and is ready to publish as a static GitHub
Pages site. The repository workflow builds and deploys on pushes to `main`
after GitHub Pages is configured to use **GitHub Actions** as its source
(Repository **Settings → Pages → Build and deployment → Source → GitHub Actions**).
Do not select **Deploy from a branch**: that serves the unbuilt repository
files, including `src/main.jsx`, and results in a blank page. The workflow
checks that `dist/` contains bundled JavaScript and CSS before it uploads the
Pages artifact.

See [DESIGN.md](DESIGN.md) for the product behavior, file format rules, and
implementation scope.
