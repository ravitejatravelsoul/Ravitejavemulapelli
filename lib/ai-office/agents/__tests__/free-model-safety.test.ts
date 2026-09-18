import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../../db/test-helpers.ts';
import { upsertModelRegistryEntry, setModelBenchmarkScore, recordModelHealthCheck, recordModelOutcome } from '../../domain/model-registry.ts';
import { selectFreeModel } from '../free-model-router.ts';
import { requiredCapabilitiesForTask } from '../free-model-capabilities.ts';
import { ClaudeAdapter } from '../../providers/claude/claude-adapter.ts';
import { OpenAICompatibleAdapter } from '../../providers/openai-compatible/openai-compatible-adapter.ts';
import type { AgentTaskInput } from '../../providers/types.ts';
const input: AgentTaskInput = { role: 'product-owner', instructions: 'Return JSON', task: { projectId:'p',taskId:'t',roleId:'product-owner',taskTitle:'Requirements',projectTitle:'Pilot',projectSummary:'',authoritativeUserRequest:'Hello world',relevantArtifacts:[],relevantDecisions:[] } };

test('Claude adapter kill switch prevents even direct SDK calls', async () => {
 const old = process.env.AI_OFFICE_CLAUDE_ENABLED; process.env.AI_OFFICE_CLAUDE_ENABLED='false';
 let calls=0;
 try {
  const client = { messages: { create: async () => { calls++; throw new Error('Must never call'); } } };
  const adapter = new ClaudeAdapter({ client: client as never });
  await assert.rejects(adapter.runAgentTask(input), /disabled/); assert.equal(calls,0);
 } finally { if(old === undefined) delete process.env.AI_OFFICE_CLAUDE_ENABLED; else process.env.AI_OFFICE_CLAUDE_ENABLED=old; }
});
test('eligibility excludes paid, unknown, unqualified and incomplete capability models; expired cooldown recovers', () => {
 const t=createTestDb();
 try {
  const seed=(id:string,freeTier=true) => {
   upsertModelRegistryEntry(t.db,{provider:'ollama',modelId:id,displayName:id,capabilities:['CODING','STRUCTURED_OUTPUT'],structuredOutput:true,freeTier,contextWindow:8192});
  };
  seed('paid',false); seed('new'); seed('ready');
  for(const id of ['paid','ready']) {setModelBenchmarkScore(t.db,'ollama',id,{score:90,qualified:true});recordModelHealthCheck(t.db,'ollama',id,{health:'HEALTHY'});}
  assert.deepEqual(selectFreeModel(t.db,{capability:'CODING'})?.candidates.map(c=>c.modelId),['ready']);
  assert.equal(selectFreeModel(t.db,{capability:'CODING',requiredCapabilities:['REVIEW']}),null);
  assert.equal(selectFreeModel(t.db,{capability:'CODING',estimatedInputTokens:8000,estimatedOutputTokens:1000}),null);
  recordModelOutcome(t.db,'ollama','ready',{succeeded:false,rateLimitedForMs:60000});
  assert.equal(selectFreeModel(t.db,{capability:'CODING'}),null);
  t.db.prepare('UPDATE model_registry SET rateLimitedUntil = ? WHERE modelId = ?').run(Date.now()-1000,'ready');
  assert.equal(selectFreeModel(t.db,{capability:'CODING'})?.modelId,'ready');
 } finally {t.close();}
});
test('task intent changes required capabilities within the same role', () => {
 assert.ok(requiredCapabilitiesForTask('frontend-developer','Review code').includes('REVIEW'));
 assert.ok(!requiredCapabilitiesForTask('frontend-developer','Implement page').includes('REVIEW'));
});
test('malformed output retains consumed tokens; API errors cannot leak credentials', async () => {
 const adapter=new OpenAICompatibleAdapter({providerName:'groq',baseUrl:'https://example.invalid',apiKey:'secret-test-token',model:'m',fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'bad json'}}],usage:{prompt_tokens:12,completion_tokens:34}}),{status:200})});
 const r=await adapter.runAgentTask(input); assert.equal(r.status,'FAILED');assert.equal(r.usage.inputTokens,12);assert.equal(r.usage.outputTokens,34);
 const bad=new OpenAICompatibleAdapter({providerName:'groq',baseUrl:'https://example.invalid',apiKey:'secret-test-token',model:'m',fetchImpl:async()=>new Response('secret-test-token',{status:401})});
 await assert.rejects(bad.runAgentTask(input),(e:Error)=>!e.message.includes('secret-test-token') && e.message.includes('401'));
});

test('benchmark evidence changes routing between qualified models without a model call', () => {
 const t=createTestDb();
 try {
  for(const id of ['a','b']) {upsertModelRegistryEntry(t.db,{provider:'ollama',modelId:id,displayName:id,capabilities:['GENERAL'],structuredOutput:true});recordModelHealthCheck(t.db,'ollama',id,{health:'HEALTHY'});}
  setModelBenchmarkScore(t.db,'ollama','a',{score:90,qualified:true});setModelBenchmarkScore(t.db,'ollama','b',{score:60,qualified:true});
  assert.equal(selectFreeModel(t.db,{capability:'GENERAL'})?.modelId,'a');
  setModelBenchmarkScore(t.db,'ollama','b',{score:99,qualified:true});
  assert.equal(selectFreeModel(t.db,{capability:'GENERAL'})?.modelId,'b');
 }finally{t.close();}
});
