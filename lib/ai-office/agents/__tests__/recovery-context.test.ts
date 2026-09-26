import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../../db/test-helpers.ts";
import { getOwner } from "../../domain/users.ts";
import { getAgentRole } from "../../domain/agent-roles.ts";
import { createProjectWithIdea } from "../../domain/projects.ts";
import { createTask, createTaskAttempt, createAgentRunForAttempt } from "../../domain/tasks.ts";
import { createArtifact, recordFailure, recordTestResult } from "../../domain/project-outputs.ts";
import { buildTaskContext } from "../context-builder.ts";

process.env.OFFICE_OWNER_EMAIL = "recovery@example.test";
process.env.OFFICE_OWNER_PASSWORD_HASH = "synthetic";

test("persisted Developer roles receive complete requirements and originating failed-review evidence", async () => {
 const t = createTestDb();
 try {
  const {project} = createProjectWithIdea(t.db,{title:"Generic editor",rawIdeaText:"Preserve changes",ownerId:getOwner(t.db)!.id});
  const dev = createTask(t.db,{projectId:project.id,roleId:"frontend-developer",title:"Implement"});
  const qa = createTask(t.db,{projectId:project.id,roleId:"qa-agent",title:"Verify"});
  const content = "Specification ".repeat(100)+"Final acceptance criterion";
  createArtifact(t.db,{projectId:project.id,type:"requirements",content});
  const attempt = createTaskAttempt(t.db,qa.id);
  const run = createAgentRunForAttempt(t.db,{taskAttemptId:attempt.id,roleId:qa.roleId,provider:"simulated"});
  recordTestResult(t.db,{projectId:project.id,taskId:qa.id,status:"FAIL",summary:"Failed criterion",details:{expected:"saved",actual:"empty"}});
  recordFailure(t.db,{projectId:project.id,taskId:dev.id,agentRunId:run.id,reason:"Failed criterion"});
  const context = await buildTaskContext(t.db,dev,getAgentRole(t.db,dev.roleId)!,{attemptNumber:2});
  assert.equal(context.relevantArtifacts.find(a=>a.type==="requirements")?.content,content);
  assert.equal(context.remediationContext?.failureReason,"Failed criterion");
  assert.deepEqual(JSON.parse(context.remediationContext!.evidence![0].details),{expected:"saved",actual:"empty"});
 } finally {t.close();}
});
