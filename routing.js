// Orthogonal connections through the available whitespace between task blocks.
const same = (a, b) => Math.abs(a - b) < .01;
export function simplifyRoute(points) {
  const result = [];
  for (const p of points) {
    if (result.length && same(p[0], result.at(-1)[0]) && same(p[1], result.at(-1)[1])) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      if ((same(a[0], b[0]) && same(b[0], p[0])) || (same(a[1], b[1]) && same(b[1], p[1]))) result.pop();
      else break;
    }
    result.push(p);
  }
  return result;
}
export function segmentIsClear(a, b, obstacles, padding = 4) {
  if (!same(a[0], b[0]) && !same(a[1], b[1])) return false;
  return obstacles.every(r => {
    if (same(a[1], b[1])) return a[1] <= r.top - padding || a[1] >= r.bottom + padding || Math.max(a[0], b[0]) <= r.left - padding || Math.min(a[0], b[0]) >= r.right + padding;
    return a[0] <= r.left - padding || a[0] >= r.right + padding || Math.max(a[1], b[1]) <= r.top - padding || Math.min(a[1], b[1]) >= r.bottom + padding;
  });
}
export function orthogonalRoute(start, end, obstacles, bendX) {
  const [x1, y1] = start, [x2, y2] = end;
  if (x2 <= x1) return null; // Invalid/backward dependency: do not invent a path.
  const candidates = [];
  function consider(points, preference = 0) {
    const route = simplifyRoute(points);
    if (!route.slice(1).every((p, i) => segmentIsClear(route[i], p, obstacles))) return;
    const distance = route.slice(1).reduce((sum, p, i) => sum + Math.abs(p[0] - route[i][0]) + Math.abs(p[1] - route[i][1]), 0);
    candidates.push({ route, cost: distance + (route.length - 2) * 22 + preference * .001 });
  }
  if (same(y1, y2)) consider([start, [x2, y1]]);
  const preferredX = Number.isFinite(bendX) ? bendX : (x1 + x2) / 2;
  const xs = [...new Set([preferredX, (x1 + x2) / 2, x1 + 10, x2 - 10, ...obstacles.flatMap(r => [r.left - 10, r.right + 10])])]
    .filter(x => x > x1 + 5 && x < x2 - 5);
  for (const x of xs) consider([start, [x, y1], [x, y2], end], Math.abs(x - preferredX));
  // Three straight segments suffice whenever the corridor between columns is free.
  if (candidates.length) return candidates.sort((a, b) => a.cost - b.cost)[0].route;
  // Only take a second corridor when an intervening task really blocks the first.
  const sx = x1 + Math.min(12, (x2 - x1) / 3), tx = x2 - Math.min(12, (x2 - x1) / 3);
  const ys = [...new Set([y1, y2, ...obstacles.flatMap(r => [r.top - 10, r.bottom + 10])])];
  for (const y of ys) consider([start, [sx, y1], [sx, y], [tx, y], [tx, y2], end]);
  return candidates.sort((a, b) => a.cost - b.cost)[0]?.route || null;
}
export function routePath(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
}
