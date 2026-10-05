export function buildServerFileTree(paths, search = "") {
  const query = search.trim().toLowerCase();
  const root = new Map();

  for (const path of paths) {
    if (query && !path.toLowerCase().includes(query)) continue;
    const parts = path.split("/");
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const id = isFile ? `file:${part}` : `directory:${part}`;
      let node = current.get(id);
      if (!node) {
        node = {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          type: isFile ? "file" : "directory",
          children: isFile ? null : new Map(),
        };
        current.set(id, node);
      }
      if (!isFile) current = node.children;
    });
  }

  function serialize(nodes) {
    return [...nodes.values()]
      .sort(
        (left, right) =>
          Number(left.type === "file") - Number(right.type === "file") ||
          left.name.localeCompare(right.name),
      )
      .map((node) => ({
        ...node,
        children: node.children ? serialize(node.children) : null,
      }));
  }

  return serialize(root);
}

export function countServerFiles(nodes) {
  return nodes.reduce(
    (count, node) =>
      count +
      (node.type === "file" ? 1 : countServerFiles(node.children || [])),
    0,
  );
}
