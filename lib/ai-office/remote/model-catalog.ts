import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { GitHubClient } from "./github-client.ts";
import type { RemoteRuntimeConfig } from "./remote-state-store.ts";
import { getFreeEligibility } from "../providers/free/free-provider-config.ts";
import { exportProviderTokenWindows, restoreProviderTokenWindows } from "../agents/agent-runner.ts";

// Explicit wire allowlist: never serialize arbitrary DB columns, prompts or credentials.
const bit = z.union([z.literal(0), z.literal(1)]);
const num = z.number().finite().nonnegative();
const model = z.object({
  id:z.string().max(250), provider:z.enum(["groq","gemini","openrouter"]), modelId:z.string().max(200),
  displayName:z.string().max(200), freeTier:bit, enabled:bit, capabilities:z.string().max(1000),
  contextWindow:num.nullable(), structuredOutput:bit, health:z.enum(["HEALTHY","DEGRADED","UNAVAILABLE","UNKNOWN"]),
  rateLimitedUntil:num.nullable(), recentFailureCount:num, benchmarkScore:num.nullable(), avgLatencyMs:num.nullable(),
  lastCheckedAt:num.nullable(), lastUsedAt:num.nullable(), tasksCompleted:num, tasksFailed:num, qualified:bit,
  createdAt:num, updatedAt:num,
});
const qualification = z.object({provider:z.string(),modelId:z.string(),capability:z.string(),passed:bit,latencyMs:num,contextTokens:num,checkedAt:num});
const benchmark = z.object({id:z.string(),model:z.string(),scenarioId:z.string(),roleId:z.string(),status:z.enum(["PASS","PARTIAL","FAIL"]),score:num,latencyMs:num,promptTokens:num.nullable(),outputTokens:num.nullable(),retries:num,timedOut:bit,malformedJson:bit,createdAt:num});
export const catalogSchema = z.object({
  version:z.literal(1), revision:num, updatedAt:num,
  lease:z.object({id:z.string(),expiresAt:num}).nullable(),
  models:z.array(model).max(200),
  providers:z.array(z.object({provider:z.enum(["groq","gemini","openrouter"]),enabled:bit,updatedAt:num})).max(3),
  eligibility:z.array(z.object({provider:z.string(),modelId:z.string(),kind:z.enum(["PROVIDER_FREE_ROUTE","OWNER_CONFIRMED_FREE_TIER"])})).max(200),
  benchmarks:z.array(benchmark).max(5000), conversations:z.array(qualification).max(1000),
  tokenWindows:z.array(z.object({key:z.string().max(250),limit:num.optional(),remaining:num.optional(),resetAt:num.optional()})).max(200).default([]),
});
export type RemoteModelCatalog = z.infer<typeof catalogSchema>;
export const CATALOG_PATH = "state/model-catalog.json";
export function exportModelCatalog(db:DatabaseSync, revision=0):RemoteModelCatalog {
  const models=db.prepare("SELECT * FROM model_registry WHERE provider IN ('groq','gemini','openrouter')").all().map(r=>model.parse(r));
  return catalogSchema.parse({version:1,revision,updatedAt:Date.now(),lease:null,models,
    providers:db.prepare("SELECT * FROM provider_configs WHERE provider IN ('groq','gemini','openrouter')").all(),
    eligibility:models.flatMap(m=>{const kind=getFreeEligibility(m.provider,m.modelId);return kind&&kind!=="LOCAL_FREE"?[{provider:m.provider,modelId:m.modelId,kind}]:[];}),
    benchmarks:db.prepare("SELECT * FROM benchmark_results ORDER BY createdAt DESC LIMIT 5000").all().map(r=>benchmark.parse(r)),
    conversations:db.prepare("SELECT * FROM conversation_qualifications").all(),tokenWindows:exportProviderTokenWindows(),
  });
}
export function hydrateModelCatalog(db:DatabaseSync, raw:unknown, restorePacing=false):void {
  const c=catalogSchema.parse(raw);
  db.exec("BEGIN");
  try {
    for(const [table,rows] of [["model_registry",c.models],["provider_configs",c.providers],["benchmark_results",c.benchmarks],["conversation_qualifications",c.conversations]] as const){
      for(const row of rows){
        if(table==="model_registry") {
          const m=row as RemoteModelCatalog["models"][number];
          if(m.id!==`${m.provider}:${m.modelId}`)throw new Error("Invalid catalog model identity");
          // Catalog evidence cannot override the deployment's explicit owner confirmation.
          if(!c.eligibility.some(e=>e.provider===m.provider&&e.modelId===m.modelId&&e.kind===getFreeEligibility(m.provider,m.modelId)))m.enabled=0;
        }
        const keys=Object.keys(row);
        db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(row));
      }
    }
    db.exec("COMMIT");
    if(restorePacing)restoreProviderTokenWindows(c.tokenWindows);
  }catch(e){db.exec("ROLLBACK");throw e;}
}
export async function readModelCatalog(config:RemoteRuntimeConfig){
  const file=await new GitHubClient(config).getFile(CATALOG_PATH);
  return {catalog:file?catalogSchema.parse(JSON.parse(file.content)):null,sha:file?.sha??null};
}
export async function acquireModelCatalog(config:RemoteRuntimeConfig){
  const {catalog,sha}=await readModelCatalog(config);
  if(!catalog||!sha)throw new Error("Remote model catalog is not synchronized");
  // No automatic lease stealing: an interrupted worker requires explicit recovery review.
  // This fails closed rather than discarding possibly unpersisted provider failures.
  if(catalog.lease)throw new Error("Remote routing catalog is leased; retry after worker completion or inspect interrupted lease");
  const lease={id:randomUUID(),expiresAt:Date.now()+20*60_000};
  const reserved={...catalog,lease};
  const result=await new GitHubClient(config).putFile(CATALOG_PATH,JSON.stringify(reserved),{message:"chore(routing): acquire office model lease",expectedSha:sha});
  return {catalog:reserved,sha:result.sha};
}
export async function commitModelCatalog(config:RemoteRuntimeConfig, held:Awaited<ReturnType<typeof acquireModelCatalog>>, db:DatabaseSync){
  const updated=exportModelCatalog(db,held.catalog.revision+1);
  // Single CAS commits outcomes and releases the lease. Never retry stale outcomes.
  await new GitHubClient(config).putFile(CATALOG_PATH,JSON.stringify(updated),{message:"chore(routing): persist model outcomes and release lease",expectedSha:held.sha});
}
