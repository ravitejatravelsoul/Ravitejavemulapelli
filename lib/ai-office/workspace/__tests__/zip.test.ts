import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { createZip } from "../zip.ts";

/**
 * A minimal, pure-JS ZIP *reader* — just enough of the central directory
 * format to round-trip what `createZip` produces, so this test doesn't
 * depend on an external unzip tool being installed. Real-world
 * compatibility (a genuinely valid ZIP any OS can open) was separately
 * confirmed by hand against Windows' own `Expand-Archive` — this test
 * proves the invariant that matters for CI: what goes in comes back out
 * byte-for-byte, for both the STORE and DEFLATE code paths.
 */
function readZipEntries(buf: Buffer): Array<{ path: string; content: Buffer }> {
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, "no end-of-central-directory record found");
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: Array<{ path: string; content: Buffer }> = [];
  let ptr = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    assert.equal(buf.readUInt32LE(ptr), 0x02014b50, "central directory signature mismatch");
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawData = buf.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(rawData) : Buffer.from(rawData);
    assert.equal(content.length, uncompressedSize, `size mismatch for ${name}`);

    entries.push({ path: name, content });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

describe("createZip", () => {
  test("round-trips small text files exactly (exercises STORE for tiny/incompressible content)", () => {
    const files = [
      { path: "index.html", content: "<html></html>" },
      { path: "style.css", content: "" },
    ];
    const zip = createZip(files);
    const entries = readZipEntries(zip);
    assert.equal(entries.length, 2);
    assert.equal(entries.find((e) => e.path === "index.html")?.content.toString("utf8"), "<html></html>");
    assert.equal(entries.find((e) => e.path === "style.css")?.content.toString("utf8"), "");
  });

  test("round-trips larger, compressible content exactly (exercises the DEFLATE branch)", () => {
    const repeated = "console.log('hi');".repeat(200);
    const zip = createZip([{ path: "script.js", content: repeated }]);
    const entries = readZipEntries(zip);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content.toString("utf8"), repeated);
  });

  test("preserves nested relative paths and normalizes backslashes to forward slashes", () => {
    const zip = createZip([{ path: "src\\components\\App.js", content: "export default function App() {}" }]);
    const entries = readZipEntries(zip);
    assert.equal(entries[0].path, "src/components/App.js");
  });

  test("produces a well-formed archive for zero files", () => {
    const zip = createZip([]);
    const entries = readZipEntries(zip);
    assert.equal(entries.length, 0);
  });

  test("accepts real Buffer content, not just strings", () => {
    const buf = Buffer.from([0, 1, 2, 3, 255, 254]);
    const zip = createZip([{ path: "data.bin", content: buf }]);
    const entries = readZipEntries(zip);
    assert.deepEqual(entries[0].content, buf);
  });
});
