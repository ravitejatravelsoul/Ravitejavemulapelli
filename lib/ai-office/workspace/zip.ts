import "server-only";
import { deflateRawSync, crc32 } from "node:zlib";

/**
 * A minimal, dependency-free ZIP writer — Node has no built-in ZIP
 * container format (only raw DEFLATE via `zlib`), and this codebase's
 * established pattern (see `playwright`'s docblock in package.json —
 * added only once the brief explicitly required real browser QA) is to
 * avoid a new dependency for something this bounded and well-specified.
 * Implements just enough of APPNOTE.TXT to produce a real, standard ZIP
 * any unzip tool can open: a local file header + DEFLATE (or STORE, for
 * incompressible/empty data) data per entry, a central directory, and an
 * end-of-central-directory record. No ZIP64, no encryption, no
 * directory-entry records — the deliverable workspaces this serves are
 * always small, flat file sets (see MAX_WORKSPACE_SIZE_BYTES).
 */

interface ZipEntry {
  path: string;
  content: Buffer;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const DEFLATE_METHOD = 8;
const STORE_METHOD = 0;

/** DOS date/time — ZIP's native timestamp format. A fixed, deterministic value (rather than `Date.now()`) so a ZIP of the same workspace content is byte-identical on every download, which is a genuinely useful property for the owner (and for a regression test asserting exact output). */
const DOS_TIME = 0;
const DOS_DATE = (1 << 9) | (1 << 5) | 1; // 1980-01-01 — the ZIP epoch's earliest representable date

function utf8(path: string): Buffer {
  return Buffer.from(path, "utf8");
}

export function createZip(files: Array<{ path: string; content: Buffer | string }>): Buffer {
  const entries: ZipEntry[] = files.map((f) => ({ path: f.path.replace(/\\/g, "/"), content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, "utf8") }));

  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = utf8(entry.path);
    const crc = crc32(entry.content) >>> 0;
    const deflated = entry.content.length > 0 ? deflateRawSync(entry.content) : Buffer.alloc(0);
    const useDeflate = deflated.length < entry.content.length;
    const data = useDeflate ? deflated : entry.content;
    const method = useDeflate ? DEFLATE_METHOD : STORE_METHOD;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localChunks.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralDirSize = centralChunks.reduce((sum, c) => sum + c.length, 0);
  const centralDirOffset = offset;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  endRecord.writeUInt16LE(0, 4); // disk number
  endRecord.writeUInt16LE(0, 6); // disk with central dir
  endRecord.writeUInt16LE(entries.length, 8); // entries on this disk
  endRecord.writeUInt16LE(entries.length, 10); // total entries
  endRecord.writeUInt32LE(centralDirSize, 12);
  endRecord.writeUInt32LE(centralDirOffset, 16);
  endRecord.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, ...centralChunks, endRecord]);
}
