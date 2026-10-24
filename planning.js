/** Relative task sequence, independent of worker execution intervals and dates. */
export function buildPlan(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const levels = new Map(), invalid = new Set();
  const complete = task => task?.status === 'done';
  const unfinishedParents = task => (task.dependencies || []).filter(id => !complete(byId.get(id)));
  function visit(id, stack = []) {
    if (levels.has(id)) return levels.get(id);
    const task = byId.get(id);
    if (!task) return 0;
    if (complete(task)) { levels.set(id, 0); return 0; }
    if (stack.includes(id)) { for (const member of stack.slice(stack.indexOf(id))) invalid.add(member); return 1; }
    const parents = unfinishedParents(task);
    if (parents.some(parent => !byId.has(parent))) invalid.add(id);
    let level = task.status === 'planned' ? 2 : 1;
    for (const parent of parents) level = Math.max(level, visit(parent, [...stack, id]) + 1);
    levels.set(id, level);
    return level;
  }
  tasks.forEach(task => visit(task.id));
  function descendants(id) {
    const result = new Set(), pending = [id];
    while (pending.length) {
      const parent = pending.pop();
      for (const task of tasks) {
        if (task.id === id || complete(task) || !(task.dependencies || []).includes(parent) || result.has(task.id)) continue;
        result.add(task.id); pending.push(task.id);
      }
    }
    return [...result];
  }
  const nodes = new Map(tasks.map(task => {
    const waiting = unfinishedParents(task);
    const directNext = tasks.filter(next => !complete(next) && (next.dependencies || []).includes(task.id));
    const unlocks = complete(task) ? [] : directNext.filter(next => unfinishedParents(next).every(id => id === task.id)).map(next => next.id);
    return [task.id, {level:levels.get(task.id),complete:complete(task),waiting,
      invalid:invalid.has(task.id),ready:!complete(task)&&waiting.length===0&&!invalid.has(task.id)&&task.status!=='blocked',
      unlocks, downstream:descendants(task.id)}];
  }));
  const maxLevel = Math.max(3, ...levels.values());
  return {nodes,byId,maxLevel,columns:Array.from({length:maxLevel+1},(_,i)=>({
    label:i===0?'確認済み':i===1?'現在':i===2?'次に着手':i===3?'その後':`さらに先 ${i-3}`,
    description:i===0?'完了した作業':i===1?'並行して進める':i===2?'前提が揃い次第':'後続の作業'
  }))};
}
