const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY = /^\(([A-Z])\)$/;
const PROJECT = /^\+(.+)$/;
const CONTEXT = /^@(.+)$/;
const KEY_VALUE = /^([A-Za-z][\w-]*):(\S*)$/;

export function isDate(value) {
  if (!DATE.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseTask(line, id = 0) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const completed = tokens[0] === "x";
  let cursor = completed ? 1 : 0;
  let completionDate = "";
  let creationDate = "";

  if (completed && isDate(tokens[cursor])) completionDate = tokens[cursor++];

  let priority = "";
  let foundCreationDate = false;
  while (tokens[cursor]) {
    if (!priority && PRIORITY.test(tokens[cursor])) {
      priority = tokens[cursor].slice(1, 2);
      cursor += 1;
    } else if (!foundCreationDate && isDate(tokens[cursor])) {
      creationDate = tokens[cursor++];
      foundCreationDate = true;
    } else {
      break;
    }
  }

  const projects = [];
  const contexts = [];
  const metadata = [];
  const description = [];

  for (const token of tokens.slice(cursor)) {
    const project = token.match(PROJECT);
    const context = token.match(CONTEXT);
    const keyValue = token.match(KEY_VALUE);
    if (project) projects.push(project[1]);
    else if (context) contexts.push(context[1]);
    else if (keyValue) metadata.push({ key: keyValue[1], value: keyValue[2] });
    else description.push(token);
  }

  return {
    id,
    raw: line,
    completed,
    completionDate,
    creationDate,
    priority,
    description: description.join(" "),
    projects,
    contexts,
    metadata,
  };
}

export function serializeTask(task) {
  const parts = [];
  if (task.completed) {
    parts.push("x");
    if (task.completionDate) parts.push(task.completionDate);
  }
  if (!task.completed && task.priority) parts.push(`(${task.priority})`);
  if (task.creationDate) parts.push(task.creationDate);
  if (task.description.trim()) parts.push(task.description.trim());
  for (const project of task.projects) {
    if (project.trim())
      parts.push(project.startsWith("+") ? project : `+${project}`);
  }
  for (const context of task.contexts) {
    if (context.trim())
      parts.push(context.startsWith("@") ? context : `@${context}`);
  }
  for (const { key, value } of task.metadata) {
    if (key.trim()) parts.push(`${key.trim()}:${value.trim()}`);
  }
  return parts.join(" ");
}

export function parseDocument(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, id) => parseTask(line, id + 1));
}

export function serializeDocument(tasks) {
  const lines = tasks.map(serializeTask).filter(Boolean);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function completeTask(task, date) {
  const metadata = task.metadata.filter(
    (item) => item.key.toLowerCase() !== "pri",
  );
  if (task.priority) metadata.push({ key: "pri", value: task.priority });
  return {
    ...task,
    completed: true,
    completionDate: date,
    priority: "",
    metadata,
  };
}

export function reopenTask(task) {
  const priorityMetadata = task.metadata.find(
    (item) => item.key.toLowerCase() === "pri",
  );
  return {
    ...task,
    completed: false,
    completionDate: "",
    priority: task.priority || priorityMetadata?.value || "",
    metadata: task.metadata.filter((item) => item.key.toLowerCase() !== "pri"),
  };
}

export function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    if (left.completed !== right.completed)
      return Number(left.completed) - Number(right.completed);
    const priorityFor = (task) =>
      task.priority ||
      (task.completed
        ? task.metadata.find((item) => item.key.toLowerCase() === "pri")?.value
        : "") ||
      "";
    const leftPriority = priorityFor(left);
    const rightPriority = priorityFor(right);
    if (leftPriority !== rightPriority) {
      if (!leftPriority) return 1;
      if (!rightPriority) return -1;
      return leftPriority.localeCompare(rightPriority);
    }
    const leftDate = left.creationDate;
    const rightDate = right.creationDate;
    if (leftDate !== rightDate) {
      if (!leftDate) return 1;
      if (!rightDate) return -1;
      return leftDate.localeCompare(rightDate);
    }
    return left.description.localeCompare(right.description, undefined, {
      sensitivity: "base",
    });
  });
}

export function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
