import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../../db/test-helpers.ts';
import { createProjectWithIdea } from '../../domain/projects.ts';
import { getOwner } from '../../domain/users.ts';
import { createTask,createTaskAttempt,createAgentRunForAttempt,updateTaskStatus } from '../../domain/tasks.ts';
import { recordEvent } from '../../domain/events.ts';
import { createApproval } from '../../domain/project-outputs.ts';
import { createIncident,updateIncident } from '../../domain/office-incidents.ts';
import { getOfficeFloorView } from '../office-floor-data.ts';
import { getOfficeInteractionView } from '../office-interaction-data.ts';
import { getPendingApprovalsView } from '../dashboard-data.ts';
process.env.OFFICE_OWNER_EMAIL='interaction@example.test';process.env.OFFICE_OWNER_PASSWORD_HASH='synthetic';
test('read model has no inferred model, raw payload, invented incident or network call',()=>{
 const t=createTestDb(),native=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Visualization must not use network');};
 try{const {project}=createProjectWithIdea(t.db,{title:'Visual fixture',rawIdeaText:'Private prompt never rendered by projection',ownerId:getOwner(t.db)!.id,routingMode:'FREE_MULTI_MODEL'});
 const task=createTask(t.db,{projectId:project.id,roleId:'frontend-developer',title:'Actual task'});updateTaskStatus(t.db,task.id,'IN_PROGRESS');
 recordEvent(t.db,{projectId:project.id,type:'agent_run.succeeded',actor:'frontend-developer',payload:{taskId:task.id,summary:'SECRET_PROMPT_DO_NOT_RENDER',internalReasoning:'INTERNAL_ONLY'}});
 let view=getOfficeInteractionView(t.db,getOfficeFloorView(t.db,project.id))!;assert.deepEqual(view.activeModels,[]);assert.equal(view.engineer,'HEALTHY');assert.equal(view.verifiedDelivery,false);assert.deepEqual(view.transitions,[]);assert.ok(!JSON.stringify(view).includes('SECRET_PROMPT'));assert.ok(!JSON.stringify(view).includes('INTERNAL_ONLY'));assert.equal(calls,0);
 const attempt=createTaskAttempt(t.db,task.id);createAgentRunForAttempt(t.db,{taskAttemptId:attempt.id,roleId:'frontend-developer',provider:'openrouter',model:'actual/model:free'});
 view=getOfficeInteractionView(t.db,getOfficeFloorView(t.db,project.id))!;assert.deepEqual(view.activeModels,[{roleId:'frontend-developer',provider:'openrouter',model:'actual/model:free'}]);
 }finally{globalThis.fetch=native;t.close();}
});
test('existing approval cost and Office Engineer records project into real consoles',()=>{
 const t=createTestDb();try{const {project}=createProjectWithIdea(t.db,{title:'Fixture',rawIdeaText:'Test only',ownerId:getOwner(t.db)!.id});
 createApproval(t.db,{projectId:project.id,kind:'budget_increase',requestedBy:'orchestrator',context:{reason:'Recorded reason',estimatedCostUsd:0.25}});
 assert.equal(getPendingApprovalsView(t.db)[0].estimatedCostUsd,0.25);
 const incident=createIncident(t.db,{projectId:project.id,symptom:'runner-offline',status:'REPAIRING'});
 let view=getOfficeInteractionView(t.db,getOfficeFloorView(t.db,project.id))!;assert.equal(view.approvals,1);assert.equal(view.engineer,'REPAIRING');assert.ok(view.transitions.some(t=>t.type==='INCIDENT'));
 updateIncident(t.db,incident.id,{status:'RESOLVED',resolvedAt:Date.now()});view=getOfficeInteractionView(t.db,getOfficeFloorView(t.db,project.id))!;assert.equal(view.engineer,'HEALTHY');assert.ok(view.transitions.some(t=>t.type==='RECOVERY'));
 }finally{t.close();}
});
