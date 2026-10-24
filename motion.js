// Brief, interruptible feedback for task detail and scope changes.
// Nothing here gates state or input: each helper decorates a change that has
// already happened, and reduced motion skips it. Removing this module and its
// calls in app.js (plus motion.css) restores the static board.
const lessMotion = matchMedia('(prefers-reduced-motion: reduce)');
const enter = 'cubic-bezier(0.25, 1, 0.5, 1)';
const leave = 'cubic-bezier(0.5, 0, 0.75, 0)';
let ghost = null, ghostTimer = 0;

export function clearPanelGhost() {
  clearTimeout(ghostTimer);
  ghost?.remove();
  ghost = null;
}

// The closing panel is already hidden and inert; a detached visual copy fades
// over the new layout, so focus, history and clicks continue immediately.
export function retirePanel(panel) {
  clearPanelGhost();
  if (lessMotion.matches || panel.hidden) return;
  const rect = panel.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const style = getComputedStyle(panel);
  const copy = panel.cloneNode(true);
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  copy.classList.add('panel-ghost');
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('role'); copy.removeAttribute('aria-modal'); copy.removeAttribute('aria-labelledby');
  copy.style.cssText = `position:fixed;inset:auto;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;z-index:${style.zIndex === 'auto' ? 5 : style.zIndex};animation:none;pointer-events:none;`;
  document.body.append(copy);
  copy.scrollTop = panel.scrollTop;
  ghost = copy;
  const sheet = rect.top > 0 && rect.left === 0;
  const animation = copy.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: sheet ? 'translateY(12px)' : 'translateX(10px)' }],
    { duration: 150, easing: leave, fill: 'forwards' },
  );
  const done = () => { if (ghost === copy) clearPanelGhost(); else copy.remove(); };
  animation.finished.then(done, done);
  // Background tabs may pause the timeline; never leave the copy behind.
  ghostTimer = setTimeout(done, 400);
}

// A different task replaced the open detail: settle the new content in place.
export function settleDetail(body) {
  if (lessMotion.matches || !body) return;
  body.animate([{ opacity: 0.35, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: enter });
}

// A phase scope changed the chart's rows; fade the new rows rather than cut.
export function revealScope(region) {
  if (lessMotion.matches || !region) return;
  region.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 180, easing: enter });
}

let progressPulse = null;
// Briefly brighten the chosen segment, then ease back to its normal colour.
// Called after layout settles, so a hidden mobile overview does not flash later.
export function pulseProgress(segment) {
  progressPulse?.cancel();
  progressPulse = null;
  if (lessMotion.matches || !segment?.getClientRects().length) return;
  const marker = segment.querySelector('i');
  if (!marker) return;
  const normal = getComputedStyle(marker).filter;
  const animation = marker.animate([
    { filter: normal, offset: 0, easing: enter },
    { filter: 'brightness(1.35)', offset: .24 },
    { filter: 'brightness(1.35)', offset: .36, easing: 'cubic-bezier(.4, 0, .2, 1)' },
    { filter: normal, offset: 1 },
  ], { duration: 440 });
  progressPulse = animation;
  const clear = () => { if (progressPulse === animation) progressPulse = null; };
  animation.finished.then(clear, clear);
}
