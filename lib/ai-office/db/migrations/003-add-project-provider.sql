-- Adds a per-project execution provider, orthogonal to `aiMode`. `aiMode`
-- ('SIMULATED' | 'LIVE') governs budget authorization only — real money or
-- not. `provider` answers a different question: which engine executes a
-- project's SIMULATED-authorized work — the deterministic SimulatedAdapter
-- fixture, or a real local Ollama model. Both stay `aiMode = 'SIMULATED'`
-- ($0 by construction); only `provider` differs. LIVE mode is unaffected
-- and remains fully refused before any adapter is ever chosen.
--
-- A plain ADD COLUMN, not a table rebuild — widening the existing `aiMode`
-- CHECK constraint to add a third value would require SQLite's
-- create-copy-drop-rename table-rebuild procedure, which fails with
-- "FOREIGN KEY constraint failed" when run inside this project's
-- migrate.ts (every migration executes inside one BEGIN/COMMIT, and
-- PRAGMA foreign_keys — ON for every connection here — is a no-op
-- mid-transaction). Verified empirically before choosing this design; see
-- the "Living AI Office UI + Local Ollama Provider" plan for the trace.
ALTER TABLE projects ADD COLUMN provider TEXT NOT NULL DEFAULT 'simulated'
  CHECK (provider IN ('simulated', 'ollama'));
