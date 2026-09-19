import type { OfficeAgentVisualStatus } from './office-visual-state.ts';
export type TransitionKind = 'HANDOFF' | 'REMEDIATION' | 'APPROVAL_REQUEST' | 'APPROVAL_RESUME' | 'INCIDENT' | 'RECOVERY' | 'DELIVERY';
export interface OfficeTransition {
  id: string; projectId: string; taskId: string | null; attempt: number;
  fromRole: string; toRole: string; type: TransitionKind; occurredAt: number;
  evidenceId: string; status: string; label: string;
}
export interface OfficeInteractionView {
  projectId: string; transitions: OfficeTransition[];
  approvals: number; engineer: string; engineerDetail: string|null; incidentCount: number; verifiedDelivery: boolean;
  nodes: Array<{id:string;roleId:string;title:string;state:OfficeAgentVisualStatus;dependsOn:string[]}>;
  activeModels: Array<{roleId:string;provider:string;model:string|null}>;
  costUsd: number; deliveryState: string; modelsUsed: number;
  plannedAt: number | null; plannedEventId: string | null; title: string;
  feed: Array<{id:string;occurredAt:number;message:string;roleId:string|null}>;
}
export interface TransitionEvidence {
  projectId: string; verifiedDelivery: boolean;
  tasks: Array<{id:string;roleId:string;dependsOn:string[]}>;
  runs: Array<{id:string;taskId:string;attempt:number;startedAt:number;finishedAt:number|null;status:string}>;
  remediations: Array<{id:string;taskId:string;targets:string[];attempt:number;occurredAt:number}>;
  approvals: Array<{id:string;taskId:string|null;requestedBy:string;status:string;createdAt:number;decidedAt:number|null}>;
  incidents: Array<{id:string;taskId:string|null;status:string;detectedAt:number;resolvedAt:number|null}>;
}
/** Projection only. A real dependency plus a completed predecessor run and a started
 * successor run proves a handoff. No hard-coded role sequence or speculative arrows. */
export function deriveOfficeTransitions(input: TransitionEvidence): OfficeTransition[] {
  const tasks = new Map(input.tasks.map(t=>[t.id,t]));
  const result: OfficeTransition[]=[];
  function add(id:string,type:TransitionKind,fromRole:string,toRole:string,at:number,taskId:string|null,attempt:number,evidenceId:string,status:string) {
    if (!Number.isFinite(at) || !fromRole || !toRole) return;
    result.push({id,projectId:input.projectId,taskId,attempt,fromRole,toRole,type,occurredAt:at,evidenceId,status,label:`${fromRole} → ${toRole} · ${type.toLowerCase().replaceAll('_',' ')}`});
  }
  for(const run of input.runs) {
    const target=tasks.get(run.taskId); if(!target || !['RUNNING','SUCCEEDED','FAILED','ESCALATED'].includes(run.status))continue;
    for(const dependency of target.dependsOn) {
      const source=tasks.get(dependency); if(!source)continue;
      const completed=input.runs.filter(r=>r.taskId===dependency && r.status==='SUCCEEDED' && r.finishedAt!==null && r.finishedAt<=run.startedAt).sort((a,b)=>b.finishedAt!-a.finishedAt!)[0];
      if(completed)add(`handoff:${run.id}:${completed.id}`,'HANDOFF',source.roleId,target.roleId,run.startedAt,target.id,run.attempt,run.id,run.status);
    }
    if(input.verifiedDelivery && target.roleId==='release-agent' && run.status==='SUCCEEDED' && run.finishedAt!==null)
      add(`delivery:${run.id}`,'DELIVERY',target.roleId,'delivery',run.finishedAt,target.id,run.attempt,run.id,'VERIFIED');
  }
  for(const event of input.remediations) {
    const source=tasks.get(event.taskId); if(!source)continue;
    for(const id of event.targets) {
      const target=tasks.get(id); if(!target || target.id===source.id)continue;
      add(`remediation:${event.id}:${id}`,'REMEDIATION',source.roleId,target.roleId,event.occurredAt,id,event.attempt,event.id,'REQUESTED');
    }
  }
  for(const approval of input.approvals) {
    const role=approval.requestedBy==='office-engineer'?'engineer':tasks.get(approval.taskId??'')?.roleId ?? (input.tasks.some(t=>t.roleId===approval.requestedBy)?approval.requestedBy:'orchestrator');
    add(`approval:${approval.id}`,'APPROVAL_REQUEST',role,'owner',approval.createdAt,approval.taskId,0,approval.id,approval.status);
    if(approval.status==='APPROVED' && approval.decidedAt!==null)
      add(`resume:${approval.id}:${approval.decidedAt}`,'APPROVAL_RESUME','owner',role,approval.decidedAt,approval.taskId,0,approval.id,'AUTHORIZED');
  }
  for(const incident of input.incidents) {
    const role=tasks.get(incident.taskId??'')?.roleId??'orchestrator';
    add(`incident:${incident.id}`,'INCIDENT',role,'engineer',incident.detectedAt,incident.taskId,0,incident.id,incident.status);
    if(incident.status==='RESOLVED' && incident.resolvedAt!==null)
      add(`recovery:${incident.id}:${incident.resolvedAt}`,'RECOVERY','engineer',role,incident.resolvedAt,incident.taskId,0,incident.id,'RESOLVED');
  }
  return [...new Map(result.map(t=>[t.id,t])).values()].sort((a,b)=>a.occurredAt-b.occurredAt||a.id.localeCompare(b.id)).slice(-100);
}
export const TRANSITION_TTL_MS=20_000, QUEUE_LIMIT=8, PACKET_DURATION_MS=2800;
export interface QueueState { seen:string[]; watermark:number; pending:OfficeTransition[]; current:OfficeTransition|null; until:number; }
export function emptyQueue(watermark=0,seen:string[]=[]):QueueState{return {seen:seen.slice(-256),watermark,pending:[],current:null,until:0};}
/** Same input may be offered every refresh. A high-water mark and bounded ID set
 * prevent duplicates, including reloads. Hidden/off motion consumes without replay. */
export function advanceQueue(state:QueueState, incoming:OfficeTransition[], now:number, enabled=true):QueueState {
  const known=new Set(state.seen);
  const fresh=incoming.filter(t=>!known.has(t.id)&&t.occurredAt>state.watermark&&t.occurredAt<=now&&now-t.occurredAt<TRANSITION_TTL_MS);
  for(const t of incoming)known.add(t.id);
  const watermark=Math.max(state.watermark,...incoming.filter(t=>t.occurredAt<=now).map(t=>t.occurredAt));
  const seen=[...known].slice(-256);
  if(!enabled)return {seen,watermark,pending:[],current:null,until:0};
  const priority=(t:OfficeTransition)=>['REMEDIATION','APPROVAL_REQUEST','INCIDENT','DELIVERY'].includes(t.type)?0:1;
  const pending=[...state.pending,...fresh].filter(t=>now-t.occurredAt<TRANSITION_TTL_MS).sort((a,b)=>priority(a)-priority(b)||a.occurredAt-b.occurredAt).slice(0,QUEUE_LIMIT);
  let current=state.current,until=state.until;
  if(now>=until){current=pending.shift()??null;until=current?now+PACKET_DURATION_MS:0;}
  return {seen,watermark,pending,current,until};
}
