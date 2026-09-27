import "server-only";
import { DatabaseSync } from "node:sqlite";
import { exportModelCatalog, readModelCatalog, CATALOG_PATH } from "../lib/ai-office/remote/model-catalog.ts";
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
  await new GitHubClient(config).putFile(CATALOG_PATH,JSON.stringify(catalog),{message:"chore(routing): synchronize owner-reviewed qualification evidence",expectedSha:current.sha??undefined});
  console.log(JSON.stringify({revision:catalog.revision,models:catalog.models.length,benchmarks:catalog.benchmarks.length}));
}finally{db.close();}
