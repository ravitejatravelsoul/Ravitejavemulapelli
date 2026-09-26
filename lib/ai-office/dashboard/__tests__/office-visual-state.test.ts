import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAgentVisualState, summarizeVisualAgents } from '../office-visual-state.ts';
import { WORKSTATIONS } from '../../office-scene-layout.ts';
import { AGENT_ROLE_CATALOG } from '../../domain/agent-role-catalog.ts';
import { createTestDb } from '../../db/test-helpers.ts';
import { createProjectWithIdea } from '../../domain/projects.ts';
import { getOwner } from '../../domain/users.ts';
import { createTask, createTaskAttempt, createAgentRunForAttempt, updateTaskStatus } from '../../domain/tasks.ts';
import { getOfficeFloorView } from '../office-floor-data.ts';
process.env.OFFICE_OWNER_EMAIL='visual@example.test';
process.env.OFFICE_OWNER_PASSWORD_HASH='synthetic-test-hash';
const now=100000;
const task={status:'IN_PROGRESS',attemptCount:1,updatedAt:now};
test('all real roles have registered workstations',()=>{
 assert.deepEqual(Object.keys(WORKSTATIONS).sort(),AGENT_ROLE_CATALOG.map(r=>r.id).sort());
 for(const station of Object.values(WORKSTATIONS)){assert.ok(station.head.cx>0&&station.head.cx<1672);assert.ok(station.head.cy>0&&station.head.cy<941);}
});
test('task and role mappings cover each Level 1 operational state',()=>{
 for(const [roleId,expected] of [['product-owner','THINKING'],['solution-architect','WORKING'],['frontend-developer','WORKING'],['qa-agent','TESTING'],['security-reviewer','REVIEWING']]) assert.equal(mapAgentVisualState({roleId,task,now}),expected);
 for(const [status,expected] of [['BLOCKED','BLOCKED'],['FAILED','FAILED'],['ASSIGNED','QUEUED'],['IN_REVIEW','REVIEWING'],['unrecognized','IDLE'],['PENDING','WAITING']])assert.equal(mapAgentVisualState({roleId:'backend-developer',task:{...task,status},now}),expected);
 assert.equal(mapAgentVisualState({roleId:'backend-developer',task:{...task,status:'PENDING'},dependenciesSatisfied:true,now}),'QUEUED');
 assert.equal(mapAgentVisualState({roleId:'frontend-developer',task:{...task,attemptCount:2},now}),'RETRYING');
 assert.equal(mapAgentVisualState({roleId:'frontend-developer',task:{...task,leaseExpiresAt:now-1},now}),'WAITING');
 assert.equal(mapAgentVisualState({roleId:'release-agent',task:{...task,status:'DONE'},now}),'DONE');
 assert.equal(mapAgentVisualState({roleId:'release-agent',task:{...task,status:'DONE'},now:now+15000}),'IDLE');
 assert.equal(mapAgentVisualState({roleId:'frontend-developer',task,projectStatus:'PAUSED',now}),'PAUSED');
});
test('Orchestrator coordinates real work, planning, approvals and blockers; has no model',()=>{
 for(const [extra,expected] of [[{projectStatus:'PLANNING'},'THINKING'],[{runningTaskCount:2},'WORKING'],[{pendingApproval:true},'WAITING'],[{blockedTaskCount:1},'BLOCKED'],[{},'IDLE']] as const)assert.equal(mapAgentVisualState({roleId:'orchestrator',now,...extra}),expected);
});
test('summary counts active workers, not command desk or historical models',()=>{
 assert.deepEqual(summarizeVisualAgents([{roleId:'orchestrator',status:'WORKING',provider:null},{roleId:'qa-agent',status:'TESTING',provider:'groq'},{roleId:'frontend-developer',status:'RETRYING',provider:'openrouter'},{roleId:'release-agent',status:'IDLE',provider:'ollama'}]),{active:2,waiting:0,reviewing:0,blocked:0,providers:{groq:1,openrouter:1}});
});
test('projection uses exact current run, task, attempts; never guesses provider from project',()=>{
 const t=createTestDb();try{
 const {project}=createProjectWithIdea(t.db,{title:'Visual',rawIdeaText:'A visual test only',ownerId:getOwner(t.db)!.id,provider:'ollama',routingMode:'FREE_MULTI_MODEL'});
 const old=createTask(t.db,{projectId:project.id,roleId:'frontend-developer',title:'Older completed task'});updateTaskStatus(t.db,old.id,'DONE');
 const current=createTask(t.db,{projectId:project.id,roleId:'frontend-developer',title:'Current task'});updateTaskStatus(t.db,current.id,'IN_PROGRESS');
 let a=getOfficeFloorView(t.db,project.id).agents.find(a=>a.roleId==='frontend-developer')!;assert.equal(a.provider,null);assert.equal(a.model,null);assert.equal(a.currentTaskTitle,'Current task');
 const attempt=createTaskAttempt(t.db,current.id);createAgentRunForAttempt(t.db,{taskAttemptId:attempt.id,roleId:'frontend-developer',provider:'openrouter',model:'exact/model:free'});
 a=getOfficeFloorView(t.db,project.id).agents.find(a=>a.roleId==='frontend-developer')!;assert.equal(a.provider,'openrouter');assert.equal(a.model,'exact/model:free');assert.equal(a.attemptCount,1);assert.equal(a.taskId,current.id);
 }finally{t.close();}
});
