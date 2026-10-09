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

export function metadataValue(task, key) {
  return (
    task.metadata.find((item) => item.key.toLowerCase() === key.toLowerCase())
      ?.value || ""
  );
}

export function setMetadataValue(task, key, value) {
  let replaced = false;
  const metadata = task.metadata.flatMap((item) => {
    if (item.key.toLowerCase() !== key.toLowerCase()) return [item];
    if (!value || replaced) return [];
    replaced = true;
    return [{ key: item.key, value }];
  });
  if (value && !replaced) metadata.push({ key, value });
  return { ...task, metadata };
}

export function parseRecurrence(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\+)?([1-9]\d*)([dbwmy])$/i);
  if (!match) return null;
  const interval = Number(match[2]);
  if (!Number.isSafeInteger(interval) || interval > 9999) return null;
  return {
    strict: Boolean(match[1]),
    interval,
    unit: match[3].toLowerCase(),
  };
}

function utcDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function formatUtcDate(date) {
  if (Number.isNaN(date.valueOf())) return "";
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(value, days) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function addMonths(value, months) {
  const date = utcDate(value);
  const targetMonth = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(targetMonth / 12);
  const month = targetMonth - year * 12;
  const endOfMonth = new Date(0);
  endOfMonth.setUTCHours(0, 0, 0, 0);
  endOfMonth.setUTCFullYear(year, month + 1, 0);
  const lastDay = endOfMonth.getUTCDate();
  date.setUTCFullYear(year, month, Math.min(date.getUTCDate(), lastDay));
  return formatUtcDate(date);
}

function addYears(value, years) {
  const date = utcDate(value);
  const year = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const endOfMonth = new Date(0);
  endOfMonth.setUTCHours(0, 0, 0, 0);
  endOfMonth.setUTCFullYear(year, month + 1, 0);
  const lastDay = endOfMonth.getUTCDate();
  date.setUTCFullYear(year, month, Math.min(date.getUTCDate(), lastDay));
  return formatUtcDate(date);
}

function addBusinessDays(value, days) {
  const date = utcDate(value);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (Number.isNaN(date.valueOf())) return "";
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return formatUtcDate(date);
}

function addInterval(value, amount, unit) {
  if (!Number.isSafeInteger(amount) || amount < 1) return "";
  if (unit === "d") return addCalendarDays(value, amount);
  if (unit === "b") return addBusinessDays(value, amount);
  if (unit === "w") return addCalendarDays(value, amount * 7);
  if (unit === "m") return addMonths(value, amount);
  if (unit === "y") return addYears(value, amount);
  return "";
}

function recurrenceSteps(anchor, afterDate, recurrence) {
  const elapsedDays =
    (utcDate(afterDate).valueOf() - utcDate(anchor).valueOf()) / 86_400_000;
  const [anchorYear, anchorMonth] = anchor.split("-").map(Number);
  const [afterYear, afterMonth] = afterDate.split("-").map(Number);
  const elapsedMonths =
    (afterYear - anchorYear) * 12 + afterMonth - anchorMonth;
  const unitSize = {
    d: recurrence.interval,
    b: (recurrence.interval * 7) / 5,
    w: recurrence.interval * 7,
    m: recurrence.interval,
    y: recurrence.interval * 12,
  }[recurrence.unit];
  const elapsed = ["d", "b", "w"].includes(recurrence.unit)
    ? elapsedDays
    : elapsedMonths;
  return Math.max(1, Math.floor(elapsed / unitSize) + 1);
}

export function nextRecurringTask(task, completionDate, id = Date.now()) {
  const recurrence = parseRecurrence(metadataValue(task, "rec"));
  if (!recurrence || !isDate(completionDate)) return null;

  const originalDue = metadataValue(task, "due");
  const anchor =
    recurrence.strict && isDate(originalDue) ? originalDue : completionDate;
  const thresholdAnchor = isDate(originalDue) ? originalDue : completionDate;
  let steps = recurrence.strict
    ? recurrenceSteps(anchor, completionDate, recurrence)
    : 1;
  let nextDue = addInterval(
    anchor,
    steps * recurrence.interval,
    recurrence.unit,
  );
  while (nextDue && nextDue <= completionDate) {
    steps += 1;
    nextDue = addInterval(anchor, steps * recurrence.interval, recurrence.unit);
  }
  while (steps > 1) {
    const previousDue = addInterval(
      anchor,
      (steps - 1) * recurrence.interval,
      recurrence.unit,
    );
    if (!previousDue || previousDue <= completionDate) break;
    steps -= 1;
    nextDue = previousDue;
  }
  if (!nextDue || !isDate(nextDue) || nextDue <= completionDate) return null;

  let nextTask = {
    ...task,
    id,
    completed: false,
    completionDate: "",
    creationDate: completionDate,
  };
  nextTask = setMetadataValue(nextTask, "due", nextDue);

  const threshold = metadataValue(task, "t");
  if (isDate(threshold)) {
    const thresholdOffset =
      (utcDate(threshold).valueOf() - utcDate(thresholdAnchor).valueOf()) /
      86_400_000;
    const nextThreshold = addCalendarDays(nextDue, thresholdOffset);
    if (isDate(nextThreshold)) {
      nextTask = setMetadataValue(nextTask, "t", nextThreshold);
    }
  }
  return nextTask;
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
    const leftDue = metadataValue(left, "due");
    const rightDue = metadataValue(right, "due");
    if (Boolean(leftDue) !== Boolean(rightDue)) {
      return leftDue ? -1 : 1;
    }
    if (leftDue && rightDue && leftDue !== rightDue) {
      return leftDue.localeCompare(rightDue);
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
