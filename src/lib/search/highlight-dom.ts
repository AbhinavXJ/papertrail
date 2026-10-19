import { highlightRanges, type HighlightSpec } from "./tokenize";

/** Wraps every matching word inside `root`'s text nodes in <mark>. Returns the marks created. */
export function highlightDom(root: HTMLElement, spec: HighlightSpec | null): HTMLElement[] {
  root.querySelectorAll("mark[data-pt]").forEach((m) => m.replaceWith(...m.childNodes));
  root.normalize();
  if (!spec || (!spec.terms.length && !spec.prefixes.length)) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.data;
    const ranges = highlightRanges(text, spec);
    if (!ranges.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [s, e] of ranges) {
      if (s > pos) frag.append(text.slice(pos, s));
      const m = document.createElement("mark");
      m.dataset.pt = "";
      m.textContent = text.slice(s, e);
      frag.append(m);
      marks.push(m);
      pos = e;
    }
    if (pos < text.length) frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
  return marks;
}
