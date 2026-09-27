export const INTENTS = ["STATUS_QUERY", "PROJECT_QUERY", "AGENT_WORK_QUERY", "ARTIFACT_QUERY", "EXPLANATION", "REASONING", "CODING_QUESTION", "QA_QUESTION", "SECURITY_QUESTION", "GENERAL_CONVERSATION", "CREATE_PROJECT", "PROJECT_CONTROL", "APPROVAL_ACTION", "WORKSPACE_ACTION", "MODEL_QUERY", "OFFICE_QUERY", "UNKNOWN"] as const;
export type ConversationIntent = typeof INTENTS[number];
export type ConversationMessage = { role: "user" | "assistant"; text: string };
export type ConversationAction =
  | { kind: "CREATE_PROJECT"; title: string; idea: string; mode: "local" | "remote" }
  | { kind: "PAUSE" | "RESUME"; projectId: string }
  | { kind: "APPROVE" | "REJECT"; approvalId: string; projectId: string };
export type ConversationReply = {
  message: string;
  intent: ConversationIntent;
  conversationId: string;
  revision: string;
  source: "state" | "model" | "unavailable";
  provider?: string;
  model?: string;
  latencyMs?: number;
  memoryToken?: string;
  pending?: { token: string; label: string; action: ConversationAction };
  navigation?: { href?: string; roleId?: string };
};
