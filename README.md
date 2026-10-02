# todo.txt Web

A simple, local-first task manager with projects, contexts, priorities, and
due dates. Use it with browser storage alone, or optionally connect it to
[Plain File Server](https://github.com/dthigpen/plain-file-server) to open your
task lists from a server. Lists stay portable as plain-text todo files.

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
document is `todo.txt`.

## Optional Plain File Server

Open **Files & settings**, enter the server API URL (for example,
`http://127.0.0.1:3000/api`), and sign in. Choose an existing accessible path
or enter another path, such as `household/todo.txt`, if your account has access.
The server enforces path permissions. Use the checkboxes in settings to choose
which readable server files are task lists; other server files stay out of the
main list picker.

The app caches the current document locally and writes remote changes with
`If-Match` using its latest ETag. If you go offline, edits stay saved in this
browser and sync automatically when the server is reachable again. A sync
indicator shows which lists are waiting. If another client changes a file
first, or a save response is lost during a connection drop, the app preserves
your local copy and flags the conflict rather than silently overwriting the
server version. **Review & resolve** loads the latest server copy and lets you
use the server version, use your device's version, or select individual tasks
from both into a merge. Unchanged tasks are included automatically and hidden
until expanded. Added and removed lines are identified against the last shared
version; checking a removed task restores it. Task edits appear as a removal
and an addition because todo.txt lines have no unique IDs. **Keep all tasks
from either copy** is available, with a warning that it may restore intentional
deletions. The resolved version syncs using the server's latest ETag. Use
HTTPS or a trusted private network for remote access. The login token is stored
in this browser's localStorage; log out on shared devices.

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
after GitHub Pages is configured to use **GitHub Actions** as its source.

See [DESIGN.md](DESIGN.md) for the product behavior, file format rules, and
implementation scope.
