function taskLines(content) {
  return content.split(/\r?\n/).filter((line) => line.trim());
}

export function createMergeRows(baseContent, serverContent, deviceContent) {
  const counts = new Map();
  for (const line of taskLines(baseContent)) {
    const count = counts.get(line) || { base: 0, server: 0, device: 0 };
    count.base += 1;
    counts.set(line, count);
  }
  for (const line of taskLines(serverContent)) {
    const count = counts.get(line) || { base: 0, server: 0, device: 0 };
    count.server += 1;
    counts.set(line, count);
  }
  for (const line of taskLines(deviceContent)) {
    const count = counts.get(line) || { base: 0, server: 0, device: 0 };
    count.device += 1;
    counts.set(line, count);
  }

  const rows = [];
  for (const [line, count] of counts) {
    const total = Math.max(count.base, count.server, count.device);
    for (let index = 0; index < total; index += 1) {
      const inBase = index < count.base;
      const inServer = index < count.server;
      const inDevice = index < count.device;
      if (!inBase && !inServer && !inDevice) continue;
      let change;
      if (inBase && inServer && inDevice) change = "unchanged";
      else if (!inBase && inServer && inDevice) change = "added-both";
      else if (!inBase && inServer) change = "added-server";
      else if (!inBase && inDevice) change = "added-device";
      else if (inBase && inServer) change = "removed-device";
      else if (inBase && inDevice) change = "removed-server";
      else if (inBase) continue;

      rows.push({
        id: rows.length,
        line,
        change,
        serverPresent: inServer,
        devicePresent: inDevice,
        keep: change.startsWith("added") || change === "unchanged",
      });
    }
  }
  return rows;
}

export function serializeMergeRows(rows) {
  const lines = rows.filter((row) => row.keep).map((row) => row.line);
  return lines.length ? `${lines.join("\n")}\n` : "";
}
