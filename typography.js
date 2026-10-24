// Apply spacing to prose only. Keep source data, URLs, code and editable notes
// unchanged, including when a live snapshot refreshes the detail panel.
export function spaceProseArrows(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (/[←→↔⇐⇒⇔]/u.test(node.data) &&
        !node.parentElement?.closest('script,style,svg,textarea,input,pre,code,[contenteditable],.prose-arrow')) {
      nodes.push(node);
    }
  }
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    const parts = node.data.split(/[ \t\u2009]*([←→↔⇐⇒⇔])[ \t\u2009]*/u);
    parts.forEach((part, index) => {
      if (index % 2) {
        const arrow = document.createElement('span');
        arrow.className = 'prose-arrow';
        arrow.textContent = part;
        fragment.append(arrow);
      } else {
        fragment.append(document.createTextNode(part));
      }
    });
    node.replaceWith(fragment);
  }
}
