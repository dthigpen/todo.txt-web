# todo.txt Web — Design

## Product

todo.txt Web is a lightweight, local-first task manager with projects,
contexts, priorities, and other useful task features. Lists remain portable in
the plain-text [todo.txt format](https://todotxt.org/) and work with editors,
scripts, and other apps. Plain File Server is an optional remote file API, not
a requirement for using the app.

## Goals

- Make everyday task entry and organization quick, clear, and keyboard-friendly.
- Keep files interoperable: projects (`+project`), contexts (`@context`),
  priorities, dates, and key-value metadata stay in todo.txt lines.
- Work immediately without an account or server, saving files in browser
  storage with straightforward import and export.
- Let users open multiple files, including files on Plain File Server, by
  logical path. The default file is `todo.txt`; server permissions determine
  which paths can be read or written.
- Avoid silently overwriting newer changes. Use Plain File Server ETags and
  conditional writes; report conflicts for user action.

## User experience

### Task list

- Show open tasks before completed tasks, then priority A–Z (including a
  completed task's `pri:` value; unprioritized after prioritized), creation
  date (oldest first, missing dates last), and task text.
- Offer open/completed/all views, text search, project/context facets, and
  compact task metadata.
- Quick-add a task with a creation date added automatically.
- Completing a task prefixes `x` and today's completion date. If it has a
  priority, remove `(A)` and preserve its former value as `pri:A` metadata.
- Reopening removes the completion marker/date and restores a priority from
  `pri:` when available.

### Task editor

Clicking a task opens a friendly editor with one task-description field and
controls for priority, creation date, due date, projects, contexts, and
key-value metadata. Project and context entry accepts Enter, spaces, or commas,
and offers suggestions from the current list. A toggle reveals the raw
todo.txt line for users who prefer direct editing or need unknown syntax.
Saving composes a valid interoperable line.

### Files and settings

- Local mode is the default. Keep a separate browser-stored document for each
  selected logical file name; import a `.txt` file and export the current
  content without changing its line format.
- Optional Plain File Server mode has a configurable API URL, login, a list of
  readable file paths, and a path field for other files the user can access.
- Select, create, and switch paths explicitly. Never assume every writable
  path is discoverable from the server's read-only file listing.
- Let users mark which readable server files are task lists; keep other server
  files out of the main list switcher while allowing manually entered paths.
- Put list switching in the main view next to the current list; keep settings
  for list creation, import/export, and server connection.
- Allow browser-local lists to be renamed, deleted, and exported individually.
- Keep a durable per-file queue of remote edits in browser storage when the
  server is unavailable. Retry when connectivity returns; show pending-sync
  state and never retry a stale write after a 412 without user review.
- For a server conflict, fetch the latest server version and let users keep
  either full copy or select individual tasks from both copies into a merge.
  Compare against the last common saved content to identify added and removed
  lines. Unchanged tasks are included but hidden by default; the resolved copy
  syncs conditionally using the latest server ETag. Since task lines have no
  stable IDs, edited tasks appear as a removal and an addition.

## Format behavior

Each nonblank line is one task. Recognized syntax includes:

- Completion marker `x` and completion date (`YYYY-MM-DD`).
- Priority `(A)` through `(Z)`.
- Creation date (`YYYY-MM-DD`).
- Projects (`+name`), contexts (`@name`), and key/value tokens (`key:value`).
- Due date convention `due:YYYY-MM-DD` (also treated as key/value metadata).

Unknown words and tokens stay in the raw line. Blank lines are ignored in the
task list; imports preserve task lines rather than arbitrary whitespace.
Mutations serialize one task per line with a final newline when nonempty.

## Technical approach

- Preact with Signals for the small reactive UI.
- Vite for development/build, with relative asset paths for GitHub Pages.
- LocalStorage for lightweight browser-only document/config persistence.
- Plain File Server REST API as an optional backend, using `GET /api/files`,
  `GET /api/files/{path}`, `PUT /api/files/{path}`, login JWTs, and ETags.
- ESLint, Prettier, and Node's built-in test runner; GitHub Actions builds and
  publishes the static site to GitHub Pages.

## Initial implementation scope

The first increment provides task parsing/sorting, quick add, completion and
reopen behavior, a structured plus raw-line edit dialog, local multi-file
storage, import/export, optional server login/path selection, conditional
remote writes, offline change queues, and an interactive conflict resolver.
History UI, recurrence, notifications, and collaborative editing remain out
of scope until experience with the core file workflow justifies them.
