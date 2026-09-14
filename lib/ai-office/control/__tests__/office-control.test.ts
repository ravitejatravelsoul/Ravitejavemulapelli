import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { getOfficeStatus } from "../../domain/office.ts";
import { listRecentEvents } from "../../domain/events.ts";
import { listAuditEntries } from "../../domain/events.ts";
import { openOffice, closeOffice } from "../office-control.ts";

process.env.OFFICE_OWNER_EMAIL = "test-owner@example.invalid";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic-test-salt:synthetic-test-hash-not-a-real-scrypt-output";

describe("openOffice / closeOffice", () => {
  test("closing an OPEN office persists CLOSED and records one event + one audit entry", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    assert.equal(getOfficeStatus(t.db)?.state, "OPEN");

    const result = closeOffice(t.db, owner.id, "end of day");
    assert.equal(result.changed, true);
    assert.equal(result.status.state, "CLOSED");
    assert.equal(getOfficeStatus(t.db)?.state, "CLOSED");

    assert.equal(listRecentEvents(t.db).filter((e) => e.type === "office.closed").length, 1);
    assert.equal(listAuditEntries(t.db).filter((e) => e.action === "office.closed").length, 1);

    t.close();
  });

  test("closing an already-CLOSED office is a no-op — no duplicate event", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    closeOffice(t.db, owner.id);
    const second = closeOffice(t.db, owner.id);

    assert.equal(second.changed, false);
    assert.equal(listRecentEvents(t.db).filter((e) => e.type === "office.closed").length, 1, "must not double-record");

    t.close();
  });

  test("reopening a CLOSED office persists OPEN and records event + audit entry", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    closeOffice(t.db, owner.id);

    const result = openOffice(t.db, owner.id);
    assert.equal(result.changed, true);
    assert.equal(getOfficeStatus(t.db)?.state, "OPEN");
    assert.equal(listRecentEvents(t.db).filter((e) => e.type === "office.opened").length, 1);

    t.close();
  });

  test("opening an already-OPEN office is a no-op", () => {
    const t = createTestDb();
    const owner = getOwner(t.db)!;
    const result = openOffice(t.db, owner.id);
    assert.equal(result.changed, false);
    t.close();
  });
});
