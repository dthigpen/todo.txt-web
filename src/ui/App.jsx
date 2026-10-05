import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import {
  completeTask,
  parseDocument,
  parseTask,
  reopenTask,
  serializeDocument,
  serializeTask,
  sortTasks,
  today,
} from "../todoTxt.js";
import { createMergeRows, serializeMergeRows } from "../conflictMerge.js";
import { settlePendingWrite } from "../syncQueue.js";
import { listFiles, login, readFile, writeFile } from "../server.js";
import { loadLastList, saveLastList } from "../lastList.js";
import { buildServerFileTree, countServerFiles } from "../serverFileTree.js";

const DOCS_KEY = "todo-txt-web.documents";
const SETTINGS_KEY = "todo-txt-web.server";
const PENDING_KEY = "todo-txt-web.pending-sync";
const ETAGS_KEY = "todo-txt-web.server-etags";
const storageError = signal("");
const storageErrorDismissed = signal(false);
const documents = signal(loadDocuments());
const serverSettings = signal(loadServerSettings());
const currentKey = signal(loadCurrentKey());
const pendingQueue = signal(loadPendingQueue());
const serverEtags = signal(loadStoredObject(ETAGS_KEY));
const activeRemotePath = signal(
  getRemotePath(currentKey.value, serverSettings.value.base),
);
const remoteState = signal({
  etag:
    pendingQueue.value[currentKey.value]?.etag ??
    serverEtags.value[currentKey.value] ??
    null,
});

function loadCurrentKey() {
  try {
    const saved = loadLastList(localStorage, "local:todo.txt");
    const isLocalList = saved.startsWith("local:");
    const isKnownRemoteList =
      getRemotePath(saved, serverSettings.value.base).length > 0;
    return documents.value[saved] !== undefined &&
      (isLocalList || isKnownRemoteList)
      ? saved
      : "local:todo.txt";
  } catch (error) {
    reportStorageError(
      `Could not restore the last open list: ${error.message}.`,
    );
    return "local:todo.txt";
  }
}

function getRemotePath(key, base) {
  const prefix = base ? `server:${base.replace(/\/+$/, "")}:` : "";
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : "";
}

function selectCurrentKey(key) {
  currentKey.value = key;
  try {
    saveLastList(localStorage, key);
  } catch (error) {
    reportStorageError(
      `Could not remember the current list: ${error.message}.`,
    );
  }
}

function loadStoredObject(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("saved data is not in the expected format");
    }
    return parsed;
  } catch (error) {
    reportStorageError(`Could not load saved data: ${error.message}.`);
    return {};
  }
}

function loadPendingQueue() {
  const saved = loadStoredObject(PENDING_KEY);
  const validStatuses = new Set(["pending", "error", "conflict"]);
  const entries = Object.entries(saved);
  if (
    entries.some(
      ([, item]) =>
        !item ||
        typeof item.base !== "string" ||
        typeof item.path !== "string" ||
        typeof item.content !== "string" ||
        !validStatuses.has(item.status) ||
        (item.etag !== null && typeof item.etag !== "string") ||
        (item.baseContent !== undefined &&
          typeof item.baseContent !== "string"),
    )
  ) {
    reportStorageError(
      "Could not load the pending server changes because their saved data is invalid.",
    );
    return {};
  }
  return saved;
}

function persistObject(key, value, setRevision) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    reportStorageError(`Could not save browser data: ${error.message}.`);
  }
  if (setRevision) setRevision((revision) => revision + 1);
}

function loadDocuments() {
  try {
    const saved = localStorage.getItem(DOCS_KEY);
    if (saved === null) return { "local:todo.txt": "" };
    const parsed = JSON.parse(saved);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Object.values(parsed).every((content) => typeof content === "string")
    ) {
      throw new Error("saved documents are not in the expected format");
    }
    return parsed;
  } catch (error) {
    reportStorageError(
      `Could not load saved browser documents: ${error.message}.`,
    );
    return { "local:todo.txt": "" };
  }
}

function loadServerSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch (error) {
    reportStorageError(
      `Could not load saved server settings: ${error.message}.`,
    );
    return {};
  }
}

function saveDocuments(value) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(value));
  } catch (error) {
    reportStorageError(`Could not save browser data: ${error.message}.`);
  }
}

function saveSettings(value) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch (error) {
    reportStorageError(`Could not save server settings: ${error.message}.`);
  }
}

function reportStorageError(message) {
  storageError.value = message;
  storageErrorDismissed.value = false;
}

function documentContent(key) {
  return documents.value[key] || "";
}

function fileKey(base, path) {
  return `server:${base.replace(/\/+$/, "")}:${path}`;
}

function isValidLocalPath(value) {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function App() {
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [contextFilter, setContextFilter] = useState("");
  const [includeCompletedFacets, setIncludeCompletedFacets] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conflictDialogKey, setConflictDialogKey] = useState("");
  const [editorTask, setEditorTask] = useState(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [notice, setNotice] = useState("");
  const [serverFiles, setServerFiles] = useState(
    Array.isArray(serverSettings.value.knownFiles)
      ? serverSettings.value.knownFiles
      : [],
  );
  const [serverError, setServerError] = useState("");
  const [authHint, setAuthHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [quickDescription, setQuickDescription] = useState("");
  const [exportKey, setExportKey] = useState(currentKey.value);
  const [remotePathInput, setRemotePathInput] = useState("");
  const [username, setUsername] = useState(serverSettings.value.username || "");
  const [password, setPassword] = useState("");
  const [apiBase, setApiBase] = useState(
    serverSettings.value.base || "http://127.0.0.1:3000/api",
  );
  const searchRef = useRef(null);
  const importRef = useRef(null);
  const saveTimer = useRef(null);
  const syncBusy = useRef(new Set());
  const quickAddRef = useRef(null);
  const tasks = useMemo(
    () => parseDocument(documentContent(currentKey.value)),
    [documents.value, currentKey.value, documentRevision],
  );

  useEffect(() => {
    if (serverSettings.value.token) {
      refreshServerFiles();
      Object.keys(pendingQueue.value).forEach((key) => syncPending(key));
    }
  }, []);

  useEffect(() => {
    function handleInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      Object.keys(pendingQueue.value).forEach((key) => syncPending(key));
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const retry = window.setInterval(() => {
      if (navigator.onLine) {
        Object.keys(pendingQueue.value).forEach((key) => syncPending(key));
      }
    }, 30_000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(retry);
    };
  }, []);

  useEffect(() => {
    function handleKey(event) {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setEditorTask(null);
        setTaskDialogOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      Object.keys(pendingQueue.value).forEach((key) => syncPending(key));
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [queueRevision, isOnline]);

  async function refreshServerFiles() {
    try {
      const files = await listFiles(
        serverSettings.value.base,
        serverSettings.value.token,
      );
      setServerFiles(files);
      const nextSettings = { ...serverSettings.value, knownFiles: files };
      serverSettings.value = nextSettings;
      saveSettings(nextSettings);
      setIsOnline(true);
      setServerError("");
    } catch (error) {
      if (error instanceof TypeError || !navigator.onLine) {
        setIsOnline(false);
      } else {
        setServerError(error.message);
      }
    }
  }

  function updateContent(content) {
    const previousContent = documentContent(currentKey.value);
    const next = { ...documents.value, [currentKey.value]: content };
    documents.value = next;
    saveDocuments(next);
    setDocumentRevision((revision) => revision + 1);
    if (activeRemotePath.value) {
      const existing = pendingQueue.value[currentKey.value];
      const queued = {
        ...(existing || {}),
        base: serverSettings.value.base,
        baseContent: existing?.baseContent ?? previousContent,
        path: activeRemotePath.value,
        content,
        etag: existing?.etag ?? remoteState.value.etag,
        status: existing?.status === "conflict" ? "conflict" : "pending",
      };
      const nextQueue = { ...pendingQueue.value, [currentKey.value]: queued };
      pendingQueue.value = nextQueue;
      persistObject(PENDING_KEY, nextQueue, setQueueRevision);
    }
  }

  function updateTasks(nextTasks) {
    updateContent(serializeDocument(nextTasks));
  }

  async function syncPending(key) {
    const item = pendingQueue.value[key];
    if (
      !item ||
      item.status !== "pending" ||
      syncBusy.current.has(key) ||
      !serverSettings.value.token ||
      serverSettings.value.base?.replace(/\/+$/, "") !== item.base
    ) {
      return;
    }
    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    syncBusy.current.add(key);
    try {
      const response = await writeFile(
        item.base,
        serverSettings.value.token,
        item.path,
        item.content,
        item.etag,
      );
      const etag = response.headers.get("ETag");
      const nextEtags = { ...serverEtags.value, [key]: etag };
      serverEtags.value = nextEtags;
      persistObject(ETAGS_KEY, nextEtags);

      const nextQueue = settlePendingWrite(
        pendingQueue.value,
        key,
        item.content,
        etag,
      );
      pendingQueue.value = nextQueue;
      persistObject(PENDING_KEY, nextQueue, setQueueRevision);
      if (currentKey.value === key) {
        remoteState.value = { etag };
      }
      setIsOnline(true);
      if (!Object.keys(nextQueue).length) setNotice("All changes synced");
    } catch (error) {
      const latest = pendingQueue.value[key];
      if (error.status === 412 || error.status === 428) {
        let verificationError = "";
        try {
          const serverCopy = await readFile(
            item.base,
            serverSettings.value.token,
            item.path,
          );
          if (serverCopy.content === item.content) {
            const nextEtags = { ...serverEtags.value };
            if (serverCopy.etag) nextEtags[key] = serverCopy.etag;
            else delete nextEtags[key];
            serverEtags.value = nextEtags;
            persistObject(ETAGS_KEY, nextEtags);

            const nextQueue = settlePendingWrite(
              pendingQueue.value,
              key,
              item.content,
              serverCopy.etag,
            );
            if (nextQueue[key]) {
              nextQueue[key] = {
                ...nextQueue[key],
                baseContent: item.content,
              };
            }
            pendingQueue.value = nextQueue;
            persistObject(PENDING_KEY, nextQueue, setQueueRevision);
            if (currentKey.value === key)
              remoteState.value = { etag: serverCopy.etag };
            setIsOnline(true);
            if (!nextQueue[key])
              setNotice(`All changes synced for ${item.path}`);
            return;
          }
        } catch (readError) {
          if (readError instanceof TypeError || !navigator.onLine) {
            setIsOnline(false);
          } else {
            verificationError = `Could not verify the server copy of ${item.path}: ${readError.message}`;
          }
        }
        const nextQueue = {
          ...pendingQueue.value,
          [key]: { ...latest, status: "conflict" },
        };
        pendingQueue.value = nextQueue;
        persistObject(PENDING_KEY, nextQueue, setQueueRevision);
        setServerError(verificationError);
      } else if (error instanceof TypeError || !navigator.onLine) {
        setIsOnline(false);
      } else {
        const nextQueue = {
          ...pendingQueue.value,
          [key]: { ...latest, status: "error", message: error.message },
        };
        pendingQueue.value = nextQueue;
        persistObject(PENDING_KEY, nextQueue, setQueueRevision);
        setServerError(`Could not sync ${item.path}: ${error.message}`);
      }
    } finally {
      syncBusy.current.delete(key);
    }
  }

  function retryFailedSyncs() {
    const nextQueue = { ...pendingQueue.value };
    for (const [key, item] of Object.entries(nextQueue)) {
      if (item.status === "error")
        nextQueue[key] = { ...item, status: "pending" };
    }
    pendingQueue.value = nextQueue;
    persistObject(PENDING_KEY, nextQueue, setQueueRevision);
    Object.keys(nextQueue).forEach((key) => syncPending(key));
  }

  function signInToSync() {
    setExportKey(currentKey.value);
    setSettingsOpen(true);
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function addTask(event) {
    event.preventDefault();
    const input = new FormData(event.currentTarget)
      .get("task")
      .toString()
      .trim();
    if (!input) return;
    const task = parseTask(input, Date.now());
    task.completed = false;
    task.completionDate = "";
    task.creationDate ||= today();
    updateTasks([
      { ...task, creationDate: task.creationDate || today() },
      ...tasks,
    ]);
    event.currentTarget.reset();
    setNotice("Task added");
  }

  function toggleTask(task) {
    const changed = task.completed
      ? reopenTask(task)
      : completeTask(task, today());
    updateTasks(tasks.map((item) => (item.id === task.id ? changed : item)));
  }

  function removeTask(task) {
    updateTasks(tasks.filter((item) => item.id !== task.id));
  }

  function saveEditedTask(nextTask) {
    if (editorTask) {
      updateTasks(
        tasks.map((item) => (item.id === editorTask.id ? nextTask : item)),
      );
    } else {
      updateTasks([
        { ...nextTask, creationDate: nextTask.creationDate || today() },
        ...tasks,
      ]);
    }
    setEditorTask(null);
    setTaskDialogOpen(false);
    if (!editorTask && quickAddRef.current) {
      quickAddRef.current.value = "";
      setQuickDescription("");
    }
    setNotice(editorTask ? "Task updated" : "Task added");
  }

  async function addLocalFile(event) {
    event.preventDefault();
    const path = newFileName.trim();
    if (!path) return;
    if (!isValidLocalPath(path)) {
      setServerError(
        "Use a relative list name without empty, . or .. path parts.",
      );
      return;
    }
    const key = `local:${path}`;
    const alreadyExists = key in documents.value;
    if (!alreadyExists) {
      const next = { ...documents.value, [key]: "" };
      documents.value = next;
      saveDocuments(next);
      setDocumentRevision((revision) => revision + 1);
    }
    selectCurrentKey(key);
    activeRemotePath.value = "";
    remoteState.value = { etag: null };
    setNewFileName("");
    setNotice(alreadyExists ? `Opened ${path}` : `Created ${path}`);
  }

  async function importFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      updateContent(await file.text());
      setNotice(`Imported ${file.name}`);
    } catch (error) {
      setServerError(`Could not import ${file.name}: ${error.message}`);
    } finally {
      input.value = "";
    }
  }

  function exportFile(key = currentKey.value) {
    const serverPrefix = `server:${serverSettings.value.base?.replace(/\/+$/, "")}:`;
    const name = key.startsWith("local:")
      ? key.slice("local:".length)
      : key.startsWith(serverPrefix)
        ? key.slice(serverPrefix.length)
        : key;
    const filename = name.split("/").pop() || "todo.txt";
    const blob = new Blob([documentContent(key)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".txt") ? filename : `${filename}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renameLocalFile(key) {
    const oldName = key.replace(/^local:/, "");
    const newName = window.prompt("Rename this list", oldName)?.trim();
    if (!newName || newName === oldName) return;
    if (!isValidLocalPath(newName)) {
      setServerError(
        "Use a relative list name without empty, . or .. path parts.",
      );
      return;
    }
    const newKey = `local:${newName}`;
    if (newKey in documents.value) {
      setServerError(`A list named "${newName}" already exists.`);
      return;
    }
    const next = { ...documents.value, [newKey]: documents.value[key] };
    delete next[key];
    documents.value = next;
    saveDocuments(next);
    setDocumentRevision((revision) => revision + 1);
    if (currentKey.value === key) selectCurrentKey(newKey);
    if (exportKey === key) setExportKey(newKey);
    setNotice(`Renamed to ${newName}`);
  }

  function deleteLocalFile(key) {
    const name = key.replace(/^local:/, "");
    if (
      !window.confirm(`Delete the local list "${name}"? This cannot be undone.`)
    )
      return;
    const next = { ...documents.value };
    delete next[key];
    documents.value = next;
    saveDocuments(next);
    setDocumentRevision((revision) => revision + 1);
    const remainingLocalFiles = Object.keys(next)
      .filter((fileKey) => fileKey.startsWith("local:"))
      .sort();
    const startedDefaultList = remainingLocalFiles.length === 0;
    if (startedDefaultList) {
      next["local:todo.txt"] = "";
      saveDocuments(next);
      documents.value = next;
      remainingLocalFiles.push("local:todo.txt");
    }
    if (currentKey.value === key) {
      selectCurrentKey(remainingLocalFiles[0] || "local:todo.txt");
    }
    if (exportKey === key) setExportKey(currentKey.value);
    setNotice(
      startedDefaultList
        ? `Deleted ${name} and started a new empty todo.txt list.`
        : `Deleted ${name}`,
    );
  }

  function toggleServerFile(path, selected) {
    const currentSelection = Array.isArray(serverSettings.value.selectedFiles)
      ? serverSettings.value.selectedFiles
      : [];
    const selectedFiles = new Set(currentSelection);
    if (selected) selectedFiles.add(path);
    else selectedFiles.delete(path);
    const next = {
      ...serverSettings.value,
      selectedFiles: [...selectedFiles].sort(),
    };
    serverSettings.value = next;
    saveSettings(next);
    setDocumentRevision((revision) => revision + 1);
  }

  async function connect(event) {
    event.preventDefault();
    setBusy(true);
    setServerError("");
    try {
      const result = await login(apiBase, username, password);
      if (typeof result.token !== "string" || !result.token) {
        throw new Error("The server did not return a login token.");
      }
      const next = {
        base: apiBase.replace(/\/+$/, ""),
        username,
        token: result.token,
        knownFiles:
          serverSettings.value.base?.replace(/\/+$/, "") ===
          apiBase.replace(/\/+$/, "")
            ? serverSettings.value.knownFiles || []
            : [],
        selectedFiles:
          serverSettings.value.base?.replace(/\/+$/, "") ===
          apiBase.replace(/\/+$/, "")
            ? serverSettings.value.selectedFiles || []
            : [],
      };
      serverSettings.value = next;
      saveSettings(next);
      setPassword("");
      setAuthHint("");
      await refreshServerFiles();
      retryFailedSyncs();
      setNotice("Connected to Plain File Server");
    } catch (error) {
      if (error instanceof TypeError) {
        const isMixedContent =
          window.location.protocol === "https:" && /^http:/i.test(apiBase);
        setAuthHint(
          isMixedContent
            ? "The app is loaded over HTTPS but this API URL uses HTTP. Browsers block that request as mixed content; use the server's HTTPS URL."
            : `The browser could not read a response from the server. Check that this device can reach the API and trusts its HTTPS certificate. If CORS is enabled, allow origin ${window.location.origin}, OPTIONS and GET/POST/PUT, request headers Authorization/Content-Type/If-Match, and expose the ETag response header.`,
        );
        setServerError("");
      } else {
        setAuthHint("");
        setServerError(`Could not sign in: ${error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    if (exportKey.startsWith("server:")) setExportKey("local:todo.txt");
    serverSettings.value = {
      ...serverSettings.value,
      token: undefined,
    };
    saveSettings(serverSettings.value);
    setNotice(
      activeRemotePath.value
        ? "Signed out. This server list remains available from its saved copy."
        : "Disconnected",
    );
  }

  async function openRemote(path = remotePathInput) {
    const cleanPath = path.trim().replace(/^\/+/, "");
    if (
      !cleanPath ||
      cleanPath
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    ) {
      setServerError(
        "Enter a valid relative file path, such as household/todo.txt.",
      );
      return;
    }
    if (!serverSettings.value.base) {
      setServerError("Connect to a server before opening a server path.");
      return;
    }
    const base = serverSettings.value.base.replace(/\/+$/, "");
    const key = fileKey(base, cleanPath);
    const queued = pendingQueue.value[key];
    const cachedContent = documents.value[key];

    if (queued || !serverSettings.value.token || !navigator.onLine) {
      if (!queued && cachedContent === undefined) {
        setServerError(
          `No saved copy of ${cleanPath} is on this device yet. Connect to the server once while online to download it.`,
        );
        return;
      }
      selectCurrentKey(key);
      activeRemotePath.value = cleanPath;
      remoteState.value = {
        etag: queued?.etag ?? serverEtags.value[key] ?? null,
      };
      setRemotePathInput(cleanPath);
      const selectedFiles = new Set(serverSettings.value.selectedFiles || []);
      selectedFiles.add(cleanPath);
      const nextSettings = {
        ...serverSettings.value,
        selectedFiles: [...selectedFiles].sort(),
      };
      serverSettings.value = nextSettings;
      saveSettings(nextSettings);
      setIsOnline(navigator.onLine);
      setServerError("");
      setNotice(
        queued
          ? `Opened local changes for ${cleanPath}`
          : `Opened the saved copy of ${cleanPath}`,
      );
      setSettingsOpen(false);
      return;
    }

    setBusy(true);
    setServerError("");
    try {
      const result = await readFile(
        base,
        serverSettings.value.token,
        cleanPath,
      );
      const content = result.content;
      const etag = result.exists
        ? result.etag || serverEtags.value[key] || null
        : null;
      if (!result.exists && serverEtags.value[key]) {
        const nextEtags = { ...serverEtags.value };
        delete nextEtags[key];
        serverEtags.value = nextEtags;
        persistObject(ETAGS_KEY, nextEtags);
      }
      const next = { ...documents.value, [key]: content };
      documents.value = next;
      saveDocuments(next);
      setDocumentRevision((revision) => revision + 1);
      selectCurrentKey(key);
      activeRemotePath.value = cleanPath;
      remoteState.value = { etag };
      setRemotePathInput(cleanPath);
      const selectedFiles = new Set(serverSettings.value.selectedFiles || []);
      selectedFiles.add(cleanPath);
      const nextSettings = {
        ...serverSettings.value,
        selectedFiles: [...selectedFiles].sort(),
      };
      serverSettings.value = nextSettings;
      saveSettings(nextSettings);
      if (etag) {
        const nextEtags = { ...serverEtags.value, [key]: etag };
        serverEtags.value = nextEtags;
        persistObject(ETAGS_KEY, nextEtags);
      }
      setIsOnline(true);
      setServerError("");
      setNotice(`Opened ${cleanPath}`);
      setSettingsOpen(false);
    } catch (error) {
      if (
        error instanceof TypeError ||
        !navigator.onLine ||
        ((error.status === 401 || error.status === 403) &&
          cachedContent !== undefined)
      ) {
        if (cachedContent === undefined) {
          setServerError(`Could not open ${cleanPath}: ${error.message}`);
          return;
        }
        const cachedEtag = serverEtags.value[key] || null;
        selectCurrentKey(key);
        activeRemotePath.value = cleanPath;
        remoteState.value = { etag: cachedEtag };
        if (error.status === 401) {
          serverSettings.value = {
            ...serverSettings.value,
            token: undefined,
          };
          saveSettings(serverSettings.value);
        }
        setIsOnline(
          error.status === 401 || error.status === 403
            ? navigator.onLine
            : false,
        );
        setServerError("");
        setNotice(
          error.status === 401
            ? `Opened the saved copy of ${cleanPath}; sign in again to sync changes`
            : error.status === 403
              ? `Opened the saved copy of ${cleanPath}; the server denied access`
              : `Opened the saved copy of ${cleanPath}`,
        );
      } else {
        setServerError(`Could not open ${cleanPath}: ${error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function switchFile(key) {
    if (!key || key === currentKey.value) return;
    if (key.startsWith("local:")) {
      selectCurrentKey(key);
      activeRemotePath.value = "";
      remoteState.value = { etag: null };
      setNotice(`Opened ${key.replace(/^local:/, "")}`);
      return;
    }
    const prefix = `server:${serverSettings.value.base?.replace(/\/+$/, "")}:`;
    if (!serverSettings.value.base || !key.startsWith(prefix)) {
      setServerError("This list belongs to a different server connection.");
      return;
    }
    openRemote(key.slice(prefix.length));
  }

  const allTasks = sortTasks(tasks);
  const facetTasks = includeCompletedFacets
    ? tasks
    : tasks.filter((task) => !task.completed);
  const projects = [
    ...new Set(facetTasks.flatMap((task) => task.projects)),
  ].sort();
  const contexts = [
    ...new Set(facetTasks.flatMap((task) => task.contexts)),
  ].sort();
  const projectCount = (project) =>
    facetTasks.filter((task) => task.projects.includes(project)).length;
  const contextCount = (context) =>
    facetTasks.filter((task) => task.contexts.includes(context)).length;
  const visibleTasks = allTasks.filter((task) => {
    if (filter === "open" && task.completed) return false;
    if (filter === "done" && !task.completed) return false;
    if (projectFilter && !task.projects.includes(projectFilter)) return false;
    if (contextFilter && !task.contexts.includes(contextFilter)) return false;
    if (
      search &&
      !serializeTask(task).toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });
  const openCount = tasks.filter((task) => !task.completed).length;
  const localFiles = Object.keys(documents.value)
    .filter((key) => key.startsWith("local:"))
    .sort();
  const activeName =
    activeRemotePath.value || currentKey.value.replace(/^local:/, "");
  const selectedServerFiles = Array.isArray(serverSettings.value.selectedFiles)
    ? serverSettings.value.selectedFiles
    : [];
  const settingsServerFiles = [
    ...new Set([...serverFiles, ...selectedServerFiles]),
  ].sort();
  const pendingEntries = Object.entries(pendingQueue.value);
  const unsyncedEntries = pendingEntries.filter(([, item]) =>
    ["pending", "error", "conflict"].includes(item.status),
  );
  const unsyncedNames = [
    ...new Set(unsyncedEntries.map(([, item]) => item.path)),
  ];
  const conflictNames = [
    ...new Set(
      unsyncedEntries
        .filter(([, item]) => item.status === "conflict")
        .map(([, item]) => item.path),
    ),
  ];
  const unsyncedLabel =
    unsyncedNames.length <= 2
      ? unsyncedNames.join(", ")
      : `${unsyncedNames.slice(0, 2).join(", ")} and ${unsyncedNames.length - 2} more`;
  const conflictLabel =
    conflictNames.length <= 2
      ? conflictNames.join(", ")
      : `${conflictNames.slice(0, 2).join(", ")} and ${conflictNames.length - 2} more`;
  const conflictCount = unsyncedEntries.filter(
    ([, item]) => item.status === "conflict",
  ).length;
  const firstConflict = unsyncedEntries.find(
    ([, item]) => item.status === "conflict",
  );
  const fileOptions = [
    ...localFiles.map((key) => ({
      key,
      label: key.replace(/^local:/, ""),
    })),
    ...(serverSettings.value.base
      ? [
          ...new Set(
            [...selectedServerFiles, activeRemotePath.value].filter(Boolean),
          ),
        ]
          .sort()
          .map((path) => ({
            key: fileKey(serverSettings.value.base, path),
            label: `${path} · server`,
          }))
      : []),
  ];
  if (!fileOptions.some((file) => file.key === currentKey.value)) {
    fileOptions.push({
      key: currentKey.value,
      label: `${activeName}${activeRemotePath.value ? " · server" : ""}`,
    });
  }
  const visibleError =
    (!storageErrorDismissed.value && storageError.value) || serverError;

  return (
    <main class="shell">
      <header class="topbar">
        <a class="wordmark" href="./" aria-label="Tasks home">
          <span class="brand-mark">✓</span>
          <span>Tasks</span>
        </a>
        <div class="top-actions">
          <span class={`save-state ${activeRemotePath.value ? "remote" : ""}`}>
            <span class="status-dot" />
            {activeRemotePath.value && pendingQueue.value[currentKey.value]
              ? "Changes queued"
              : activeRemotePath.value
                ? !isOnline || !serverSettings.value.token
                  ? "Saved on this device"
                  : "Server file"
                : storageError.value
                  ? "Browser save issue"
                  : "Saved in this browser"}
          </span>
          {installPrompt && (
            <button
              class="button button-secondary install-button"
              onClick={installApp}
            >
              Install
            </button>
          )}
          <button
            class="button button-quiet"
            onClick={() => {
              setExportKey(currentKey.value);
              setSettingsOpen(true);
            }}
          >
            <span aria-hidden="true">▤</span> Files & settings
          </button>
        </div>
      </header>

      {visibleError && !settingsOpen && (
        <div class="global-error" role="alert">
          <span>{visibleError}</span>
          <button
            class="close-button"
            aria-label="Dismiss message"
            onClick={() => {
              storageErrorDismissed.value = true;
              setServerError("");
            }}
          >
            ×
          </button>
        </div>
      )}

      {!isOnline && unsyncedEntries.length === 0 && (
        <div class="offline-banner" role="status">
          You’re offline. This app and your saved lists are available on this
          device; remote changes will sync after you reconnect.
        </div>
      )}

      <section class="workspace">
        {unsyncedEntries.length > 0 && (
          <div
            class={`sync-banner ${conflictCount ? "sync-conflict" : ""}`}
            role="status"
          >
            <span class="sync-indicator" />
            <span>
              {conflictCount
                ? `Changes to ${conflictLabel} need review. Your local copies are safe.`
                : !isOnline
                  ? `You're offline. Changes to ${unsyncedLabel} are saved on this device and will sync when you're back online.`
                  : !serverSettings.value.token
                    ? `Changes to ${unsyncedLabel} are saved here. Sign in to sync them.`
                    : `Changes to ${unsyncedLabel} are saved here and waiting to sync.`}
            </span>
            {!serverSettings.value.token && (
              <button class="sync-retry" onClick={signInToSync}>
                Sign in
              </button>
            )}
            {firstConflict && (
              <button
                class="sync-retry"
                onClick={() => {
                  setConflictDialogKey(firstConflict[0]);
                  setServerError("");
                }}
              >
                Review & resolve
              </button>
            )}
            {unsyncedEntries.some(([, item]) => item.status === "error") && (
              <button class="sync-retry" onClick={retryFailedSyncs}>
                Retry
              </button>
            )}
          </div>
        )}
        <div class="board">
          <aside class="sidebar">
            <label class="file-caption" for="current-file-select">
              CURRENT LIST
            </label>
            <select
              id="current-file-select"
              class="file-switcher"
              value={currentKey.value}
              onChange={(event) => switchFile(event.currentTarget.value)}
              aria-label="Switch task list"
            >
              {fileOptions.map((file) => (
                <option value={file.key} key={file.key}>
                  {file.label}
                </option>
              ))}
            </select>
            <span class="file-location">
              {activeRemotePath.value
                ? isOnline && serverSettings.value.token
                  ? "Plain File Server"
                  : "Plain File Server · saved on this device"
                : "Saved in this browser"}
            </span>
            <div class="sidebar-rule" />
            <div class="file-caption">VIEW</div>
            <nav class="filter-nav" aria-label="Task filters">
              {[
                ["open", "Open tasks", openCount],
                ["all", "Everything", tasks.length],
                ["done", "Completed", tasks.length - openCount],
              ].map(([value, label, count]) => (
                <button
                  class={`filter-link ${filter === value ? "selected" : ""}`}
                  onClick={() => setFilter(value)}
                  key={value}
                >
                  <span>
                    <i class={`filter-glyph glyph-${value}`} />
                    {label}
                  </span>
                  <span class="count">{count}</span>
                </button>
              ))}
            </nav>
            <div class="sidebar-rule" />
          </aside>

          <section class="task-area">
            <div class="task-header">
              <div>
                <h2>
                  {filter === "done"
                    ? "Completed"
                    : filter === "all"
                      ? "Everything"
                      : "On your mind"}
                </h2>
              </div>
              <label class="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchRef}
                  aria-label="Search tasks"
                  placeholder="Find a task"
                  value={search}
                  onInput={(event) => setSearch(event.currentTarget.value)}
                />
                <kbd>/</kbd>
              </label>
            </div>

            <form class="quick-add" onSubmit={addTask}>
              <input
                ref={quickAddRef}
                name="task"
                aria-label="Add a task"
                placeholder="Add a task"
                autocomplete="off"
              />
              <button class="button button-primary" type="submit">
                Add task <span>↵</span>
              </button>
              <button
                class="button button-secondary details-add"
                type="button"
                onClick={() => {
                  setEditorTask(null);
                  setQuickDescription(quickAddRef.current?.value || "");
                  setTaskDialogOpen(true);
                }}
              >
                Add with details
              </button>
            </form>

            <details class="facet-panel">
              <summary>
                <span>Filter by project or context</span>
                {(projectFilter || contextFilter) && (
                  <span class="facet-active-count">
                    {(projectFilter ? 1 : 0) + (contextFilter ? 1 : 0)} active
                  </span>
                )}
              </summary>
              <div class="facet-controls">
                <label>
                  <span>Project</span>
                  <select
                    value={projectFilter}
                    onChange={(event) =>
                      setProjectFilter(event.currentTarget.value)
                    }
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option value={project} key={project}>
                        +{project} ({projectCount(project)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Context</span>
                  <select
                    value={contextFilter}
                    onChange={(event) =>
                      setContextFilter(event.currentTarget.value)
                    }
                  >
                    <option value="">All contexts</option>
                    {contexts.map((context) => (
                      <option value={context} key={context}>
                        @{context} ({contextCount(context)})
                      </option>
                    ))}
                  </select>
                </label>
                <label class="facet-completed-toggle">
                  <input
                    type="checkbox"
                    checked={includeCompletedFacets}
                    onChange={(event) =>
                      setIncludeCompletedFacets(event.currentTarget.checked)
                    }
                  />
                  Include completed-task tags
                </label>
                {(projectFilter || contextFilter) && (
                  <button
                    class="text-button facet-clear"
                    onClick={() => {
                      setProjectFilter("");
                      setContextFilter("");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </details>

            {(projectFilter || contextFilter) && (
              <div class="active-filters">
                Showing{" "}
                {projectFilter && (
                  <button onClick={() => setProjectFilter("")}>
                    +{projectFilter} ×
                  </button>
                )}
                {contextFilter && (
                  <button onClick={() => setContextFilter("")}>
                    @{contextFilter} ×
                  </button>
                )}
                <button
                  class="clear-filters"
                  onClick={() => {
                    setProjectFilter("");
                    setContextFilter("");
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            {notice && (
              <p class="inline-notice" role="status">
                {notice}
              </p>
            )}

            {visibleTasks.length ? (
              <div class="task-list">
                {visibleTasks.map((task) => (
                  <article
                    class={`task-row ${task.completed ? "is-complete" : ""}`}
                    key={task.id}
                  >
                    <button
                      class="check-button"
                      aria-label={
                        task.completed ? "Reopen task" : "Complete task"
                      }
                      onClick={() => toggleTask(task)}
                    >
                      {task.completed && <span>✓</span>}
                    </button>
                    <button
                      class="task-body"
                      onClick={() => {
                        setEditorTask(task);
                        setTaskDialogOpen(true);
                      }}
                    >
                      <span class="task-title">
                        {!task.completed && task.priority && (
                          <span class={`priority priority-${task.priority}`}>
                            ({task.priority})
                          </span>
                        )}
                        {task.completed &&
                          task.metadata.find(
                            (item) => item.key.toLowerCase() === "pri",
                          )?.value && (
                            <span class="priority">
                              (
                              {
                                task.metadata.find(
                                  (item) => item.key.toLowerCase() === "pri",
                                ).value
                              }
                              )
                            </span>
                          )}
                        <span>{task.description || "Untitled task"}</span>
                      </span>
                      <span class="task-meta">
                        {task.projects.map((project) => (
                          <span
                            class="task-chip project-chip"
                            key={`p-${project}`}
                          >
                            +{project}
                          </span>
                        ))}
                        {task.contexts.map((context) => (
                          <span
                            class="task-chip context-chip"
                            key={`c-${context}`}
                          >
                            @{context}
                          </span>
                        ))}
                        {task.metadata
                          .filter(
                            (item) =>
                              !["pri", "due"].includes(item.key.toLowerCase()),
                          )
                          .map((item) => (
                            <span
                              class="task-chip meta-chip"
                              key={`${item.key}-${item.value}`}
                            >
                              {item.key}:{item.value}
                            </span>
                          ))}
                        {task.metadata.some(
                          (item) => item.key.toLowerCase() === "due",
                        ) && (
                          <span class="created-date">
                            due{" "}
                            {
                              task.metadata.find(
                                (item) => item.key.toLowerCase() === "due",
                              ).value
                            }
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      class="edit-button"
                      aria-label="Edit task"
                      onClick={() => {
                        setEditorTask(task);
                        setTaskDialogOpen(true);
                      }}
                    >
                      ↗
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div class="empty-state">
                <div class="empty-illustration">
                  <span>✓</span>
                  <i />
                  <b />
                </div>
                <h3>
                  {search || projectFilter || contextFilter
                    ? "Nothing matches just yet."
                    : filter === "done"
                      ? "A clean slate."
                      : "A little breathing room."}
                </h3>
                <p>
                  {search || projectFilter || contextFilter
                    ? "Try another search or clear the filters."
                    : filter === "done"
                      ? "Finished tasks will find a home here."
                      : "Add a task above, or take a moment to enjoy the quiet."}
                </p>
              </div>
            )}

            <footer class="list-footer">
              <span>
                {openCount} open {openCount === 1 ? "task" : "tasks"}
              </span>
              <span>Open first · priority · created · name</span>
            </footer>
          </section>
        </div>
      </section>

      {settingsOpen && (
        <FilesDialog
          onClose={() => setSettingsOpen(false)}
          localFiles={localFiles}
          activeKey={currentKey.value}
          activeRemotePath={activeRemotePath.value}
          exportKey={exportKey}
          setExportKey={setExportKey}
          onExport={exportFile}
          onRenameLocal={renameLocalFile}
          onDeleteLocal={deleteLocalFile}
          newFileName={newFileName}
          setNewFileName={setNewFileName}
          addLocalFile={addLocalFile}
          importRef={importRef}
          importFile={importFile}
          apiBase={apiBase}
          setApiBase={setApiBase}
          username={username}
          setUsername={setUsername}
          password={password}
          setPassword={setPassword}
          authHint={authHint}
          connect={connect}
          disconnect={disconnect}
          settings={serverSettings.value}
          serverFiles={settingsServerFiles}
          selectedServerFiles={selectedServerFiles}
          toggleServerFile={toggleServerFile}
          serverError={serverError}
          storageError={storageError.value}
          remotePathInput={remotePathInput}
          setRemotePathInput={setRemotePathInput}
          openRemote={openRemote}
          busy={busy}
          refreshServerFiles={refreshServerFiles}
        />
      )}

      {taskDialogOpen && (
        <TaskDialog
          task={editorTask}
          initialDescription={quickDescription}
          allProjects={[
            ...new Set(tasks.flatMap((task) => task.projects)),
          ].sort()}
          allContexts={[
            ...new Set(tasks.flatMap((task) => task.contexts)),
          ].sort()}
          metadataSuggestions={tasks.flatMap((task) =>
            task.metadata
              .filter((item) => item.key.toLowerCase() !== "due")
              .map(({ key, value }) => `${key}:${value}`),
          )}
          onClose={() => {
            setTaskDialogOpen(false);
            setEditorTask(null);
          }}
          onSave={saveEditedTask}
          onDelete={
            editorTask
              ? () => {
                  removeTask(editorTask);
                  setEditorTask(null);
                  setTaskDialogOpen(false);
                }
              : null
          }
        />
      )}
      {conflictDialogKey && pendingQueue.value[conflictDialogKey] && (
        <ConflictDialog
          key={conflictDialogKey}
          item={pendingQueue.value[conflictDialogKey]}
          settings={serverSettings.value}
          onClose={() => setConflictDialogKey("")}
          onResolve={(choice) => {
            const key = conflictDialogKey;
            const queued = pendingQueue.value[key];
            if (!queued) return;

            const nextEtags = { ...serverEtags.value };
            if (choice.etag) nextEtags[key] = choice.etag;
            else delete nextEtags[key];
            serverEtags.value = nextEtags;
            persistObject(ETAGS_KEY, nextEtags);

            if (choice.mode === "server") {
              const nextDocuments = {
                ...documents.value,
                [key]: choice.content,
              };
              documents.value = nextDocuments;
              saveDocuments(nextDocuments);
              setDocumentRevision((revision) => revision + 1);
              const nextQueue = { ...pendingQueue.value };
              delete nextQueue[key];
              pendingQueue.value = nextQueue;
              persistObject(PENDING_KEY, nextQueue, setQueueRevision);
              if (currentKey.value === key)
                remoteState.value = { etag: choice.etag };
              setNotice(`Using the server copy of ${queued.path}`);
            } else {
              const nextDocuments = {
                ...documents.value,
                [key]: choice.content,
              };
              documents.value = nextDocuments;
              saveDocuments(nextDocuments);
              setDocumentRevision((revision) => revision + 1);
              const nextQueue = {
                ...pendingQueue.value,
                [key]: {
                  ...queued,
                  content: choice.content,
                  baseContent: choice.baseContent,
                  etag: choice.etag,
                  status: "pending",
                },
              };
              pendingQueue.value = nextQueue;
              persistObject(PENDING_KEY, nextQueue, setQueueRevision);
              if (currentKey.value === key)
                remoteState.value = { etag: choice.etag };
              setNotice(`Syncing the resolved copy of ${queued.path}`);
              syncPending(key);
            }
            setConflictDialogKey("");
          }}
        />
      )}
    </main>
  );
}

function ConflictDialog({ item, settings, onClose, onResolve }) {
  const [snapshot, setSnapshot] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadServerCopy() {
    setLoading(true);
    setError("");
    try {
      const latest = await readFile(settings.base, settings.token, item.path);
      setSnapshot(latest);
      setRows(
        createMergeRows(item.baseContent ?? "", latest.content, item.content),
      );
    } catch (loadError) {
      setError(`Could not load the server copy: ${loadError.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadServerCopy();
  }, []);

  function selectSource(source) {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        keep:
          source === "all"
            ? row.serverPresent || row.devicePresent
            : source === "server"
              ? row.serverPresent
              : row.devicePresent,
      })),
    );
  }

  const canWrite = snapshot?.exists && Boolean(snapshot.etag);
  const hasBaseVersion = typeof item.baseContent === "string";
  const unchangedCount = rows.filter(
    (row) => row.change === "unchanged",
  ).length;
  const changedRows = rows.filter((row) => row.change !== "unchanged");

  return (
    <div
      class="modal-backdrop conflict-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        class="dialog conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
      >
        <div class="dialog-heading">
          <div>
            <p class="eyebrow">SYNC NEEDS YOUR CHOICE</p>
            <h2 id="conflict-title">Review {item.path}</h2>
          </div>
          <button
            class="close-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p class="conflict-intro">
          A save based on an older server version was rejected. This can happen
          after a connection drops during a save, even if the task lines look
          unchanged. Nothing will be replaced until you choose what to keep.
        </p>
        {loading ? (
          <p class="conflict-status">Loading the latest server copy…</p>
        ) : error ? (
          <div class="conflict-load-error" role="alert">
            <span>{error}</span>
            <button class="button button-secondary" onClick={loadServerCopy}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div class="conflict-snapshot">
              <div>
                <strong>Server</strong>
                <span>
                  {snapshot.exists
                    ? `${taskLinesCount(snapshot.content)} tasks`
                    : "File not found"}
                </span>
              </div>
              <div>
                <strong>This device</strong>
                <span>{taskLinesCount(item.content)} tasks</span>
              </div>
            </div>
            {!canWrite && (
              <p class="conflict-load-error" role="alert">
                {snapshot.exists
                  ? "The server did not provide a current ETag. You can copy the server version to this device, but cannot safely sync a replacement yet."
                  : "This file is currently missing on the server. You can use this device's copy, but safely creating a replacement is not supported yet."}
              </p>
            )}
            {!hasBaseVersion && (
              <p class="conflict-history-note">
                This queued change predates change tracking, so additions and
                removals cannot be identified reliably. Compare the versions
                below and choose what to keep.
              </p>
            )}
            <div class="conflict-actions">
              <button
                class="button button-secondary"
                onClick={() => selectSource("server")}
              >
                Select server tasks
              </button>
              <button
                class="button button-secondary"
                onClick={() => selectSource("device")}
              >
                Select device tasks
              </button>
              <button
                class="button button-secondary"
                onClick={() => selectSource("all")}
              >
                Keep all tasks from either copy
              </button>
            </div>
            <p class="conflict-help conflict-delete-warning">
              Keeping all tasks from either copy can restore tasks removed on
              only one side. The default merge keeps those removals.
            </p>
            {unchangedCount > 0 && (
              <details class="conflict-unchanged">
                <summary>
                  {unchangedCount} unchanged{" "}
                  {unchangedCount === 1 ? "task" : "tasks"} (included)
                </summary>
                <div class="conflict-task-list" aria-label="Unchanged tasks">
                  {rows
                    .filter((row) => row.change === "unchanged")
                    .map((row) => (
                      <label class="conflict-task" key={row.id}>
                        <input
                          type="checkbox"
                          checked={row.keep}
                          aria-label={`Keep task: ${row.line}`}
                          onChange={(event) => {
                            const keep = event.currentTarget.checked;
                            setRows((current) =>
                              current.map((candidate) =>
                                candidate.id === row.id
                                  ? { ...candidate, keep }
                                  : candidate,
                              ),
                            );
                          }}
                        />
                        <span class="conflict-task-line">{row.line}</span>
                        <span class="conflict-source">Unchanged</span>
                      </label>
                    ))}
                </div>
              </details>
            )}
            <div class="conflict-task-list" aria-label="Changed tasks">
              {changedRows.length ? (
                changedRows.map((row) => (
                  <label class="conflict-task" key={row.id}>
                    <input
                      type="checkbox"
                      checked={row.keep}
                      aria-label={`Keep task: ${row.line}`}
                      onChange={(event) => {
                        const keep = event.currentTarget.checked;
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.id === row.id
                              ? { ...candidate, keep }
                              : candidate,
                          ),
                        );
                      }}
                    />
                    <span class="conflict-task-line">{row.line}</span>
                    <span class={`conflict-source source-${row.change}`}>
                      {conflictChangeLabel(row.change)}
                    </span>
                  </label>
                ))
              ) : (
                <p class="conflict-status">
                  No added or removed tasks. Unchanged tasks are included in the
                  merge.
                </p>
              )}
            </div>
            <p class="conflict-help">
              New or changed lines are compared with the last common saved
              version. A changed line may appear as one removal and one addition
              because tasks have no unique IDs.
            </p>
            <p class="conflict-help">
              Check a removed task to restore it in the merged list.
            </p>
          </>
        )}
        <div class="dialog-actions conflict-footer">
          <button class="button button-quiet" onClick={onClose}>
            Cancel
          </button>
          <div>
            <button
              class="button button-secondary"
              disabled={loading || !!error}
              onClick={() =>
                onResolve({
                  mode: "server",
                  content: snapshot.content,
                  baseContent: snapshot.content,
                  etag: snapshot.etag,
                })
              }
            >
              Use server
            </button>
            <button
              class="button button-secondary"
              disabled={loading || !!error || !canWrite}
              onClick={() =>
                onResolve({
                  mode: "device",
                  content: item.content,
                  baseContent: snapshot.content,
                  etag: snapshot.etag,
                })
              }
            >
              Use this device
            </button>
            <button
              class="button button-primary"
              disabled={loading || !!error || !canWrite}
              onClick={() =>
                onResolve({
                  mode: "merge",
                  content: serializeMergeRows(rows),
                  baseContent: snapshot.content,
                  etag: snapshot.etag,
                })
              }
            >
              Save merge & sync
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function taskLinesCount(content) {
  return content.split(/\r?\n/).filter((line) => line.trim()).length;
}

function conflictChangeLabel(change) {
  return {
    "added-server": "Added on server",
    "added-device": "Added on device",
    "added-both": "Added on both",
    "removed-server": "Removed on server",
    "removed-device": "Removed on device",
  }[change];
}

function FilesDialog(props) {
  const {
    onClose,
    localFiles,
    activeKey,
    activeRemotePath,
    exportKey,
    setExportKey,
    onExport,
    onRenameLocal,
    onDeleteLocal,
    newFileName,
    setNewFileName,
    addLocalFile,
    importRef,
    importFile,
    apiBase,
    setApiBase,
    username,
    setUsername,
    password,
    setPassword,
    authHint,
    connect,
    disconnect,
    settings,
    serverFiles,
    selectedServerFiles,
    toggleServerFile,
    serverError,
    storageError,
    remotePathInput,
    setRemotePathInput,
    openRemote,
    busy,
    refreshServerFiles,
  } = props;
  const [serverSearch, setServerSearch] = useState("");
  const serverTree = useMemo(
    () => buildServerFileTree(serverFiles, serverSearch),
    [serverFiles, serverSearch],
  );

  return (
    <div
      class="modal-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        class="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="files-title"
      >
        <div class="dialog-heading">
          <div>
            <p class="eyebrow">YOUR DATA, YOUR CHOICE</p>
            <h2 id="files-title">Files & settings</h2>
          </div>
          <button
            class="close-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <section class="settings-section">
          <h3>On this device</h3>
          <p>
            Files are saved privately in this browser. Export a copy whenever
            you like.
          </p>
          <div class="saved-file-list">
            <span class="field-label">
              Saved lists · switch from Current list
            </span>
            {localFiles.map((key) => (
              <div class="saved-file-row" key={key}>
                <span class="saved-file-name">
                  {key.replace(/^local:/, "")}
                </span>
                <div class="saved-file-actions">
                  {key === activeKey && (
                    <span class="active-file-label">Current</span>
                  )}
                  <button
                    type="button"
                    class="file-action"
                    onClick={() => onExport(key)}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    class="file-action"
                    onClick={() => onRenameLocal(key)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    class="file-action file-delete"
                    onClick={() => onDeleteLocal(key)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <form class="inline-form" onSubmit={addLocalFile}>
            <input
              value={newFileName}
              onInput={(event) => setNewFileName(event.currentTarget.value)}
              placeholder="New list name, e.g. groceries.txt"
              aria-label="New local file name"
            />
            <button class="button button-secondary">Open / create</button>
          </form>
          <div class="button-row">
            <button
              class="button button-secondary"
              onClick={() => importRef.current?.click()}
            >
              Import .txt
            </button>
            <select
              aria-label="Choose a list to export"
              value={exportKey}
              onChange={(event) => setExportKey(event.currentTarget.value)}
            >
              {localFiles.map((key) => (
                <option value={key} key={key}>
                  {key.replace(/^local:/, "")}
                </option>
              ))}
              {!localFiles.includes(activeKey) &&
                !(activeKey.startsWith("server:") && activeRemotePath) && (
                  <option value={activeKey}>
                    {activeKey.replace(/^local:/, "")}
                  </option>
                )}
              {activeRemotePath && (
                <option value={`server:${settings.base}:${activeRemotePath}`}>
                  {activeRemotePath} · server
                </option>
              )}
            </select>
            <button
              class="button button-secondary"
              onClick={() => onExport(exportKey)}
            >
              Export selected
            </button>
            <input
              class="visually-hidden"
              ref={importRef}
              type="file"
              accept=".txt,text/plain"
              onChange={importFile}
            />
          </div>
        </section>
        <section class="settings-section">
          <div class="section-title-row">
            <h3>
              Plain File Server <span class="optional-label">OPTIONAL</span>
            </h3>
            {settings.token && (
              <button class="text-button" onClick={disconnect}>
                Sign out
              </button>
            )}
          </div>
          <p>
            Connect to your server to work with files wherever you can log in.
          </p>
          {!settings.token ? (
            <>
              <p class="fine-print cached-server-note">
                Previously opened server lists stay on this device and remain
                editable while signed out or offline. Changes wait here until
                you sign in and reconnect.
              </p>
              <form class="server-form" onSubmit={connect}>
                <label class="field-label" for="api-base">
                  API URL
                </label>
                <input
                  id="api-base"
                  type="url"
                  value={apiBase}
                  onInput={(event) => setApiBase(event.currentTarget.value)}
                  placeholder="https://files.example.com/api"
                  required
                />
                <div class="form-grid">
                  <label>
                    <span class="field-label">Username</span>
                    <input
                      autocomplete="username"
                      value={username}
                      onInput={(event) =>
                        setUsername(event.currentTarget.value)
                      }
                      required
                    />
                  </label>
                  <label>
                    <span class="field-label">Password</span>
                    <input
                      type="password"
                      autocomplete="current-password"
                      value={password}
                      onInput={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                      required
                    />
                  </label>
                </div>
                <button class="button button-primary" disabled={busy}>
                  {busy ? "Connecting…" : "Connect"}
                </button>
              </form>
            </>
          ) : (
            <div class="server-connected">
              <div class="connected-note">
                <span class="status-dot" /> Signed in as{" "}
                <strong>{settings.username}</strong>
              </div>
              <p class="fine-print session-note">
                This browser keeps its own sign-in token; signing in on another
                device does not replace this device's saved lists.
              </p>
              <div class="section-title-row">
                <span class="field-label">
                  Choose the files that contain tasks
                </span>
                <button class="text-button" onClick={refreshServerFiles}>
                  Refresh
                </button>
              </div>
              <p class="fine-print">
                Only selected files appear in Current list. You can also enter
                another path below.
              </p>
              <div class="remote-browser-tools">
                <label class="remote-search">
                  <span class="visually-hidden">Search server files</span>
                  <input
                    type="search"
                    value={serverSearch}
                    onInput={(event) =>
                      setServerSearch(event.currentTarget.value)
                    }
                    placeholder="Search files and folders"
                  />
                </label>
                <span class="remote-file-count">
                  {countServerFiles(serverTree)} shown ·{" "}
                  {selectedServerFiles.length} in your lists
                </span>
              </div>
              <div class="saved-file-list remote-file-list">
                {serverTree.length ? (
                  <ServerFileTree
                    nodes={serverTree}
                    selectedFiles={selectedServerFiles}
                    onToggle={toggleServerFile}
                    expandMatches={Boolean(serverSearch.trim())}
                  />
                ) : (
                  <span class="fine-print">
                    {serverFiles.length
                      ? "No files match that search."
                      : "No readable files listed yet."}
                  </span>
                )}
              </div>
              <form
                class="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  openRemote();
                }}
              >
                <input
                  value={remotePathInput}
                  onInput={(event) =>
                    setRemotePathInput(event.currentTarget.value)
                  }
                  placeholder="File path, e.g. household/todo.txt"
                  aria-label="Remote file path"
                />
                <button class="button button-secondary" disabled={busy}>
                  {busy ? "Opening…" : "Open path"}
                </button>
              </form>
              <p class="fine-print">
                Paths are relative to your server's storage directory. Read and
                write access is controlled by your account.
              </p>
            </div>
          )}
          {(serverError || storageError) && (
            <p class="error-message" role="alert">
              {serverError || storageError}
            </p>
          )}
          {authHint && (
            <p class="auth-troubleshooting" role="status">
              {authHint}
            </p>
          )}
          <p class="fine-print security-note">
            Your server login token is kept in this browser's local storage.
            Sign out on shared devices. Use HTTPS or a trusted private network.
          </p>
        </section>
        <div class="dialog-footer">
          <span>Export a plain-text copy whenever you like.</span>
          <button class="button button-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}

function ServerFileTree({ nodes, selectedFiles, onToggle, expandMatches }) {
  const directories = nodes.filter((node) => node.type === "directory");
  const files = nodes.filter((node) => node.type === "file");
  const renderFile = (node) => (
    <li class="server-file-tree-row" key={node.path}>
      <span class="server-file-name" title={node.path}>
        {node.name}
      </span>
      <label class="file-selection">
        <input
          type="checkbox"
          checked={selectedFiles.includes(node.path)}
          onChange={(event) => onToggle(node.path, event.currentTarget.checked)}
        />
        <span>{selectedFiles.includes(node.path) ? "In my lists" : "Add"}</span>
      </label>
    </li>
  );

  return (
    <ul class="server-file-tree">
      {directories.map((node) => (
        <li key={node.path}>
          <details open={expandMatches || undefined}>
            <summary>
              <span class="folder-icon" aria-hidden="true">
                ▸
              </span>
              <span>{node.name}</span>
              <span class="folder-count">
                {countServerFiles(node.children)}
              </span>
            </summary>
            <ServerFileTree
              nodes={node.children}
              selectedFiles={selectedFiles}
              onToggle={onToggle}
              expandMatches={expandMatches}
            />
          </details>
        </li>
      ))}
      {files.length > 20 ? (
        <li>
          <details open={expandMatches || undefined}>
            <summary>
              <span class="folder-icon" aria-hidden="true">
                ▸
              </span>
              <span>Files in this folder</span>
              <span class="folder-count">{files.length}</span>
            </summary>
            <ul class="server-file-tree">{files.map(renderFile)}</ul>
          </details>
        </li>
      ) : (
        files.map(renderFile)
      )}
    </ul>
  );
}

function TaskDialog({
  task,
  initialDescription,
  allProjects,
  allContexts,
  metadataSuggestions,
  onClose,
  onSave,
  onDelete,
}) {
  const initialTask = task || {
    ...parseTask(initialDescription || "", Date.now()),
    completed: false,
    completionDate: "",
    creationDate: today(),
  };
  const [rawLine, setRawLine] = useState(serializeTask(initialTask));
  const [draft, setDraft] = useState({ ...initialTask });
  const [plainTextMode, setPlainTextMode] = useState(false);

  function editField(field, value) {
    setDraft({ ...draft, [field]: value });
  }

  function save(event) {
    event.preventDefault();
    if (plainTextMode) {
      const parsed = parseTask(rawLine, draft.id);
      onSave({ ...parsed, id: draft.id });
    } else {
      onSave({ ...draft, creationDate: draft.creationDate || today() });
    }
  }

  return (
    <div
      class="modal-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        class="dialog task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
      >
        <div class="dialog-heading">
          <div>
            <p class="eyebrow">{task ? "TASK DETAILS" : "ADD A TASK"}</p>
            <h2 id="edit-title">{task ? "Edit task" : "New task"}</h2>
          </div>
          <button
            class="close-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form onSubmit={save}>
          {plainTextMode ? (
            <>
              <label class="field-label" for="raw-line">
                Plain-text task line
              </label>
              <textarea
                id="raw-line"
                class="raw-editor"
                rows="3"
                value={rawLine}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setRawLine(value);
                  setDraft(parseTask(value, draft.id));
                }}
              />
            </>
          ) : (
            <>
              <label class="field-label" for="task-description">
                What needs doing?
              </label>
              <input
                id="task-description"
                value={draft.description}
                onInput={(event) =>
                  editField("description", event.currentTarget.value)
                }
                required
                autofocus
              />
            </>
          )}
          <label class="plain-text-toggle">
            <input
              type="checkbox"
              checked={plainTextMode}
              onChange={(event) => {
                if (event.currentTarget.checked)
                  setRawLine(serializeTask(draft));
                setPlainTextMode(event.currentTarget.checked);
              }}
            />
            Edit the plain-text line instead
          </label>
          <div class="form-grid editor-grid">
            <label>
              <span class="field-label">Priority</span>
              <select
                value={draft.priority}
                onChange={(event) =>
                  editField("priority", event.currentTarget.value)
                }
              >
                <option value="">None</option>
                {Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (letter) => (
                  <option value={letter} key={letter}>
                    ({letter})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span class="field-label">Created</span>
              <input
                type="date"
                value={draft.creationDate}
                onInput={(event) =>
                  editField("creationDate", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span class="field-label">Due date</span>
              <input
                type="date"
                value={
                  draft.metadata.find(
                    (item) => item.key.toLowerCase() === "due",
                  )?.value || ""
                }
                onInput={(event) => {
                  const metadata = draft.metadata.filter(
                    (item) => item.key.toLowerCase() !== "due",
                  );
                  if (event.currentTarget.value)
                    metadata.push({
                      key: "due",
                      value: event.currentTarget.value,
                    });
                  editField("metadata", metadata);
                }}
              />
            </label>
          </div>
          <TagField
            label="Projects"
            prefix="+"
            values={draft.projects}
            suggestions={allProjects}
            description="Group related tasks, such as a trip, a home project, or a goal."
            placeholder="Type a project and press Enter"
            onChange={(value) => editField("projects", value)}
          />
          <TagField
            label="Contexts"
            prefix="@"
            values={draft.contexts}
            suggestions={allContexts}
            description="A context is where or how you can act: @home, @phone, @computer."
            placeholder="Type a context and press Enter"
            onChange={(value) => editField("contexts", value)}
          />
          <TagField
            label="Other details"
            values={draft.metadata
              .filter((item) => item.key.toLowerCase() !== "due")
              .map(({ key, value }) => `${key}:${value}`)}
            suggestions={metadataSuggestions}
            description="Optional details in key:value form, such as repeat:weekly."
            placeholder="Type key:value and press Enter"
            onChange={(tokens) => {
              const metadata = tokens
                .map((entry) => {
                  const colon = entry.indexOf(":");
                  return colon < 1
                    ? null
                    : {
                        key: entry.slice(0, colon),
                        value: entry.slice(colon + 1),
                      };
                })
                .filter(Boolean);
              editField("metadata", [
                ...metadata,
                ...draft.metadata.filter(
                  (item) => item.key.toLowerCase() === "due",
                ),
              ]);
            }}
          />
          <div class="dialog-actions">
            {onDelete && (
              <button
                type="button"
                class="text-button delete-button"
                onClick={onDelete}
              >
                Delete task
              </button>
            )}
            <div>
              <button
                type="button"
                class="button button-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button class="button button-primary">Save task</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function TagField({
  label,
  prefix = "",
  values,
  suggestions,
  description,
  placeholder,
  onChange,
}) {
  const [entry, setEntry] = useState("");
  const clean = (value) => value.trim().replace(/^[+@]/, "");
  const add = (text) => {
    const tokens = text
      .split(/[,\s]+/)
      .map(clean)
      .filter(Boolean);
    if (!tokens.length) return;
    const next = [...values];
    for (const token of tokens) {
      if (!next.some((value) => value.toLowerCase() === token.toLowerCase())) {
        next.push(token);
      }
    }
    onChange(next);
    setEntry("");
  };
  const toggle = (value) => {
    const exists = values.some(
      (item) => item.toLowerCase() === value.toLowerCase(),
    );
    onChange(
      exists
        ? values.filter((item) => item.toLowerCase() !== value.toLowerCase())
        : [...values, value],
    );
  };
  const known = [...new Set(suggestions.map(clean).filter(Boolean))].filter(
    (suggestion) =>
      !values.some((value) => value.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <fieldset class="tag-field">
      <legend class="field-label">{label}</legend>
      {description && <p class="tag-description">{description}</p>}
      <div class="tag-entry">
        {values.map((value) => (
          <button
            type="button"
            class="selected-tag"
            onClick={() => toggle(value)}
            key={value}
            aria-label={`Remove ${prefix}${value}`}
          >
            {prefix}
            {value} <span>×</span>
          </button>
        ))}
        <input
          value={entry}
          onInput={(event) => setEntry(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (["Enter", ",", " "].includes(event.key)) {
              event.preventDefault();
              add(entry);
            }
          }}
          onBlur={() => add(entry)}
          placeholder={placeholder}
          aria-label={label}
        />
      </div>
      {known.length > 0 && (
        <div class="tag-suggestions">
          <span>From this list:</span>
          {known.map((value) => (
            <button
              type="button"
              class="suggestion-tag"
              onClick={() => toggle(value)}
              key={value}
            >
              {prefix}
              {value}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export default App;
