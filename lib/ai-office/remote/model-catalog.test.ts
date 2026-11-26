import { test } from "node:test";
import assert from "node:assert/strict";
import { hydrateEphemeralDb, DEFAULT_OFFICE_REMOTE_STATE } from "./remote-state-store.ts";
import { exportModelCatalog, hydrateModelCatalog, acquireModelCatalog, commitModelCatalog, catalogSchema, findMissingFreeTierEligibility } from "./model-catalog.ts";
import { upsertModelRegistryEntry, recordModelOutcome } from "../domain/model-registry.ts";
import { selectFreeModel } from "../agents/free-model-router.ts";

test("remote catalog roundtrip preserves existing gates, cooldown, failures and real recovery",()=>{
  const saved={...process.env};Object.assign(process.env,{GROQ_API_KEY:"test-key",AI_OFFICE_GROQ_FREE_TIER_CONFIRMED:"true",AI_OFFICE_GROQ_FREE_MODELS:"test-model"});
  const db=hydrateEphemeralDb(DEFAULT_OFFICE_REMOTE_STATE,null),remote=hydrateEphemeralDb(DEFAULT_OFFICE_REMOTE_STATE,null);
  try{
    upsertModelRegistryEntry(db,{provider:"groq",modelId:"test-model",displayName:"Test",capabilities:["CODING","STRUCTURED_OUTPUT"],structuredOutput:true,contextWindow:10000});
    db.prepare("UPDATE model_registry SET qualified=1,health='HEALTHY',benchmarkScore=95").run();
    const c=exportModelCatalog(db);hydrateModelCatalog(remote,c);
    const query={capability:"CODING" as const,requiredCapabilities:["CODING","STRUCTURED_OUTPUT"] as const};
    assert.ok(selectFreeModel(remote,query));assert.equal(selectFreeModel(remote,{capability:"REASONING"}),null);
    assert.equal(selectFreeModel(remote,{...query,estimatedInputTokens:11000}),null);
    recordModelOutcome(remote,"groq","test-model",{succeeded:false,rateLimitedForMs:60000});
    hydrateModelCatalog(db,exportModelCatalog(remote));assert.equal(selectFreeModel(db,query),null);
    assert.ok((exportModelCatalog(db).models[0]!.rateLimitedUntil??0)>Date.now());
    recordModelOutcome(remote,"groq","test-model",{succeeded:false});recordModelOutcome(remote,"groq","test-model",{succeeded:false});
    hydrateModelCatalog(db,exportModelCatalog(remote));assert.equal(exportModelCatalog(db).models[0]!.recentFailureCount,3);assert.equal(selectFreeModel(db,query),null);
    recordModelOutcome(remote,"groq","test-model",{succeeded:true});hydrateModelCatalog(db,exportModelCatalog(remote));assert.ok(selectFreeModel(db,query));
    const unqualified=exportModelCatalog(db);unqualified.models[0]!.qualified=0;hydrateModelCatalog(db,unqualified);assert.equal(selectFreeModel(db,query),null);
    process.env.AI_OFFICE_GROQ_FREE_TIER_CONFIRMED="false";hydrateModelCatalog(remote,c);assert.equal(selectFreeModel(remote,query),null);
    assert.equal(JSON.stringify(c).includes("test-key"),false);
    assert.equal(catalogSchema.safeParse({...c,models:[{...c.models[0],provider:"anthropic"}]}).success,false);
  }finally{db.close();remote.close();process.env=saved;}
});

test("office lease serializes workers and CAS refuses concurrent catalog edits",async()=>{
  const db=hydrateEphemeralDb(DEFAULT_OFFICE_REMOTE_STATE,null);let content=JSON.stringify(exportModelCatalog(db)),sha="one";
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    if(!init?.method||init.method==="GET")return Response.json({content:Buffer.from(content).toString("base64"),encoding:"base64",sha});
    const body=JSON.parse(String(init.body));if(body.sha!==sha)return new Response("conflict",{status:409});
    content=Buffer.from(body.content,"base64").toString();sha+="x";return Response.json({content:{sha}});
  };
  const config={token:"test",owner:"test",repo:"test",branch:"test"};
  try{
    const held=await acquireModelCatalog(config);await assert.rejects(acquireModelCatalog(config),/leased/);
    sha+="concurrent";await assert.rejects(commitModelCatalog(config,held,db),/conflict/i);
    assert.ok(JSON.parse(content).lease);
  }finally{globalThis.fetch=original;db.close();}
});

// Real incident: scripts/ai-office-remote-sync-models.ts was once run
// without AI_OFFICE_GROQ_FREE_TIER_CONFIRMED/AI_OFFICE_GROQ_FREE_MODELS
// set in its own invoking shell, silently producing a catalog where every
// qualified Groq model came back disabled for every consumer — see
// findMissingFreeTierEligibility's docblock for the full mechanism.
test("findMissingFreeTierEligibility catches a qualified model the exporting shell's own env vars don't cover",()=>{
  const saved={...process.env};
  const db=hydrateEphemeralDb(DEFAULT_OFFICE_REMOTE_STATE,null);
  try{
    delete process.env.AI_OFFICE_GROQ_FREE_TIER_CONFIRMED;delete process.env.AI_OFFICE_GROQ_FREE_MODELS;
    upsertModelRegistryEntry(db,{provider:"groq",modelId:"test-model",displayName:"Test",capabilities:["CODING"],structuredOutput:true,contextWindow:10000});
    db.prepare("UPDATE model_registry SET qualified=1,enabled=1,health='HEALTHY'").run();
    const unconfirmed=exportModelCatalog(db);
    assert.deepEqual(unconfirmed.eligibility,[],"no eligibility entry can exist for a provider this shell never confirmed as free-tier");
    const missing=findMissingFreeTierEligibility(unconfirmed);
    assert.equal(missing.length,1);assert.equal(missing[0]!.modelId,"test-model");

    Object.assign(process.env,{AI_OFFICE_GROQ_FREE_TIER_CONFIRMED:"true",AI_OFFICE_GROQ_FREE_MODELS:"test-model"});
    const confirmed=exportModelCatalog(db);
    assert.equal(findMissingFreeTierEligibility(confirmed).length,0,"the same model is no longer flagged once the exporting shell's own env vars cover it");

    db.prepare("UPDATE model_registry SET qualified=0").run();
    assert.equal(findMissingFreeTierEligibility(exportModelCatalog(db)).length,0,"an unqualified model is never flagged — there is nothing to silently disable");
  }finally{db.close();process.env=saved;}
});
