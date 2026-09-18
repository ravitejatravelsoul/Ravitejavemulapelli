import { openDatabase } from '../lib/ai-office/db/client.ts';
import { runMigrations } from '../lib/ai-office/db/migrate.ts';
import { seedAll } from '../lib/ai-office/db/seed.ts';
import { syncAllFreeModelCatalogs } from '../lib/ai-office/providers/free/model-catalog-sync.ts';
import { benchmarkFreeProviderModel } from '../lib/ai-office/benchmark/free-model-benchmark.ts';
import { listBenchmarkResults } from '../lib/ai-office/domain/model-routing.ts';
import { writeFileSync } from 'node:fs';
if (process.env.AI_OFFICE_CLAUDE_ENABLED !== 'false') throw new Error('Pilot requires Claude disabled');
const db = openDatabase('.data/free-pilot/pilot.db'); runMigrations(db); seedAll(db);
console.log('Catalog', JSON.stringify(await syncAllFreeModelCatalogs(db)));
const models = (process.env.PILOT_MODELS ?? 'openai/gpt-oss-20b,openai/gpt-oss-120b').split(',');
for (const modelId of models) {
 const provider = (process.env.PILOT_PROVIDER ?? 'groq') as 'groq' | 'gemini' | 'openrouter' | 'ollama';
 console.log('Benchmark starting',provider,modelId);
 console.log('Benchmark result',JSON.stringify(await benchmarkFreeProviderModel(db,{provider,modelId, scenarioIds: process.env.PILOT_SCENARIOS?.split(",") as never})));
 const rows = listBenchmarkResults(db,{model:`${provider}/${modelId}`});
 console.log(JSON.stringify(rows.slice(0,10).map(r=>({scenario:r.scenarioId,status:r.status,score:r.score,tokens:[r.promptTokens,r.outputTokens]}))));
 writeFileSync('.data/free-pilot/benchmarks.json',JSON.stringify(listBenchmarkResults(db),null,2));
}
db.close();
