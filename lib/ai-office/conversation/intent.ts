import type { ConversationIntent } from "./types.ts";

/** No inference is spent classifying explicit Office requests. Order keeps reads
 * such as "what needs approval" distinct from consequential commands. */
export function classifyConversation(text: string): ConversationIntent {
  const q = text.trim().toLowerCase();
  if (/^(?:please )?(?:create|build|start|make)\b/.test(q)) return "CREATE_PROJECT";
  if (/^(?:please )?(?:pause|resume|cancel)\b/.test(q)) return "PROJECT_CONTROL";
  if (/^(?:please )?(?:approve|reject|deny)\b/.test(q)) return "APPROVAL_ACTION";
  if (/\b(open|show|take me|go to)\b/.test(q) && /workspace|classic|architect|developer|vault|models|budget/.test(q)) return "WORKSPACE_ACTION";
  if (/why|trade.?off|explain|how did|how does/.test(q)) return "EXPLANATION";
  if (/can .*fix|should|would|compare|design|recommend/.test(q)) return "REASONING";
  if (/which model|what model|models|provider/.test(q)) return "MODEL_QUERY";
  if (/report|artifact|show.*(?:qa|review)/.test(q)) return "ARTIFACT_QUERY";
  if (/what (?:are|did|have) you|your (?:task|work)|working on|you finish/.test(q)) return "AGENT_WORK_QUERY";
  if (/qa.*pass|delivered|delivery|ready|tasks.*complete|how many|project.*(?:status|cost)|this project/.test(q)) return "PROJECT_QUERY";
  if (/status|who.*(?:working|blocked)|happening|what finished|needs? (?:me|my)|approval|cost|spent|spend|budget|while i was away|overnight/.test(q)) return "STATUS_QUERY";
  if (/office|runner|worker/.test(q)) return "OFFICE_QUERY";
  if (/security|vulnerab|attack|auth/.test(q)) return "SECURITY_QUESTION";
  if (/test|\bqa\b|bug/.test(q)) return "QA_QUESTION";
  if (/code|implement|function|typescript|javascript/.test(q)) return "CODING_QUESTION";
  if (/\w/.test(q)) return "GENERAL_CONVERSATION";
  return "UNKNOWN";
}
