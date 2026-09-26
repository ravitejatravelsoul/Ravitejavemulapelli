import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|css)$/.test(name) && !rel.includes("__tests__") && !rel.includes("/e2e/")) out.push(rel);
  }
  return out;
}

test("/office renders the 3D Headquarters and Classic Office is preserved at /office/classic", () => {
  const primary = read("app/office/(protected)/page.tsx");
  assert.match(primary, /HeadquartersLoader/);
  assert.doesNotMatch(primary, /getOfficeFloorView|getOfficeDb/);
  const classic = read("app/office/(protected)/classic/page.tsx");
  assert.match(classic, /getOfficeFloorView/);
  assert.match(classic, /getOfficeDb/);
});

test("both experiences share the one protected layout (auth + mode-aware state)", () => {
  const layout = read("app/office/(protected)/layout.tsx");
  assert.match(layout, /verifySession\(\)/);
  assert.match(layout, /isRemoteExecutionMode\(\)/);
  assert.equal(statSync(join(root, "app/office/(protected)/classic")).isDirectory(), true);
  assert.throws(() => statSync(join(root, "app/office/classic")), "classic must not bypass the protected group");
});

test("legacy /office/headquarters URL redirects to the primary Office", () => {
  const legacy = read("app/office/(protected)/headquarters/page.tsx");
  assert.match(legacy, /redirect\(/);
  assert.doesNotMatch(legacy, /HeadquartersLoader/);
});

test("navigation enters Headquarters and offers Classic Office unobtrusively", () => {
  const nav = read("components/ai-office/shell/office-sidebar-nav.tsx");
  assert.match(nav, /href: "\/office", label: "Headquarters"/);
  assert.match(nav, /href: "\/office\/classic", label: "Classic Office"/);
});

test("every 3D fallback path leads to Classic Office, never back to the 3D route", () => {
  for (const file of [
    "components/ai-office/world-prototype/world-experience.tsx",
    "components/ai-office/world-prototype/world-loader.tsx",
    "components/ai-office/headquarters/headquarters-loader.tsx",
    "components/ai-office/headquarters/headquarters-world.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /href="\/office"/, `${file} must not link its fallback to the 3D route`);
    assert.match(source, /href="\/office\/classic"/, `${file} needs a Classic Office fallback`);
  }
  const world = read("components/ai-office/world-prototype/world-experience.tsx");
  assert.match(world, /componentDidCatch|getDerivedStateFromError/, "render failures are caught by an error boundary");
  assert.match(world, /"unsupported"/);
  assert.match(world, /"mobile"/);
});

test("classic-only selections deep-link to /office/classic", () => {
  assert.match(read("components/ai-office/dashboard/agents-grid.tsx"), /\/office\/classic\?agent=/);
  assert.match(read("components/ai-office/headquarters/headquarters-panel.tsx"), /"\/office\/classic\?"/);
  assert.match(read("components/ai-office/headquarters/headquarters-world.tsx"), /"\/office\?project="/);
});

test("Office mutations revalidate both experiences", () => {
  for (const file of readdirSync(join(root, "app/office/actions"))) {
    const source = read(`app/office/actions/${file}`);
    assert.doesNotMatch(source, /revalidatePath\("\/office"\)/, `${file} must revalidate the /office layout`);
  }
});

test("client and page code never statically pull Playwright or node:sqlite into Office rendering", () => {
  for (const file of [...walk("components/ai-office"), ...walk("app/office")]) {
    const source = read(file);
    if (/^\s*"use client"/m.test(source)) {
      assert.doesNotMatch(source, /from "(?:playwright|node:sqlite|node:fs)/, `${file} is client code`);
    }
    assert.doesNotMatch(source, /from "playwright/, `${file} must not import Playwright`);
  }
  const hq = read("app/office/(protected)/page.tsx") + read("components/ai-office/headquarters/headquarters-loader.tsx");
  assert.doesNotMatch(hq, /node:sqlite|playwright/);
});

test("speech stays client-only", () => {
  const speech = read("components/ai-office/headquarters/use-office-speech.ts");
  assert.doesNotMatch(speech, /from "node:|process\.env\.[A-Z_]*KEY/);
});
