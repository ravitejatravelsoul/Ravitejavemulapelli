import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isLocalRelativePath, rewriteLocalResourceLinks } from "../rewrite-preview-links.ts";

describe("isLocalRelativePath", () => {
  test("treats plain relative filenames as local", () => {
    assert.equal(isLocalRelativePath("styles.css"), true);
    assert.equal(isLocalRelativePath("assets/script.js"), true);
  });

  test("rejects root-relative paths", () => {
    assert.equal(isLocalRelativePath("/absolute/path.css"), false);
  });

  test("rejects absolute URLs and protocol-relative URLs", () => {
    assert.equal(isLocalRelativePath("https://example.com/style.css"), false);
    assert.equal(isLocalRelativePath("//example.com/style.css"), false);
  });

  test("rejects fragments and data URIs", () => {
    assert.equal(isLocalRelativePath("#section"), false);
    assert.equal(isLocalRelativePath("data:image/png;base64,abc"), false);
  });
});

describe("rewriteLocalResourceLinks", () => {
  test("appends the token to a local relative href/src", () => {
    const html = '<link rel="stylesheet" href="styles.css" /><script src="script.js"></script>';
    const result = rewriteLocalResourceLinks(html, "TOKEN123");
    assert.match(result, /href="styles\.css\?token=TOKEN123"/);
    assert.match(result, /src="script\.js\?token=TOKEN123"/);
  });

  test("leaves absolute/external/fragment/data-uri references untouched", () => {
    const html = [
      '<a href="/absolute">x</a>',
      '<a href="https://example.com">x</a>',
      '<a href="#top">x</a>',
      '<img src="data:image/png;base64,abc" />',
    ].join("");
    const result = rewriteLocalResourceLinks(html, "TOKEN123");
    assert.equal(result, html, "no local resource references exist, so nothing should change");
  });

  test("URL-encodes the token when appended", () => {
    const html = '<script src="script.js"></script>';
    const result = rewriteLocalResourceLinks(html, "a.b/c+d");
    assert.match(result, /src="script\.js\?token=a\.b%2Fc%2Bd"/);
  });

  test("uses '&' instead of '?' when the local reference already has a query string", () => {
    const html = '<script src="script.js?v=2"></script>';
    const result = rewriteLocalResourceLinks(html, "TOKEN123");
    assert.match(result, /src="script\.js\?v=2&token=TOKEN123"/);
  });
});
