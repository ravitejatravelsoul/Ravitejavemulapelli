/** Fault-injection integration: real OpenRouter response after controlled Groq 429s.
 * The injected errors are explicitly reported; no fabricated successful responses. */
import assert from 'node:assert/strict';
import { openDatabase } from '../lib/ai-office/db/client.ts';
import { getOwner } from '../lib/ai-office/domain/users.ts';
import { createProjectWithIdea } from '../lib/ai-office/domain/projects.ts';
import { createTask } from '../lib/ai-office/domain/tasks.ts';
import { executeTask } from '../lib/ai-office/agents/agent-runner.ts';
import { selectFreeModel } from '../lib/ai-office/agents/free-model-router.ts';
import { listRoutingDecisions, setProviderEnabled, getModelRegistryEntry } from '../lib/ai-office/domain/model-registry.ts';
import { listAiUsageForProject } from '../lib/ai-office/domain/budget.ts';
import { writeFileSync } from 'node:fs';
if(process.env.AI_OFFICE_CLAUDE_ENABLED!=='false')throw new Error('Claude must be disabled');
process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES=JSON.stringify({GENERAL:{maxOutputTokens:4096}});
const db=openDatabase('.data/free-pilot/pilot.db');
const capabilities=['GENERAL','REASONING','STRUCTURED_OUTPUT'] as const;
const original=selectFreeModel(db,{capability:'GENERAL',requiredCapabilities:capabilities});
assert.ok(original);
// Owner provider toggle changes the eligible pool without changing any model scores.
setProviderEnabled(db,'groq',false);
const other=selectFreeModel(db,{capability:'GENERAL',requiredCapabilities:capabilities});
setProviderEnabled(db,'groq',true);
assert.equal(other?.provider,'openrouter');
const {project}=createProjectWithIdea(db,{title:'Live cross-provider fallback probe',rawIdeaText:'Define requirements for a Hello World page with a heading, description, and a button that changes visible text.',ownerId:getOwner(db)!.id,provider:'ollama',aiPolicyMode:'LOCAL_ONLY',routingMode:'FREE_MULTI_MODEL'});
const task=createTask(db,{projectId:project.id,roleId:'product-owner',title:'Define requirements'});
const injected: string[]=[]; const live: string[]=[];
const result=await executeTask(db,task.id,{freeProviderFetchImpl:async(url,init)=>{
 const host=new URL(String(url)).hostname;
 const model=JSON.parse(String(init?.body)).model;
 if(host==='api.groq.com'){injected.push(model);return new Response('{}',{status:429,headers:{'retry-after':'1'}});}
 assert.equal(host,'openrouter.ai');live.push(model);return fetch(url,init);
}});
const report={kind:'controlled Groq 429 injection with live OpenRouter fallback',originalSelection:original,alternateSelection:other,injected429:injected,liveRequests:live,outcome:result.outcome,reason:result.reason,routing:listRoutingDecisions(db,{projectId:project.id}),usage:listAiUsageForProject(db,project.id),cooldowns:injected.map(model=>getModelRegistryEntry(db,'groq',model)?.rateLimitedUntil)};
writeFileSync('.data/free-pilot/fallback-evidence.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
assert.equal(result.outcome,'succeeded');assert.ok(injected.length>0);assert.ok(live.length>0);assert.ok(report.usage.every(r=>r.costUsd===0));assert.equal(report.usage.length,injected.length+live.length);
db.close();
