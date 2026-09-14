import "server-only";
import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../../db/client.ts";
import { authorizeBudget, type AuthorizeBudgetInput } from "../budget-service.ts";

/**
 * Runs exactly one `authorizeBudget()` call against a real, independently-
 * opened `DatabaseSync` connection, inside a genuine OS-scheduled worker
 * thread — not a same-process, same-connection call, and not merely two
 * sequential calls from the main thread. This is what actually exercises
 * cross-connection SQLite locking under real contention (see
 * `__tests__/budget-service.test.ts`'s "real concurrency" suite, and the
 * Phase 6 correction's status note for why sequential-same-thread calls
 * don't prove this).
 */

const { dbPath, input } = workerData as { dbPath: string; input: AuthorizeBudgetInput };

const db = openDatabase(dbPath);
// The connection — and with it, any SQLite-level lock it might still be
// holding — is closed *before* posting the result back, not after. The
// caller may `terminate()` this worker the instant it receives the
// message; if `close()` happened afterward, that termination could cut
// it off mid-cleanup and leave the lock held for longer than the
// worker's own lifetime.
let message: { ok: true; result: ReturnType<typeof authorizeBudget> } | { ok: false; error: string };
try {
  message = { ok: true, result: authorizeBudget(db, input) };
} catch (error) {
  message = { ok: false, error: (error as Error).message };
} finally {
  db.close();
}
parentPort!.postMessage(message);
