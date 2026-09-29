/**
 * ─── Runtime French → Arabic auto-translation ──────────────────────────────────
 * The 30 page components hard-code French text (they don't call t()). Rather than
 * rewrite thousands of strings across every page, this engine translates the
 * rendered UI at runtime whenever the active language is Arabic:
 *
 *   • An initial sweep translates all matching text nodes + attributes.
 *   • A MutationObserver keeps translating content React adds/updates later
 *     (route changes, modals, lists, toasts…).
 *
 * Only exact dictionary matches (see `frToAr.ts`) are swapped, so data values
 * (names, numbers, references) are never altered. Switching back to French does
 * a clean reload to restore the original strings.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import i18n from '../i18n';
import { FR_AR } from './frToAr';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// Normalised lookup built once.
const MAP = new Map<string, string>();
for (const [k, v] of Object.entries(FR_AR)) MAP.set(norm(k), v);

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

let observer: MutationObserver | null = null;

function translateTextNode(node: Text) {
  const raw = node.nodeValue;
  if (!raw) return;
  const key = norm(raw);
  if (!key) return;
  const ar = MAP.get(key);
  if (ar && ar !== raw) {
    const lead = raw.match(/^\s*/)?.[0] ?? '';
    const trail = raw.match(/\s*$/)?.[0] ?? '';
    node.nodeValue = lead + ar + trail;
  }
}

function translateAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const ar = MAP.get(norm(v));
    if (ar && ar !== v) el.setAttribute(a, ar);
  }
}

function walkTextNodes(root: Node) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = (n as Text).parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || p.isContentEditable) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const texts: Text[] = [];
  let cur = tw.nextNode();
  while (cur) { texts.push(cur as Text); cur = tw.nextNode(); }
  texts.forEach(translateTextNode);
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { translateTextNode(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  walkTextNodes(root);
  const el = root as Element;
  translateAttrs(el);
  el.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(translateAttrs);
}

/** Translate everything currently in the document (idempotent). */
export function sweep() {
  if (typeof document === 'undefined' || !document.body) return;
  walk(document.body);
}

export function startAutoTranslate() {
  if (i18n.language !== 'ar') return;
  sweep();
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        if (m.target.nodeType === Node.TEXT_NODE) translateTextNode(m.target as Text);
      } else if (m.type === 'attributes') {
        if (m.target.nodeType === Node.ELEMENT_NODE) translateAttrs(m.target as Element);
      } else if (m.type === 'childList') {
        m.addedNodes.forEach(walk);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

export function stopAutoTranslate() {
  observer?.disconnect();
  observer = null;
}

/**
 * Install the language-change lifecycle once. Call from the app root.
 *  - fr → ar : start translating live.
 *  - ar → fr : stop + reload so the original French text is restored cleanly.
 */
let installed = false;
export function installAutoTranslate() {
  if (installed) { startAutoTranslate(); return; }
  installed = true;
  startAutoTranslate();
  i18n.on('languageChanged', (lng: string) => {
    if (lng === 'ar') {
      // Defer one frame so React has rendered the new language's tree first.
      setTimeout(startAutoTranslate, 0);
    } else {
      stopAutoTranslate();
      if (typeof window !== 'undefined') window.location.reload();
    }
  });
}
