/** Local-only real-provider pilot. Run after catalog sync + qualification.
 * All normal requests are real; no simulated adapters or fabricated scores. */
import { openDatabase } from '../lib/ai-office/db/client.ts';
import { runMigrations } from '../lib/ai-office/db/migrate.ts';
import { seedAll } from '../lib/ai-office/db/seed.ts';
import { getOwner } from '../lib/ai-office/domain/users.ts';
import { createProjectWithIdea, getProject } from '../lib/ai-office/domain/projects.ts';
import { planProject } from '../lib/ai-office/orchestrator/orchestrator.ts';
import { resolve } from 'node:path';
import { retryEscalatedTask } from '../lib/ai-office/control/task-transitions.ts';
import { recoverTasksOwnedByDeadRunner, runOneCycle } from '../lib/ai-office/runner/runner.ts';
import { setOfficeStatus } from '../lib/ai-office/domain/office.ts';
import { listTasksForProject } from '../lib/ai-office/domain/tasks.ts';
import { listRoutingDecisions, setProviderEnabled } from '../lib/ai-office/domain/model-registry.ts';
import { listAiUsageForProject } from '../lib/ai-office/domain/budget.ts';
import { getWorkspace } from '../lib/ai-office/domain/workspace.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
if(process.env.AI_OFFICE_CLAUDE_ENABLED !== 'false') throw new Error('Claude must be disabled');
process.env.AI_OFFICE_EXECUTION_MODE='local';
process.env.AI_OFFICE_WORKSPACES_ROOT=resolve('.data/free-pilot/workspaces');
mkdirSync('.data/free-pilot',{recursive:true});
const originalFetch=globalThis.fetch;
let anthropicAttempts=0;
const requests: Record<string,number>={};
globalThis.fetch=async(...args)=>{
 const host=new URL(String(args[0])).hostname;
 if(host.includes('anthropic')) {anthropicAttempts++;throw new Error('Anthropic prohibited in pilot');}
 requests[host]=(requests[host]??0)+1;
 return originalFetch(...args);
};
if(process.env.PILOT_FIRST_PROVIDER) process.env.AI_OFFICE_CONTEXT_BUDGET_OVERRIDES=JSON.stringify({GENERAL:{maxOutputTokens:4096}});
const db=openDatabase('.data/free-pilot/pilot.db');runMigrations(db);seedAll(db);
const owner=getOwner(db)!;
const projectId=process.env.PILOT_PROJECT_ID ?? createProjectWithIdea(db,{
 title:'Free API Hello World pilot', ownerId:owner.id,provider:'ollama',aiPolicyMode:'LOCAL_ONLY',routingMode:'FREE_MULTI_MODEL',
 rawIdeaText:'Create a simple static Hello World webpage. Include a heading, one descriptive paragraph and one button. Clicking the button must change visible text to Clicked!. Use only index.html, style.css and script.js. No backend or external services. Keep the implementation small.',
}).project.id;
if(getProject(db,projectId)?.status==='DRAFT') console.log('Plan',JSON.stringify(planProject(db,projectId).selectedRoles));
console.log('Project',projectId);
if(process.env.PILOT_RECOVER === 'true') {
 recoverTasksOwnedByDeadRunner(db,'free-pilot');
 for(const task of listTasksForProject(db,projectId).filter(t=>t.status==='BLOCKED')) console.log('Retry',retryEscalatedTask(db,task.id,owner.id,'Local pilot harness corrected; resume with preserved history'));
}
setOfficeStatus(db,{state:'OPEN',changedBy:owner.id,reason:'Isolated real free-model pilot'});
for(let n=0;n<20;n++){
 if(n===0 && process.env.PILOT_FIRST_PROVIDER==='openrouter') setProviderEnabled(db,'groq',false);
 let outcome;
 try { outcome=await runOneCycle(db,'free-pilot'); } finally { if(n===0 && process.env.PILOT_FIRST_PROVIDER==='openrouter') setProviderEnabled(db,'groq',true); }
 console.log('Cycle',n,JSON.stringify(outcome));
 const project=getProject(db,projectId)!;
 const tasks=listTasksForProject(db,projectId);
 const report={availabilityScenario:process.env.PILOT_FIRST_PROVIDER ? 'Groq disabled for first cycle, then enabled using owner provider controls' : 'normal routing',projectId,status:project.status,tasks:tasks.map(t=>({role:t.roleId,status:t.status,attempts:t.attemptCount})),workspace:getWorkspace(db,projectId),routing:listRoutingDecisions(db,{projectId}),usage:listAiUsageForProject(db,projectId),requests,anthropicAttempts};
 writeFileSync('.data/free-pilot/project-evidence.json',JSON.stringify(report,null,2));
 if(['READY_FOR_REVIEW','BLOCKED','FAILED'].includes(project.status)||outcome.kind==='idle') break;
 await new Promise(resolve=>setTimeout(resolve,15_000));
}
console.log('Final',getProject(db,projectId)?.status);
db.close();
