import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { ConversationAction } from "./types.ts";
import { pauseProject,resumeProject } from "../control/project-transitions.ts";
import { approveApproval,rejectApproval } from "../approvals/approval-service.ts";
import { getApproval } from "../domain/project-outputs.ts";
import { recordEvent } from "../domain/events.ts";
/** Runs within the existing remote optimistic mutation boundary. The nonce and
 * transition are persisted in the same project bundle, so retries/replays cannot
 * reapply a previously confirmed command after the project's state changes. */
export function confirmedRemoteTransition(db:DatabaseSync,action:ConversationAction,token:string) {
  if(action.kind==="CREATE_PROJECT")return {ok:false as const,error:"Real free-model creation is local-only."};
  if(db.prepare("SELECT id FROM messages_events WHERE projectId=? AND type='conversation.confirmed' AND json_extract(payload,'$.token')=?").get(action.projectId,token))return {ok:false as const,error:"Confirmation already used."};
  const owner="remote-owner";
  let result:{ok:boolean;reason?:string};
  if(action.kind==="PAUSE")result=pauseProject(db,action.projectId,owner);
  else if(action.kind==="RESUME")result=resumeProject(db,action.projectId,owner);
  else if(action.kind==="APPROVE" || action.kind==="REJECT") {
    if(getApproval(db,action.approvalId)?.projectId!==action.projectId)return {ok:false as const,error:"Approval context mismatch."};
    result=(action.kind==="APPROVE"?approveApproval:rejectApproval)(db,{approvalId:action.approvalId,decidedByUserId:owner,note:"Confirmed in Headquarters conversation."});
  } else return {ok:false as const,error:"Unknown action."};
  if(!result.ok)return {ok:false as const,error:result.reason??"Action unavailable."};
  recordEvent(db,{projectId:action.projectId,type:"conversation.confirmed",actor:owner,payload:{token,kind:action.kind}});
  return {ok:true as const,value:undefined};
}
