import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../../db/test-helpers.ts';
import { syncAllFreeModelCatalogs } from '../free/model-catalog-sync.ts';
import { getModelRegistryEntry, setModelBenchmarkScore, recordModelHealthCheck } from '../../domain/model-registry.ts';

test('discovery requires explicit free metadata, preserves qualification, and retires missing models',async()=>{
 process.env.GROQ_API_KEY='test-only';process.env.AI_OFFICE_GROQ_FREE_TIER_CONFIRMED='true';process.env.AI_OFFICE_GROQ_FREE_MODELS='chat';
 delete process.env.GEMINI_API_KEY;delete process.env.OPENROUTER_API_KEY;
 const t=createTestDb();let listed=true;
 const fetchImpl=(async(url:string)=>new Response(JSON.stringify(url.includes('api.groq.com')?{data:listed?[{id:'chat',context_window:8192},{id:'paid-unlisted'}]:[]}:{models:[]}))) as typeof fetch;
 try{
  await syncAllFreeModelCatalogs(t.db,{fetchImpl});
  assert.equal(getModelRegistryEntry(t.db,'groq','chat')?.qualified,0);
  assert.equal(getModelRegistryEntry(t.db,'groq','chat')?.health,'UNKNOWN');
  assert.equal(getModelRegistryEntry(t.db,'groq','paid-unlisted'),undefined);
  setModelBenchmarkScore(t.db,'groq','chat',{score:90,qualified:true});recordModelHealthCheck(t.db,'groq','chat',{health:'HEALTHY'});
  await syncAllFreeModelCatalogs(t.db,{fetchImpl});assert.equal(getModelRegistryEntry(t.db,'groq','chat')?.qualified,1);
  listed=false;await syncAllFreeModelCatalogs(t.db,{fetchImpl});assert.equal(getModelRegistryEntry(t.db,'groq','chat')?.health,'UNAVAILABLE');
 }finally{t.close();}
});

test('missing provider keys do not crash or send external requests',async()=>{
 delete process.env.GROQ_API_KEY;delete process.env.GEMINI_API_KEY;delete process.env.OPENROUTER_API_KEY;
 const t=createTestDb();
 try{
  const results=await syncAllFreeModelCatalogs(t.db,{fetchImpl:(async(url:string)=>{
   assert.ok(!url.includes('api.groq.com')&&!url.includes('googleapis')&&!url.includes('openrouter'));
   return new Response(JSON.stringify({models:[]}));
  }) as typeof fetch});
  assert.ok(results.filter(r=>r.provider!=='ollama').every(r=>!r.configured));
 }finally{t.close();}
});
