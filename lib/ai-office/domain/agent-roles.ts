import "server-only";
import type { DatabaseSync } from "node:sqlite";

/**
 * agent_roles read repository. The catalog itself is seeded by
 * lib/ai-office/db/seed.ts from lib/ai-office/domain/agent-role-catalog.ts
 * — this file only queries, it never writes (the catalog is "static,
 * seeded, not user-editable at runtime" per
 * docs/ai-office/04-agent-architecture.md §1).
 */

export interface AgentRoleRow {
  id: string;
  name: string;
  responsibilities: string; // JSON array, stored as TEXT
  allowedInputs: string; // JSON array
  allowedOutputs: string; // JSON array
  permittedActions: string; // JSON array
  maxRetries: number;
  escalatesTo: "orchestrator" | "owner";
  createdAt: number;
  updatedAt: number;
}

export function listAgentRoles(db: DatabaseSync): AgentRoleRow[] {
  return db.prepare("SELECT * FROM agent_roles ORDER BY id").all() as unknown as AgentRoleRow[];
}

export function getAgentRole(db: DatabaseSync, id: string): AgentRoleRow | undefined {
  return db.prepare("SELECT * FROM agent_roles WHERE id = ?").get(id) as unknown as AgentRoleRow | undefined;
}

export function countAgentRoles(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM agent_roles").get() as { count: number };
  return row.count;
}
