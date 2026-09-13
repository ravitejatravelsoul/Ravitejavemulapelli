import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateReadme } from "../readme-generator.ts";

describe("generateReadme", () => {
  test("describes a static HTML/CSS/JS app with correct local-run instructions and no test/build sections", () => {
    const readme = generateReadme({
      projectTitle: "Pomodoro Timer",
      ideaText: "Build a polished single-page Pomodoro timer with 25-minute work and 5-minute break presets.",
      files: ["index.html", "script.js", "style.css"],
    });
    assert.match(readme, /# Pomodoro Timer/);
    assert.match(readme, /Build a polished single-page Pomodoro timer/);
    assert.match(readme, /Static web app/);
    assert.match(readme, /Double-click index\.html/);
    assert.doesNotMatch(readme, /## Tests/);
    assert.doesNotMatch(readme, /## Build/);
    assert.match(readme, /- index\.html — the application's entry point/);
  });

  test("describes a Node.js project (package.json present) with npm install/test/build instructions", () => {
    const readme = generateReadme({
      projectTitle: "API Service",
      ideaText: "A small REST API.",
      files: ["package.json", "index.js"],
    });
    assert.match(readme, /Node\.js project/);
    assert.match(readme, /npm install/);
    assert.match(readme, /## Tests/);
    assert.match(readme, /npm test/);
    assert.match(readme, /## Build/);
    assert.match(readme, /npm run build/);
  });

  test("never invents a description — uses the project's own real idea text verbatim (truncated only if very long)", () => {
    const readme = generateReadme({ projectTitle: "X", ideaText: "Exact real request text.", files: [] });
    assert.match(readme, /Exact real request text\./);
  });

  test("handles an empty workspace (no files yet) without throwing", () => {
    const readme = generateReadme({ projectTitle: "New Project", ideaText: "An idea.", files: [] });
    assert.match(readme, /No files have been generated yet/);
  });

  test("lists every real file, sorted, never a fabricated file", () => {
    const readme = generateReadme({ projectTitle: "T", ideaText: "I", files: ["b.js", "a.html"] });
    const aIndex = readme.indexOf("a.html");
    const bIndex = readme.indexOf("b.js");
    assert.ok(aIndex > 0 && bIndex > 0 && aIndex < bIndex, "files must be listed sorted");
  });
});
