// Tracks recent line-level operations per file so the conflict resolver can
// present related added/removed lines (for example, completing a task) as a
// single reviewable action instead of two unrelated entries.

const MAX_OPERATIONS_PER_KEY = 50;

function taskLines(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
}

// Multiset difference between two documents: lines only present in `before`
// are considered removed, lines only present in `after` are considered added.
export function diffLines(before, after) {
  const counts = new Map();
  for (const line of taskLines(before)) {
    counts.set(line, (counts.get(line) || 0) + 1);
  }
  const added = [];
  for (const line of taskLines(after)) {
    const count = counts.get(line) || 0;
    if (count > 0) counts.set(line, count - 1);
    else added.push(line);
  }
  const removed = [];
  for (const [line, count] of counts) {
    for (let index = 0; index < count; index += 1) removed.push(line);
  }
  return { removed, added };
}

// Append an operation describing how `before` became `after`. Returns a new
// history object; the original is left untouched. No-op diffs are ignored.
export function recordOperation(
  history,
  { key, label, before, after, timestamp = Date.now() },
) {
  if (!key) return history;
  const { removed, added } = diffLines(before, after);
  if (!removed.length && !added.length) return history;
  const previous = Array.isArray(history?.[key]) ? history[key] : [];
  const operation = { id: timestamp, label, removed, added, timestamp };
  const next = [...previous, operation].slice(-MAX_OPERATIONS_PER_KEY);
  return { ...history, [key]: next };
}

export function operationsForKey(history, key) {
  return Array.isArray(history?.[key]) ? history[key] : [];
}

// Group merge rows that belong to the same recorded operation (newest first)
// so a completion or edit shows as one linked action. Rows that do not match
// any operation are returned as standalone items in their original order.
export function groupMergeRows(rows, operations) {
  const used = new Set();
  const items = [];
  const ordered = [...(operations || [])].sort(
    (left, right) => (right.timestamp || 0) - (left.timestamp || 0),
  );

  for (const operation of ordered) {
    const matched = [];
    const take = (line, changes) => {
      const row = rows.find(
        (candidate) =>
          !used.has(candidate.id) &&
          !matched.includes(candidate) &&
          candidate.line === line &&
          changes.includes(candidate.change),
      );
      if (row) matched.push(row);
    };
    for (const line of operation.removed || []) take(line, ["removed-device"]);
    for (const line of operation.added || [])
      take(line, ["added-device", "added-both"]);

    // Only form a group when the operation links more than one merge row;
    // otherwise it is just a normal single add or removal.
    if (matched.length >= 2) {
      matched.forEach((row) => used.add(row.id));
      items.push({
        type: "group",
        id: `op-${operation.id}`,
        label: operation.label,
        rows: matched,
      });
    }
  }

  for (const row of rows) {
    if (!used.has(row.id))
      items.push({ type: "row", id: `row-${row.id}`, row });
  }
  return items;
}
