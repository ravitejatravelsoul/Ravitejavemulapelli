import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage, ConversationAction } from "./types.ts";

export interface ConversationScope { ownerId: string; sessionId: string; projectId: string | null; roleId: string }
export interface ConversationRow extends ConversationScope { id: string; messages: string; pending: string | null; updatedAt: number }
const MAX_AGE = 24 * 60 * 60 * 1000;
export function conversation(db: DatabaseSync, scope: ConversationScope, id?: string): ConversationRow {
  db.prepare("DELETE FROM office_conversations WHERE updatedAt < ?").run(Date.now() - MAX_AGE);
  if (id) {
    const row = db.prepare("SELECT * FROM office_conversations WHERE id=?").get(id) as unknown as ConversationRow | undefined;
    if (!row || row.ownerId !== scope.ownerId || row.sessionId !== scope.sessionId || row.projectId !== scope.projectId || row.roleId !== scope.roleId) throw new Error("Conversation unavailable for this context.");
    return row;
  }
  const row = { ...scope, id: randomUUID(), messages: "[]", pending: null, updatedAt: Date.now() };
  db.prepare("INSERT INTO office_conversations (id,ownerId,sessionId,projectId,roleId,messages,updatedAt) VALUES (?,?,?,?,?,?,?)").run(row.id,row.ownerId,row.sessionId,row.projectId,row.roleId,row.messages,row.updatedAt);
  // Bound retained conversations as well as per-conversation history.
  db.prepare("DELETE FROM office_conversations WHERE ownerId=? AND id NOT IN (SELECT id FROM office_conversations WHERE ownerId=? ORDER BY updatedAt DESC LIMIT 30)").run(scope.ownerId,scope.ownerId);
  return row;
}
export function boundedHistory(messages: ConversationMessage[]): ConversationMessage[] {
  const result: ConversationMessage[] = []; let chars = 0;
  for (const m of messages.slice(-12).reverse()) {
    const text = m.text.slice(0, 3000);
    if (chars + text.length > 10000) break;
    result.unshift({ role: m.role, text }); chars += text.length;
  }
  return result;
}
export function saveTurn(db: DatabaseSync, row: ConversationRow, text: string, answer: string) {
  const messages = boundedHistory([...JSON.parse(row.messages), { role: "user", text }, { role: "assistant", text: answer }]);
  db.prepare("UPDATE office_conversations SET messages=?, updatedAt=? WHERE id=?").run(JSON.stringify(messages),Date.now(),row.id);
}
export function propose(db: DatabaseSync, row: ConversationRow, action: ConversationAction) {
  const pending = { token: randomUUID(), action, expires: Date.now()+5*60*1000 };
  db.prepare("UPDATE office_conversations SET pending=? WHERE id=?").run(JSON.stringify(pending),row.id);
  return pending;
}
/** Atomic single-use claim: forged or replayed confirmations cannot create projects. */
export function consume(db: DatabaseSync, row: ConversationRow, token: string): ConversationAction | null {
  const pending = row.pending ? JSON.parse(row.pending) : null;
  if (!pending || pending.token !== token || pending.expires < Date.now()) return null;
  const result = db.prepare("UPDATE office_conversations SET pending=NULL WHERE id=? AND pending=?").run(row.id,row.pending);
  return result.changes === 1 ? pending.action : null;
}
