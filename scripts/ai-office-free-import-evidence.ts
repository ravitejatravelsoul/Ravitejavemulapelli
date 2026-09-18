// Import measured benchmark evidence into the local office; no project/task state is copied.
import { resolve } from 'node:path';
import { openDatabase } from '../lib/ai-office/db/client.ts';
import { runMigrations } from '../lib/ai-office/db/migrate.ts';
import { listModelRegistryEntries, upsertModelRegistryEntry, setModelBenchmarkScore, recordModelHealthCheck } from '../lib/ai-office/domain/model-registry.ts';
if(process.env.AI_OFFICE_EXECUTION_MODE === 'remote') throw new Error('Local only');
if(process.env.AI_OFFICE_DB_PATH) throw new Error('Custom database requires explicit review');
const target=openDatabase('.data/office.db');
target.prepare('VACUUM INTO ?').run(resolve(`.data/free-pilot/office-before-import-${Date.now()}.db`));
runMigrations(target);
const pilot=openDatabase('.data/free-pilot/pilot.db');
target.prepare('ATTACH DATABASE ? AS pilot').run(resolve('.data/free-pilot/pilot.db'));
target.exec('BEGIN');
try{
 target.exec('INSERT OR IGNORE INTO main.benchmark_results SELECT * FROM pilot.benchmark_results');
 for(const row of listModelRegistryEntries(pilot)){
  upsertModelRegistryEntry(target,{provider:row.provider,modelId:row.modelId,displayName:row.displayName,capabilities:JSON.parse(row.capabilities),contextWindow:row.contextWindow,structuredOutput:!!row.structuredOutput,freeTier:!!row.freeTier});
  if(row.benchmarkScore!==null){
   setModelBenchmarkScore(target,row.provider,row.modelId,{score:row.benchmarkScore,qualified:!!row.qualified});
   recordModelHealthCheck(target,row.provider,row.modelId,{health:row.health,latencyMs:row.avgLatencyMs??undefined});
  }
 }
 target.exec('COMMIT');
}catch(e){target.exec('ROLLBACK');throw e;}
console.log('Qualified local-office models:',JSON.stringify(listModelRegistryEntries(target).filter(r=>r.qualified).map(r=>({provider:r.provider,model:r.modelId,score:r.benchmarkScore}))));
pilot.close();target.close();
