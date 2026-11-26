import "server-only";
import { DatabaseSync } from "node:sqlite";
import { exportModelCatalog, readModelCatalog, findMissingFreeTierEligibility, CATALOG_PATH } from "../lib/ai-office/remote/model-catalog.ts";
import { remoteClientFromEnv } from "../lib/ai-office/remote/remote-state-store.ts";
import { GitHubClient } from "../lib/ai-office/remote/github-client.ts";

// Explicit owner-operated synchronization, never called by discovery or project creation.
// Existing catalogs require review of the current revision; no blind health replacement.
const source=process.argv[2];
if(!source)throw new Error("Usage: remote-sync-models <evidence.db> [expected-revision]");
const config=remoteClientFromEnv();
const current=await readModelCatalog(config);
if(current.catalog?.lease)throw new Error("Catalog is leased; synchronization refused");
if(current.catalog&&Number(process.argv[3])!==current.catalog.revision)throw new Error("Review current catalog and supply its expected revision");
const db=new DatabaseSync(source,{readOnly:true});
try {
  const catalog=exportModelCatalog(db,(current.catalog?.revision??0)+1);
  if(!catalog.models.some(m=>m.qualified&&m.enabled))throw new Error("No existing qualified model evidence to synchronize");
  // Real incident: this command was once run without
  // AI_OFFICE_GROQ_FREE_TIER_CONFIRMED/AI_OFFICE_GROQ_FREE_MODELS set in
  // its own shell, which silently produced a catalog where every Groq
  // model came back disabled for every consumer — see
  // findMissingFreeTierEligibility's docblock. Catching it here, against
  // the SAME env this command is actually running in, is strictly more
  // useful than catching it only after a confused "No eligible qualified
  // free model" error shows up downstream in a completely different process.
  const missingEligibility = findMissingFreeTierEligibility(catalog);
  if (missingEligibility.length > 0) {
    throw new Error(
      `Refusing to synchronize: ${missingEligibility.length} qualified model(s) have no matching free-tier eligibility in THIS shell's environment — ` +
        `${missingEligibility.map((m) => `${m.provider}:${m.modelId}`).join(", ")}. ` +
        `Set AI_OFFICE_<PROVIDER>_FREE_TIER_CONFIRMED=true and AI_OFFICE_<PROVIDER>_FREE_MODELS=<comma-separated model ids> in the SAME command invocation as this sync (not just in a .env file some other process reads) — otherwise the synced catalog will silently disable these models for every consumer, regardless of what the real deployment's own env vars say.`,
    );
  }
  await new GitHubClient(config).putFile(CATALOG_PATH,JSON.stringify(catalog),{message:"chore(routing): synchronize owner-reviewed qualification evidence",expectedSha:current.sha??undefined});
  console.log(JSON.stringify({revision:catalog.revision,models:catalog.models.length,benchmarks:catalog.benchmarks.length}));
}finally{db.close();}
