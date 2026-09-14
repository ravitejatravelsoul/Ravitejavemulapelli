import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { selectRelevantFiles, extractLocalReferences, type FileCandidate } from "../relevant-files.ts";

function files(...paths: string[]): FileCandidate[] {
  return paths.map((path) => ({ path, sizeBytes: 500, lastModifiedByTaskId: null }));
}

describe("selectRelevantFiles", () => {
  test("a file this exact task already wrote outranks everything else", () => {
    const candidates: FileCandidate[] = [
      { path: "index.html", sizeBytes: 500, lastModifiedByTaskId: null },
      { path: "unrelated-notes.md", sizeBytes: 500, lastModifiedByTaskId: "t1" },
    ];
    const result = selectRelevantFiles({ files: candidates, taskId: "t1", taskTitle: "Implement frontend", failingChecks: [], maxFiles: 1 });
    assert.deepEqual(result.selectedPaths, ["unrelated-notes.md"]);
    assert.deepEqual(result.excludedPaths, ["index.html"]);
  });

  test("a failure reason naming a filename prioritizes that exact file", () => {
    const candidates = files("index.html", "style.css", "script.js");
    const result = selectRelevantFiles({
      files: candidates,
      taskId: "t1",
      taskTitle: "Fix bug",
      failingChecks: ["The button in script.js does not respond to clicks."],
      maxFiles: 1,
    });
    assert.deepEqual(result.selectedPaths, ["script.js"]);
  });

  test("unrelated files are excluded, not silently dropped without a record", () => {
    const candidates = files("index.html", "script.js", "readme.md", "old-notes.txt");
    const result = selectRelevantFiles({ files: candidates, taskId: "t1", taskTitle: "Implement frontend", failingChecks: [], maxFiles: 2 });
    assert.equal(result.selectedPaths.length, 2);
    assert.equal(result.excludedPaths.length, 2);
    assert.equal(result.selectedPaths.length + result.excludedPaths.length, candidates.length);
  });

  test("maxFiles of 0 selects nothing at all", () => {
    const result = selectRelevantFiles({ files: files("index.html"), taskId: "t1", taskTitle: "x", failingChecks: [], maxFiles: 0 });
    assert.deepEqual(result.selectedPaths, []);
    assert.deepEqual(result.excludedPaths, ["index.html"]);
  });

  test("index.html is preferred as a default anchor even with no other signal", () => {
    const candidates = files("about.txt", "index.html", "notes.md");
    const result = selectRelevantFiles({ files: candidates, taskId: "t1", taskTitle: "", failingChecks: [], maxFiles: 1 });
    assert.deepEqual(result.selectedPaths, ["index.html"]);
  });

  test("selection is deterministic across repeated calls with identical input", () => {
    const candidates = files("a.js", "b.js", "c.js", "d.js", "e.js");
    const first = selectRelevantFiles({ files: candidates, taskId: "t1", taskTitle: "frontend script work", failingChecks: [], maxFiles: 2 });
    const second = selectRelevantFiles({ files: candidates, taskId: "t1", taskTitle: "frontend script work", failingChecks: [], maxFiles: 2 });
    assert.deepEqual(first.selectedPaths, second.selectedPaths);
  });
});

describe("extractLocalReferences", () => {
  test("extracts a local script src and stylesheet href, ignoring remote/data URIs", () => {
    const html = `<html><head><link rel="stylesheet" href="style.css"></head><body><script src="script.js"></script><img src="https://cdn.example.com/x.png"><img src="data:image/png;base64,AAAA"></body></html>`;
    assert.deepEqual(new Set(extractLocalReferences(html)), new Set(["style.css", "script.js"]));
  });

  test("extracts a relative ES-module import specifier", () => {
    const js = `import { helper } from "./helper.js";\nimport React from "react";`;
    assert.deepEqual(extractLocalReferences(js), ["helper.js"]);
  });

  test("strips query/hash suffixes from an extracted reference", () => {
    assert.deepEqual(extractLocalReferences('<script src="script.js?v=2#frag"></script>'), ["script.js"]);
  });

  test("returns nothing for content with no local references", () => {
    assert.deepEqual(extractLocalReferences("<h1>Hello, World!</h1>"), []);
  });
});
