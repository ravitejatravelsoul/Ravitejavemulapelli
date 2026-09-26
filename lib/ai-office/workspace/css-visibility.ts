import "server-only";

/**
 * Generic, deterministic detector for a real cascade defect: an element
 * that is meant to be hidden (via a `hidden` utility class or the HTML
 * `hidden` attribute) but whose own component rule sets `display` with
 * equal/greater specificity and later source order, so the "hidden"
 * state silently loses. A hidden-but-displayed full-screen overlay then
 * intercepts pointer events for every unrelated control on the page (the
 * exact failure a real generated app hit: `.hidden{display:none}`
 * declared before `.modal{display:flex;position:fixed}`).
 *
 * Deliberately narrow and regex-based (no full CSS engine): single-class,
 * id, tag.class and `[hidden]` selectors at top level or inside plain
 * `@media` blocks are compared; anything it cannot classify with
 * confidence is skipped rather than reported. Names such as "modal" are
 * never hardcoded — the conflict is derived purely from the workspace's
 * own markup and rules.
 */

export interface HiddenStateConflict {
  htmlFile: string;
  element: string;
  hiddenSelector: string;
  hiddenSource: string;
  overridingSelector: string;
  overridingDisplay: string;
  overridingSource: string;
}

interface CssRule {
  selector: string;
  display: string | null;
  displayImportant: boolean;
  specificity: [number, number, number];
  order: number;
  source: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!not\b)[\w-]+/g) ?? []).length;
  const tags = (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g, " ").match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, tags];
}

function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  return 0;
}

/** Flattens top-level rules and the contents of plain @media blocks; skips other at-rules entirely. */
function parseRules(css: string, source: string, startOrder: number): CssRule[] {
  const rules: CssRule[] = [];
  let order = startOrder;
  const text = stripComments(css);

  const visit = (chunk: string) => {
    let i = 0;
    while (i < chunk.length) {
      const open = chunk.indexOf("{", i);
      if (open === -1) break;
      const prelude = chunk.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < chunk.length && depth > 0) {
        if (chunk[j] === "{") depth++;
        else if (chunk[j] === "}") depth--;
        j++;
      }
      const body = chunk.slice(open + 1, j - 1);
      i = j;
      if (prelude.startsWith("@")) {
        if (/^@media\b/i.test(prelude)) visit(body);
        continue;
      }
      const displayMatch = /(?:^|;|\s)display\s*:\s*([^;!}]+?)\s*(!important)?\s*(?:;|$)/i.exec(body.trim());
      for (const selector of prelude.split(",").map((s) => s.trim()).filter(Boolean)) {
        rules.push({
          selector,
          display: displayMatch ? displayMatch[1]!.trim().toLowerCase() : null,
          displayImportant: Boolean(displayMatch?.[2]),
          specificity: specificity(selector),
          order: order++,
          source,
        });
      }
    }
  };
  visit(text);
  return rules;
}

function extractStyleBlocks(html: string): string[] {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!);
}

interface HtmlElementInfo {
  tag: string;
  id: string | null;
  classes: string[];
  hiddenAttribute: boolean;
  text: string;
}

function extractElements(html: string): HtmlElementInfo[] {
  const elements: HtmlElementInfo[] = [];
  for (const match of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const attrs = match[2]!;
    const classAttr = /\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? null;
    const hiddenAttribute = /(^|\s)hidden(\s|=|$)/i.test(attrs.replace(/\bclass\s*=\s*["'][^"']*["']/i, ""));
    const classes = classAttr.split(/\s+/).filter(Boolean);
    if (classes.length === 0 && !hiddenAttribute) continue;
    elements.push({ tag: match[1]!.toLowerCase(), id, classes, hiddenAttribute, text: `<${match[1]}${id ? ` id="${id}"` : ""}${classAttr ? ` class="${classAttr}"` : ""}${hiddenAttribute ? " hidden" : ""}>` });
  }
  return elements;
}

/** Does `selector` (already known to be a simple compound selector we can evaluate) match this element? Returns false for anything it cannot evaluate confidently. */
function matches(selector: string, el: HtmlElementInfo): boolean {
  const s = selector.trim();
  if (/[\s>+~:]/.test(s)) return false; // descendant/sibling/pseudo selectors: out of scope, never guessed at
  if (s === "[hidden]") return el.hiddenAttribute;
  const m = /^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)$/.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) return false;
  if (m[1] && m[1].toLowerCase() !== el.tag) return false;
  if (m[2] && m[2].slice(1) !== el.id) return false;
  const required = (m[3] ?? "").split(".").filter(Boolean);
  return required.every((c) => el.classes.includes(c));
}

export function findHiddenStateConflicts(input: { html: Array<{ file: string; content: string }>; css: Array<{ file: string; content: string }> }): HiddenStateConflict[] {
  const rules: CssRule[] = [];
  for (const { file, content } of input.css) rules.push(...parseRules(content, file, rules.length));
  for (const { file, content } of input.html) for (const block of extractStyleBlocks(content)) rules.push(...parseRules(block, file, rules.length));

  // A "hiding rule" is a rule whose only job is `display:none` on a
  // reusable state selector (single class, or [hidden]).
  const hidingRules = rules.filter((r) => r.display === "none" && (/^\.[\w-]+$/.test(r.selector) || r.selector === "[hidden]"));
  const conflicts: HiddenStateConflict[] = [];
  const seen = new Set<string>();

  for (const { file, content } of input.html) {
    for (const el of extractElements(content)) {
      const hiddenBy = hidingRules.filter((r) => matches(r.selector, el));
      const implicitAttr = el.hiddenAttribute;
      if (hiddenBy.length === 0 && !implicitAttr) continue;

      // The real cascade winner among every author rule that declares
      // `display` for this element: important first, then specificity,
      // then source order. (The UA `[hidden]` style loses to any author
      // display declaration.)
      const candidates = rules.filter((r) => r.display !== null && matches(r.selector, el));
      const winner = candidates.reduce<CssRule | null>((best, r) => {
        if (!best) return r;
        if (r.displayImportant !== best.displayImportant) return r.displayImportant ? r : best;
        const cmp = compareSpecificity(r.specificity, best.specificity);
        if (cmp !== 0) return cmp > 0 ? r : best;
        return r.order > best.order ? r : best;
      }, null);
      if (!winner || winner.display === "none") continue;

      const hider = hiddenBy[0];
      const key = `${file}|${el.text}|${winner.selector}|${winner.display}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        htmlFile: file,
        element: el.text,
        hiddenSelector: hider ? hider.selector : "[hidden] attribute",
        hiddenSource: hider ? hider.source : file,
        overridingSelector: winner.selector,
        overridingDisplay: winner.display!,
        overridingSource: winner.source,
      });
    }
  }
  return conflicts;
}

export function describeHiddenStateConflict(c: HiddenStateConflict): string {
  return (
    `${c.htmlFile}: ${c.element} is meant to be hidden via ${c.hiddenSelector} (display:none, ${c.hiddenSource}), but ${c.overridingSelector} ` +
    `(display:${c.overridingDisplay}, ${c.overridingSource}) overrides it, so the "hidden" element stays displayed and can cover or block clicks on unrelated controls. ` +
    `Make the hidden state win (e.g. ".hidden { display: none !important; }" declared for every hidden utility/[hidden]) or scope the display rule so it does not apply while hidden.`
  );
}
