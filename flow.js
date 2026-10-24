/** Lay out dependency chains horizontally, preserving branches and joins. */
export function layoutFlow(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const order = new Map(tasks.map((t, i) => [t.id, i]));
  const columns = new Map();
  function column(id, visiting = new Set()) {
    if (columns.has(id)) return columns.get(id);
    if (visiting.has(id)) return 0;
    const next = new Set([...visiting, id]);
    const parents = (byId.get(id).dependencies || []).filter(p => byId.has(p));
    const value = parents.length ? 1 + Math.max(...parents.map(p => column(p, next))) : 0;
    columns.set(id, value);
    return value;
  }
  tasks.forEach(t => column(t.id));
  const nodes = new Map();
  const groups = [...new Set(tasks.map(t => t.area || '開発'))].map(area => {
    const items = tasks.filter(t => (t.area || '開発') === area)
      .sort((a, b) => columns.get(a.id) - columns.get(b.id) || order.get(a.id) - order.get(b.id));
    const rows = [];
    for (const task of items) {
      const col = columns.get(task.id);
      const parents = (task.dependencies || []).map(p => nodes.get(p)).filter(n => n?.area === area);
      // Continue a predecessor's row only when its latest task is a dependency.
      // Unrelated independent work must never look serial just to save space.
      const candidates = [...new Set(parents.map(n => n.row))]
        .filter(row => (task.dependencies || []).includes(rows[row].at(-1).id))
        .sort((a, b) => a - b);
      let row = candidates.find(r => columns.get(rows[r].at(-1).id) < col);
      if (row === undefined) { row = rows.length; rows.push([]); }
      rows[row].push(task);
      nodes.set(task.id, { col, row, area });
    }
    function origin(task, seen = new Set()) {
      if (seen.has(task.id)) return order.get(task.id);
      const parents = (task.dependencies || []).map(id => byId.get(id)).filter(t => t && (t.area || '開発') === area);
      return parents.length ? Math.min(...parents.map(t => origin(t, new Set([...seen, task.id])))) : order.get(task.id);
    }
    // Keep branches alongside their originating flow before unrelated roots.
    rows.sort((a, b) => origin(a[0]) - origin(b[0]) || order.get(a[0].id) - order.get(b[0].id));
    rows.forEach((row, index) => row.forEach(t => { nodes.get(t.id).row = index; }));
    return { area, rows, tasks: rows.flat() };
  });
  return { nodes, groups, columns: Math.max(0, ...columns.values()) + 1 };
}

/** Activity comes from fresh native runs, never from the curated task status. */
export function activeRuns(task, snapshot, live, now = Date.now()) {
  const age = snapshot?.demoArchive ? 0 : now - Date.parse(snapshot?.updatedAt);
  if (!live || !Number.isFinite(age) || age < -60000 || age > 180000) return [];
  const runs = new Map();
  for (const interval of task.intervals || []) {
    if (interval.status === 'running' && !interval.end) runs.set(interval.id, interval);
  }
  for (const worker of snapshot.workers || []) {
    if (worker.taskId === task.id && worker.status === 'running' && !runs.has(worker.id)) runs.set(worker.id, worker);
  }
  return [...runs.values()];
}

/** Publisher and agent CLI share eligibility; the UI only checks freshness. */
export function readyToStart(task, snapshot, live, now = Date.now()) {
  const age = snapshot?.demoArchive ? 0 : now - Date.parse(snapshot?.updatedAt);
  return Boolean(live && Number.isFinite(age) && age >= -60000 && age <= 180000
    && task.readiness?.ready === true);
}
