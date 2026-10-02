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
