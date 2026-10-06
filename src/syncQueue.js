export function settlePendingWrite(queue, key, submittedContent, etag) {
  const latest = queue[key];
  if (!latest) return queue;

  const next = { ...queue };
  if (latest.content === submittedContent) {
    delete next[key];
  } else {
    next[key] = {
      ...latest,
      baseContent: submittedContent,
      etag,
      status: "pending",
    };
  }
  return next;
}

export function classifyRemoteContent(localContent, queued, remote) {
  if (!remote.exists) return "deleted";
  if (queued?.status === "conflict") return "conflict";
  if (queued && remote.unchanged) return "retry";
  if (remote.unchanged) return "unchanged";
  if (!queued) {
    return remote.content === localContent ? "unchanged" : "fast-forward";
  }
  if (remote.content === queued.content || remote.content === localContent) {
    return "already-synced";
  }
  if (
    typeof queued.baseContent === "string" &&
    remote.content === queued.baseContent
  ) {
    return "retry";
  }
  return "conflict";
}
