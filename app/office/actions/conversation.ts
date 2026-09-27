"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { verifySession } from "@/lib/ai-office/auth/dal";
import { getOfficeDb } from "@/lib/ai-office/office-db";
import { getOwner } from "@/lib/ai-office/domain/users";
import { isRemoteExecutionMode } from "@/lib/ai-office/remote/execution-mode";
import { converse, authorizeConversation } from "@/lib/ai-office/conversation/orchestrator";
import { conversation, consume } from "@/lib/ai-office/conversation/memory";
import { createProjectAction, pauseProjectAction, resumeProjectAction } from "./projects";
import { approveApprovalAction, rejectApprovalAction } from "./approvals";
import { sealMemory, restoreMemory } from "@/lib/ai-office/conversation/remote-memory";
import { confirmedRemoteTransition } from "@/lib/ai-office/conversation/remote-actions";
import { withRemoteProjectMutation } from "@/lib/ai-office/remote/remote-state-store";

const requestSchema=z.object({text:z.string().trim().min(1).max(4000),roleId:z.string().max(80),projectId:z.string().uuid().nullable(),conversationId:z.string().uuid().optional(),memoryToken:z.string().max(40000).optional()});
export async function conversationWorkspaceAction(projectId:unknown) {
  const id=z.string().uuid().safeParse(projectId);if(!id.success)return {files:[]};
  try {
    const {db}=await context("orchestrator",id.data);
    const {listWorkspaceFileRecords}=await import("@/lib/ai-office/domain/workspace");
    const {readOfficeWorkspaceFile}=await import("@/lib/ai-office/office-workspace-read");
    const {highlightFileContent}=await import("@/lib/ai-office/workspace/code-highlight");
    const {safeWorldText}=await import("@/lib/ai-office/headquarters/world-state");
    const records=listWorkspaceFileRecords(db,id.data).filter(f=>/\.(html|css|js|ts|tsx|json|md)$/.test(f.path)&&!/(^|\/)(\.|node_modules)|secret|credential/i.test(f.path)).slice(0,8);
    const files=await Promise.all(records.map(async f=>{const content=(await readOfficeWorkspaceFile(id.data,f.path))?.slice(0,24000)??"File content is unavailable.";const clean=content.split("\n").map(line=>safeWorldText(line,24000)).join("\n");return {path:f.path,sizeBytes:f.sizeBytes,lastModifiedByRoleId:f.lastModifiedByRoleId,html:await highlightFileContent(f.path,clean)};}));
    return {files};
  }catch{return {files:[]};}
}
export async function conversationOptionsAction() {
  const session=await verifySession();
  if(!session)return {projects:[],agents:[]};
  const {getAIHeadquartersWorldState}=await import("@/lib/ai-office/headquarters/world-state");
  const db=await getOfficeDb();
  if(!isRemoteExecutionMode() && getOwner(db)?.email!==session.userId)return {projects:[],agents:[]};
  const state=getAIHeadquartersWorldState(db);
  return {projects:state.projects,agents:state.agents.map(a=>({id:a.roleId,name:a.name}))};
}
async function context(roleId:string,projectId:string|null) {
  const session=await verifySession();
  if(!session) throw new Error("You must be signed in.");
  const mode=isRemoteExecutionMode()?"remote":"local";
  const db=await getOfficeDb();
  const owner=getOwner(db);
  if(mode==="local" && owner?.email!==session.userId) throw new Error("Owner access required.");
  const cookie=(await cookies()).get("office_session")?.value;
  if(!cookie) throw new Error("You must be signed in.");
  const scope={ownerId:mode==="local"?owner!.id:session.userId,sessionId:createHash("sha256").update(cookie).digest("hex"),roleId,projectId};
  authorizeConversation(db,scope,mode);
  return {db,scope,mode} as const;
}
export async function sendConversationAction(raw:unknown) {
  const parsed=requestSchema.safeParse(raw);
  if(!parsed.success) return {error:"Invalid conversation request."};
  try {
    const ctx=await context(parsed.data.roleId,parsed.data.projectId);
    if(ctx.mode==="remote" && parsed.data.conversationId) {
      if(!parsed.data.memoryToken) return {error:"Start a new conversation."};
      await restoreMemory(ctx.db,ctx.scope,parsed.data.conversationId,parsed.data.memoryToken);
    }
    const reply=await converse(ctx.db,ctx.scope,{...parsed.data,mode:ctx.mode});
    if(ctx.mode==="remote")reply.memoryToken=await sealMemory(ctx.db,ctx.scope,reply.conversationId);
    return {reply};
  } catch {return {error:"Conversation unavailable. Check your session and project selection, then try again."};}
}
export async function clearConversationAction(raw:unknown) {
  const parsed=requestSchema.omit({text:true}).safeParse(raw);
  if(!parsed.success) return {error:"Invalid conversation."};
  try {
    const {db,scope,mode}=await context(parsed.data.roleId,parsed.data.projectId);
    if(mode==="remote")return {ok:true};
    if(parsed.data.conversationId) {
      const row=conversation(db,scope,parsed.data.conversationId);
      db.prepare("DELETE FROM office_conversations WHERE id=?").run(row.id);
    }
    return {ok:true};
  } catch {return {error:"Conversation unavailable."};}
}
export async function confirmConversationAction(raw:unknown):Promise<{error?:string;projectId?:string}> {
  const parsed=requestSchema.omit({text:true}).extend({conversationId:z.string().uuid(),token:z.string().uuid()}).safeParse(raw);
  if(!parsed.success) return {error:"Invalid confirmation."};
  try {
    const {db,scope,mode}=await context(parsed.data.roleId,parsed.data.projectId);
    if(mode==="remote") {
      if(!parsed.data.memoryToken)return {error:"Confirmation unavailable."};
      await restoreMemory(db,scope,parsed.data.conversationId,parsed.data.memoryToken);
    }
    const row=conversation(db,scope,parsed.data.conversationId);
    const action=consume(db,row,parsed.data.token);
    if(!action) return {error:"Confirmation expired or already used. Ask again."};
    if(action.kind==="CREATE_PROJECT") {
      if(mode!=="local")return {error:"Real free-model creation is local-only."};
      const form=new FormData();form.set("title",action.title);form.set("ideaText",action.idea);form.set("routingMode","FREE_MULTI_MODEL");form.set("aiPolicyMode","LOCAL_ONLY");form.set("provider","simulated");
      return await createProjectAction(undefined,form,true);
    }
    if(action.projectId!==scope.projectId) return {error:"Project context changed. Ask again."};
    if(mode==="remote") {
      const result=await withRemoteProjectMutation(action.projectId,db=>confirmedRemoteTransition(db,action,parsed.data.token),{dispatchContinue:action.kind==="RESUME"});
      return result.ok?{}:{error:result.error};
    }
    if(action.kind==="PAUSE") return await pauseProjectAction(action.projectId);
    if(action.kind==="RESUME") return await resumeProjectAction(action.projectId);
    if(action.kind==="APPROVE") return await approveApprovalAction(action.approvalId,action.projectId);
    if(action.kind==="REJECT") return await rejectApprovalAction(action.approvalId,action.projectId);
    return {error:"Unsupported action."};
  } catch {return {error:"The action could not be completed. Refresh Office state before trying again."};}
}
