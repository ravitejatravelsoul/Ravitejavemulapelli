import 'server-only';
import type { DatabaseSync } from 'node:sqlite';
import type { OfficeFloorView } from './office-floor-data.ts';
import { listTasksForProject,listTaskDependencies,listTaskAttempts,getAgentRun } from '../domain/tasks.ts';
import { listApprovalsForProject } from '../domain/project-outputs.ts';
import { listRecentIncidents,listOpenIncidents } from '../domain/office-incidents.ts';
import { getWorkspace } from '../domain/workspace.ts';
import { listAiUsageForProject } from '../domain/budget.ts';
import { computeOfficeHealthStatus } from '../engineer/office-engineer.ts';
import { describeEvent } from './dashboard-data.ts';
import type { MessageEventRow } from '../domain/events.ts';
import { mapAgentVisualState,isActiveVisualState } from './office-visual-state.ts';
import { deriveOfficeTransitions,type OfficeInteractionView } from './office-transitions.ts';
/** Explicit allowlist, never serialize event payloads, prompts, run outputs or diagnoses. */
export function getOfficeInteractionView(db:DatabaseSync,floor:OfficeFloorView,now=Date.now()):OfficeInteractionView|undefined {
 const project=floor.selectedProject;if(!project)return;
 const tasks=listTasksForProject(db,project.id);
 const nodes=tasks.map(t=>({...t,dependsOn:listTaskDependencies(db,t.id).map(d=>d.dependsOnTaskId)}));
 const runs=tasks.flatMap(t=>listTaskAttempts(db,t.id).flatMap(a=>{const r=a.agentRunId?getAgentRun(db,a.agentRunId):undefined;return r?[{id:r.id,taskId:t.id,attempt:a.attemptNumber,startedAt:r.startedAt,finishedAt:r.finishedAt,status:r.status}]:[];}));
 const events=db.prepare('SELECT * FROM messages_events WHERE projectId=? ORDER BY occurredAt DESC LIMIT 150').all(project.id) as unknown as MessageEventRow[];
 const approvals=listApprovalsForProject(db,project.id);
 const incidents=listRecentIncidents(db,50).filter(i=>!i.projectId||i.projectId===project.id);
 const openIncidents=listOpenIncidents(db);
 const symptomLabels:Record<string,string>={'runner-offline':'Runner offline','task-blocked':'Task blocked','semantic-repair-required':'Semantic repair requires owner review'};
 const engineerDetail=openIncidents.length?(symptomLabels[openIncidents[0].symptom]??'Recorded infrastructure incident'):null;
 const workspace=getWorkspace(db,project.id);
 const verifiedDelivery=workspace?.deliveryState==='VERIFIED' && ['READY_FOR_REVIEW','APPROVED'].includes(project.status) && tasks.length>0 && tasks.every(t=>t.status==='DONE');
 const remediations=events.filter(e=>e.type==='agent_run.failed').flatMap(e=>{try{const p=JSON.parse(e.payload);return typeof p.taskId==='string' && Array.isArray(p.remediationTargetTaskIds)?[{id:e.id,taskId:p.taskId,targets:p.remediationTargetTaskIds.filter((id:unknown)=>typeof id==='string'),attempt:Number(p.attemptNumber)||0,occurredAt:e.occurredAt}]:[];}catch{return [];}});
 const transitions=deriveOfficeTransitions({projectId:project.id,verifiedDelivery,tasks:nodes,runs,remediations,approvals,incidents});
 const usage=listAiUsageForProject(db,project.id);
 const planned=events.find(e=>e.type==='project.planned');
 const allowed=new Set(['project.planned','task.started','task.completed','task.assigned','agent_run.succeeded','approval.approved','approval.rejected']);
 return {projectId:project.id,title:project.title,transitions,approvals:approvals.filter(a=>a.status==='PENDING').length,engineer:computeOfficeHealthStatus(db),engineerDetail,incidentCount:openIncidents.length,verifiedDelivery,
 nodes:nodes.map(t=>({id:t.id,roleId:t.roleId,title:t.title,dependsOn:t.dependsOn,state:t.status==='DONE'?'DONE':mapAgentVisualState({roleId:t.roleId,task:t,projectStatus:project.status,dependenciesSatisfied:t.dependsOn.every(id=>tasks.some(d=>d.id===id&&d.status==='DONE')),pendingApproval:approvals.some(a=>a.status==='PENDING')&&['PENDING','ASSIGNED'].includes(t.status),now})})),
 activeModels:floor.agents.filter(a=>isActiveVisualState(a.status)&&a.provider).map(a=>({roleId:a.roleId,provider:a.provider!,model:a.model??null})),
 costUsd:usage.reduce((n,u)=>n+u.costUsd,0),deliveryState:workspace?.deliveryState??'NOT_STARTED',modelsUsed:new Set(usage.flatMap(u=>{const r=getAgentRun(db,u.agentRunId);return r?.model?[r.provider+':'+r.model]:[];})).size,plannedAt:planned?.occurredAt??null,plannedEventId:planned?.id??null,
 feed:events.filter(e=>allowed.has(e.type)).slice(0,12).map(e=>({id:e.id,occurredAt:e.occurredAt,message:e.type==='agent_run.succeeded'?`${e.actor} completed a recorded run`:describeEvent(db,e).slice(0,220),roleId:tasks.some(t=>t.roleId===e.actor)?e.actor:null}))};
}
