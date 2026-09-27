-- Conversation evidence never grants project execution capabilities.
CREATE TABLE conversation_qualifications (
 provider TEXT NOT NULL,
 modelId TEXT NOT NULL,
 capability TEXT NOT NULL,
 passed INTEGER NOT NULL CHECK(passed IN (0,1)),
 latencyMs INTEGER NOT NULL,
 contextTokens INTEGER NOT NULL,
 checkedAt INTEGER NOT NULL,
 PRIMARY KEY(provider, modelId, capability)
);
CREATE TABLE office_conversations (
 id TEXT PRIMARY KEY,
 ownerId TEXT NOT NULL,
 sessionId TEXT NOT NULL,
 projectId TEXT,
 roleId TEXT NOT NULL,
 messages TEXT NOT NULL DEFAULT '[]',
 pending TEXT,
 updatedAt INTEGER NOT NULL
);
