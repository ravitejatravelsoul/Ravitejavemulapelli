import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getProject } from "../domain/projects.ts";
import { getAgentRole } from "../domain/agent-roles.ts";
import { listTasksForProject } from "../domain/tasks.ts";
import { listArtifactsForProject, listTestResultsForTask } from "../domain/project-outputs.ts";
import { buildTaskContext } from "../agents/context-builder.ts";
import { getAIHeadquartersWorldState, safeWorldText } from "../headquarters/world-state.ts";
import { agentBriefing } from "../headquarters/presentation.ts";
import { classifyConversation } from "./intent.ts";
import { selectRoles } from "../orchestrator/role-selection.ts";
import { conversation, saveTurn, propose, type ConversationScope } from "./memory.ts";
import { answerWithFreeModel, conversationCapability, conversationInput } from "./model.ts";
import type { ConversationReply, ConversationAction } from "./types.ts";

export function authorizeConversation(db: DatabaseSync, scope: ConversationScope, mode: "local" | "remote") {
  if (!scope.ownerId || !scope.sessionId) throw new Error("Sign in to talk to the Office.");
  if (!getAgentRole(db,scope.roleId) && scope.roleId !== "office-engineer") throw new Error("Unknown agent.");
  if (scope.projectId) {
    const p=getProject(db,scope.projectId);
    if(!p || p.ownerId !== (mode === "remote" ? "remote-owner" : scope.ownerId)) throw new Error("Project unavailable.");
  }
}
export async function contextualEvidence(db: DatabaseSync, scope: ConversationScope) {
  if(!scope.projectId) return {note:"No project selected. Do not infer project details."};
  const role=getAgentRole(db,scope.roleId);
  const tasks=listTasksForProject(db,scope.projectId);
  const task=tasks.filter(t=>t.roleId===scope.roleId).at(-1);
  if(!role || !task) return {note:"This role has no assigned task in this project.",tasks:tasks.map(t=>({role:t.roleId,title:safeWorldText(t.title),status:t.status}))};
  const context=await buildTaskContext(db,task,role);
  return {
    task:{title:safeWorldText(task.title),status:task.status},
    requirements:safeWorldText(context.authoritativeUserRequest,2000),
    artifacts:context.relevantArtifacts.slice(-4).map(a=>({type:a.type,content:safeWorldText(a.content,1800)})),
    ownArtifacts:listArtifactsForProject(db,scope.projectId).filter(a=>a.taskId===task.id).slice(-2).map(a=>({type:a.type,content:safeWorldText(a.content,1800)})),
    decisions:context.relevantDecisions.slice(-4).map(d=>({type:d.type,summary:safeWorldText(d.summary,350)})),
    files:(context.relevantFiles??[]).slice(0,3).map(f=>({path:safeWorldText(f.path),content:safeWorldText(f.content,1600)})),
    tests:listTestResultsForTask(db,task.id).slice(-3).map(t=>({status:t.status,summary:safeWorldText(t.summary,500)})),
  };
}

export async function converse(db:DatabaseSync, scope:ConversationScope, input:{text:string;conversationId?:string;mode:"local"|"remote"}, options:{fetchImpl?:typeof fetch}={}):Promise<ConversationReply> {
  authorizeConversation(db,scope,input.mode);
  if(!input.text.trim() || input.text.length>4000) throw new Error("Use between 1 and 4000 characters.");
  const text=safeWorldText(input.text,4000), q=text.toLowerCase();
  const row=conversation(db,scope,input.conversationId);
  // New requests invalidate an earlier action proposal, avoiding ambiguous "yes".
  db.prepare("UPDATE office_conversations SET pending=NULL WHERE id=?").run(row.id);
  const state=getAIHeadquartersWorldState(db,scope.projectId??undefined,input.mode);
  const intent=classifyConversation(text);
  const reply:ConversationReply={message:"",intent,conversationId:row.id,revision:state.revision,source:"state"};
  const project=scope.projectId ? state.project : null;
  const agent=state.agents.find(a=>a.roleId===scope.roleId);
  const pending=(action:ConversationAction,label:string)=> {
    const p=propose(db,row,action);
    reply.pending={token:p.token,action,label};reply.message=label+" Confirm to proceed.";
  };
  if(intent==="CREATE_PROJECT") {
    const idea=text.replace(/^(?:please )?(?:create|build|start|make)\s+(?:a\s+)?(?:project\s*:?\s*)?/i,"");
    if(idea.length<10) reply.message="Describe the project goal and requirements in a sentence.";
    else {
      // Read-only, deterministic and zero-cost — the same classifier planProject()
      // itself uses, so "expected workflow" in the confirmation is a real
      // preview of what will actually be planned, never a guess.
      const expectedRoles=selectRoles(idea).roles.map(roleId=>getAgentRole(db,roleId)?.name??roleId);
      const summary=[
        `Goal: ${idea}`,
        `Execution mode: ${input.mode==="remote"?"Remote — GitHub Actions runs it in the background; you can close the browser.":"Local — the background runner on this machine executes it."}`,
        `Routing mode: FREE_MULTI_MODEL — each task routes to a currently qualified, healthy free model.`,
        expectedRoles.length?`Expected workflow: ${expectedRoles.join(" → ")}.`:"",
        `Policy: free models only. Claude and paid fallback are disabled.`,
      // " · ", never "\n" — safeWorldText() below strips control characters
      // (including newlines) from every reply, so a literal newline
      // separator would silently collapse into a single space anyway.
      ].filter(Boolean).join(" · ");
      pending({kind:"CREATE_PROJECT",title:idea.slice(0,80),idea,mode:input.mode},summary);
    }
  } else if(intent==="PROJECT_CONTROL") {
    if(!project) reply.message="Select the project you want to control.";
    else if(/^cancel\b/.test(q)) reply.message="Cancellation is not supported here. No project state changed.";
    else pending({kind:q.includes("resume")?"RESUME":"PAUSE",projectId:project.id},`${q.includes("resume")?"Resume":"Pause"} “${project.title}”`);
  } else if(intent==="APPROVAL_ACTION") {
    const approvals=state.approvals.filter(a=>a.projectId===scope.projectId);
    if(approvals.length!==1 || !project) reply.message="Select a project with exactly one pending approval, or choose the specific approval in Owner Command.";
    else pending({kind:/reject|deny/.test(q)?"REJECT":"APPROVE",approvalId:approvals[0].id,projectId:project.id},`${/reject|deny/.test(q)?"Reject":"Approve"} ${approvals[0].kind} for ${project.title}: ${approvals[0].reason}`);
  } else if(intent==="WORKSPACE_ACTION" || intent==="ARTIFACT_QUERY") {
    if(q.includes("classic")) {reply.navigation={href:"/office/classic"};reply.message="Open Classic Office.";}
    else if(/take me|go to/.test(q)) {
      const target=state.agents.find(a=>q.includes(a.name.toLowerCase()) || (q.includes("architect") && a.roleId==="solution-architect") || (q.includes("developer") && a.roleId==="frontend-developer"));
      reply.navigation=target?{roleId:target.roleId}:undefined;
      reply.message=target?`Open ${target.name}'s station.`:"Choose an agent from the conversation selector.";
    } else if(project) {
      reply.navigation={href:`/office/projects/${encodeURIComponent(project.id)}?tab=${intent==="ARTIFACT_QUERY"?"artifacts":"workspace"}`};
      const artifacts=listArtifactsForProject(db,project.id).filter(a=>!q.includes("qa")||a.type==="test-report");
      reply.message=intent==="ARTIFACT_QUERY"?artifacts.slice(-2).map(a=>`${a.type} (revision ${a.version}): ${safeWorldText(a.content,1500)}`).join("; ")||"No matching artifacts recorded yet.":"Use Workspaces in the Headquarters operations bar to browse the selected project's files here.";
    } else reply.message="Select a project first.";
  } else if(intent==="AGENT_WORK_QUERY") {
    reply.message=project && agent?agentBriefing(agent,state,new Date().getHours()):"Select a project to ask about this agent's work.";
  } else if(intent==="MODEL_QUERY") {
    reply.message=project?state.agents.filter(a=>a.model).map(a=>`${a.name}: ${a.provider} / ${a.model}`).join("; ")||"No model use recorded for this project.":state.models.map(m=>`${m.provider} / ${m.model}: ${m.health}; execution qualified: ${m.qualified}`).join("; ")||"No models registered.";
  } else if(["STATUS_QUERY","PROJECT_QUERY","OFFICE_QUERY"].includes(intent)) {
    if(/approval|needs? (?:me|my)/.test(q)) reply.message=state.approvals.filter(a=>!scope.projectId||a.projectId===scope.projectId).map(a=>`${a.projectTitle}: ${a.kind} — ${a.reason}`).join("; ")||"No pending approvals in this context.";
    else if(/cost|spent|spend|budget/.test(q)) reply.message=project?`${project.title}: recorded project AI cost $${project.costUsd.toFixed(4)}.`:`Recorded office spend $${state.budget.spendUsd.toFixed(4)}; remaining budget $${state.budget.remainingUsd.toFixed(4)}.`;
    else if(/qa.*pass/.test(q)) {
      const qa=scope.projectId?listTasksForProject(db,scope.projectId).filter(t=>t.roleId==="qa-agent"):[];
      reply.message=qa.map(t=>{const last=listTestResultsForTask(db,t.id).at(-1);return `${t.title}: ${t.status}. Latest recorded QA result: ${last?last.status+" — "+safeWorldText(last.summary,500):"not recorded"}.`;}).join(" ")||"No QA task recorded in the selected project.";
    } else if(/blocked/.test(q)) reply.message=state.agents.filter(a=>a.status==="BLOCKED").map(a=>`${a.name}: ${a.blocker}`).join("; ")||"No blocked agents in the selected project snapshot.";
    else if(/away|overnight/.test(q)) reply.message=project?`${project.title}: ${project.completed}/${project.total} tasks complete; delivery ${project.deliveryState}. Recent persisted events: ${state.events.slice(0,8).map(e=>`${new Date(e.at).toISOString()} ${e.message}`).join("; ")||"none"}.`:"Select a project for its persisted activity summary.";
    else reply.message=project?`${project.title}: ${project.label}; ${project.completed}/${project.total} tasks complete. Delivery: ${project.deliveryState}. ${state.agents.filter(a=>["WORKING","TESTING","REVIEWING","THINKING"].includes(a.status)).map(a=>`${a.name}: ${a.status} — ${a.task??"coordination"}`).join("; ")}`:`Office is ${state.office.state}; ${state.office.activeProjects} active projects. Runner: ${state.office.runner}.`;
  } else if(intent==="UNKNOWN") reply.message="Please type or speak a question.";
  else {
    const evidence=await contextualEvidence(db,scope);
    const prompt=JSON.stringify({role:scope.roleId,project,question:text,history:JSON.parse(row.messages),evidence});
    if(prompt.length>24000) {reply.source="unavailable";reply.message="This context is too large. Start a new conversation or ask about a narrower part of the project.";}
    else {
      const answer=await answerWithFreeModel(db,conversationInput(scope.roleId,prompt),conversationCapability(intent,scope.roleId),{...options,projectId:scope.projectId});
      if(answer) Object.assign(reply,answer,{source:"model"});
      else {reply.source="unavailable";reply.message="I'm temporarily unable to reach a qualified free model for this question. Your Office state is safe. Status questions still work; try reasoning again shortly.";}
    }
  }
  reply.message=safeWorldText(reply.message,4000);
  saveTurn(db,row,text,reply.message);
  return reply;
}
