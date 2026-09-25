import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { findHiddenStateConflicts, describeHiddenStateConflict } from "../css-visibility.ts";

const html = (body: string) => [{ file: "index.html", content: `<html><body>${body}</body></html>` }];
const css = (content: string) => [{ file: "style.css", content }];

describe("findHiddenStateConflicts — generic hidden-state cascade defects", () => {
  test("REAL DEFECT: a later component rule with display:flex defeats an earlier .hidden{display:none}", () => {
    const conflicts = findHiddenStateConflicts({
      html: html('<div id="confirm" class="overlay hidden"></div>'),
      css: css(".hidden { display: none; }\n.overlay { position: fixed; display: flex; }"),
    });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.overridingSelector, ".overlay");
    assert.match(describeHiddenStateConflict(conflicts[0]!), /stays displayed/);
    assert.match(describeHiddenStateConflict(conflicts[0]!), /!important/);
  });

  test("no conflict when the hidden utility is !important", () => {
    assert.deepEqual(findHiddenStateConflicts({ html: html('<div class="overlay hidden"></div>'), css: css(".hidden { display: none !important; }\n.overlay { display: flex; }") }), []);
  });

  test("no conflict when the hidden rule comes later at equal specificity", () => {
    assert.deepEqual(findHiddenStateConflicts({ html: html('<div class="overlay hidden"></div>'), css: css(".overlay { display: flex; }\n.hidden { display: none; }") }), []);
  });

  test("an id selector (higher specificity) declared anywhere defeats a plain .hidden", () => {
    const conflicts = findHiddenStateConflicts({ html: html('<div id="panel" class="hidden"></div>'), css: css("#panel { display: block; }\n.hidden { display: none; }") });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.overridingSelector, "#panel");
  });

  test("the HTML hidden attribute loses to an author display rule", () => {
    const conflicts = findHiddenStateConflicts({ html: html('<div class="dialog" hidden></div>'), css: css(".dialog { display: grid; }") });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.hiddenSelector, "[hidden] attribute");
  });

  test("a [hidden]{display:none !important} rule protects the attribute", () => {
    assert.deepEqual(findHiddenStateConflicts({ html: html('<div class="dialog" hidden></div>'), css: css("[hidden] { display: none !important; }\n.dialog { display: grid; }") }), []);
  });

  test("elements that are not hidden, and rules for other states, are never flagged", () => {
    assert.deepEqual(findHiddenStateConflicts({ html: html('<div class="overlay open"></div>'), css: css(".hidden { display: none; }\n.overlay { display: flex; }") }), []);
    assert.deepEqual(findHiddenStateConflicts({ html: html('<div class="overlay hidden"></div>'), css: css(".hidden { display: none; }\n.overlay.open { display: flex; }") }), []);
  });

  test("scoped display rules (:not(.hidden)) and unsupported selectors are skipped, never guessed at", () => {
    assert.deepEqual(findHiddenStateConflicts({ html: html('<div class="overlay hidden"></div>'), css: css(".hidden { display: none; }\n.overlay:not(.hidden) { display: flex; }\nbody .overlay { display: flex; }") }), []);
  });

  test("rules inside @media and inline <style> blocks are considered; comments are ignored", () => {
    const inline = [{ file: "index.html", content: '<style>/* .hidden{display:block} */ .hidden{display:none} @media (min-width:1px){ .card{display:flex} }</style><div class="card hidden"></div>' }];
    const conflicts = findHiddenStateConflicts({ html: inline, css: [] });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.overridingSelector, ".card");
  });

  test("class names are never special-cased: any hiding utility and any component name behave identically", () => {
    const conflicts = findHiddenStateConflicts({ html: html('<section class="toast is-off"></section>'), css: css(".is-off { display: none; }\n.toast { display: block; }") });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.hiddenSelector, ".is-off");
  });
});
