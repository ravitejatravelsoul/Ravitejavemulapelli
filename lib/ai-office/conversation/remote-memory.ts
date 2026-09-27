import "server-only";
import { createHash } from "node:crypto";
import { CompactEncrypt, compactDecrypt } from "jose";
import type { DatabaseSync } from "node:sqlite";
import { conversation, type ConversationRow, type ConversationScope } from "./memory.ts";

function key() {
  const secret=process.env.OFFICE_SESSION_SECRET;
  if(!secret || Buffer.byteLength(secret)<32) throw new Error("Session configuration unavailable");
  return createHash("sha256").update("office-conversation-v1\0"+secret).digest();
}
/** Remote dashboards are ephemeral. Carry only bounded sanitized conversation
 * memory in an authenticated encrypted envelope, tied to this exact login and
 * context. Never put it in a URL, GitHub project bundle, or model prompt. */
export async function sealMemory(db:DatabaseSync,scope:ConversationScope,id:string) {
  const row=conversation(db,scope,id);
  return new CompactEncrypt(Buffer.from(JSON.stringify(row))).setProtectedHeader({alg:"dir",enc:"A256GCM"}).encrypt(key());
}
export async function restoreMemory(db:DatabaseSync,scope:ConversationScope,id:string,token:string) {
  if(token.length>40000)throw new Error("Memory too large");
  const {plaintext}=await compactDecrypt(token,key());
  const row=JSON.parse(Buffer.from(plaintext).toString("utf8")) as ConversationRow;
  if(row.id!==id || row.ownerId!==scope.ownerId || row.sessionId!==scope.sessionId || row.projectId!==scope.projectId || row.roleId!==scope.roleId || row.updatedAt<Date.now()-86400000)throw new Error("Memory context mismatch");
  db.prepare("INSERT INTO office_conversations(id,ownerId,sessionId,projectId,roleId,messages,pending,updatedAt) VALUES (?,?,?,?,?,?,?,?)").run(row.id,row.ownerId,row.sessionId,row.projectId,row.roleId,row.messages,row.pending,row.updatedAt);
}
