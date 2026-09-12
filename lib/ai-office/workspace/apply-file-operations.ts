import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { writeFile, deleteFile, resolveSafePath, MAX_WORKSPACE_SIZE_BYTES, MAX_FILE_SIZE_BYTES } from "./workspace-service.ts";
import { getOrCreateWorkspace, upsertWorkspaceFileRecord, deleteWorkspaceFileRecord, listWorkspaceFileRecords } from "../domain/workspace.ts";
import type { FileOperationPayload } from "../providers/types.ts";

/**
 * The only place a `StructuredAgentOutput.fileOperations` batch is ever
 * turned into a real filesystem change — called from
 * lib/ai-office/agents/agent-runner.ts, never from a provider adapter
 * directly (the same "no provider adapter touches the filesystem"
 * boundary that already keeps adapters from importing `node:fs`).
 *
 * Validate-everything-then-apply-everything: every operation's path and
 * (for the whole batch together) the resulting workspace size are
 * checked *before* any real write or delete happens, so a single
 * invalid operation in a batch never leaves a half-applied workspace.
 * True filesystem transactionality doesn't exist, so this is "validate
 * first to make the common failure modes (bad path, oversized batch)
 * fail atomically," not an absolute guarantee against every possible
 * mid-batch I/O error — `workspace-service.ts`'s own per-write checks
 * remain the final, authoritative backstop either way.
 */

export class FileOperationValidationError extends Error {}

function assertHasContentForWrite(operations: FileOperationPayload[]): void {
  for (const op of operations) {
    if (op.action === "write" && op.content === undefined) {
      throw new FileOperationValidationError(`A "write" operation for "${op.path}" is missing its content.`);
    }
  }
}

/** Every path safe, every individual write within the per-file cap, and the whole batch's net effect on the workspace's total size within its cap — computed from the existing `workspace_files` manifest, not a fresh filesystem walk. */
function validateBatch(db: DatabaseSync, projectId: string, operations: FileOperationPayload[]): void {
  const existingSizes = new Map(listWorkspaceFileRecords(db, projectId).map((r) => [r.path, r.sizeBytes]));
  let projectedTotal = [...existingSizes.values()].reduce((sum, size) => sum + size, 0);

  for (const op of operations) {
    resolveSafePath(projectId, op.path); // throws WorkspacePathError on anything unsafe

    const previousSize = existingSizes.get(op.path) ?? 0;
    if (op.action === "write") {
      const byteSize = Buffer.byteLength(op.content!, "utf8");
      if (byteSize > MAX_FILE_SIZE_BYTES) {
        throw new FileOperationValidationError(`"${op.path}" is ${byteSize} bytes, exceeding the ${MAX_FILE_SIZE_BYTES}-byte per-file limit.`);
      }
      projectedTotal = projectedTotal - previousSize + byteSize;
      existingSizes.set(op.path, byteSize);
    } else {
      projectedTotal -= previousSize;
      existingSizes.delete(op.path);
    }
  }

  if (projectedTotal > MAX_WORKSPACE_SIZE_BYTES) {
    throw new FileOperationValidationError(
      `This batch would bring the workspace to ${projectedTotal} bytes, exceeding the ${MAX_WORKSPACE_SIZE_BYTES}-byte workspace limit.`,
    );
  }
}

export interface ApplyFileOperationsInput {
  projectId: string;
  taskId: string;
  roleId: string;
  operations: FileOperationPayload[];
}

export interface ApplyFileOperationsResult {
  appliedPaths: string[];
}

export async function applyFileOperations(db: DatabaseSync, input: ApplyFileOperationsInput): Promise<ApplyFileOperationsResult> {
  if (input.operations.length === 0) return { appliedPaths: [] };

  assertHasContentForWrite(input.operations);
  validateBatch(db, input.projectId, input.operations);

  getOrCreateWorkspace(db, input.projectId);

  const appliedPaths: string[] = [];
  for (const op of input.operations) {
    if (op.action === "write") {
      await writeFile(input.projectId, op.path, op.content!);
      upsertWorkspaceFileRecord(db, {
        projectId: input.projectId,
        path: op.path,
        sizeBytes: Buffer.byteLength(op.content!, "utf8"),
        roleId: input.roleId,
        taskId: input.taskId,
      });
    } else {
      await deleteFile(input.projectId, op.path);
      deleteWorkspaceFileRecord(db, input.projectId, op.path);
    }
    appliedPaths.push(op.path);
  }

  return { appliedPaths };
}
