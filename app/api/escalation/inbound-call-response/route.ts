import { NextResponse } from "next/server";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { HumanEscalationService } from "@/lib/ai-office/escalation/escalation-service";

/**
 * The Twilio `<Gather action=...>` callback for a phone-call DTMF
 * response — previously missing entirely (external review's Defect 1),
 * which meant press-1/2/3 phone approval could never actually complete:
 * `TwilioCommunicationProvider.placeCall` pointed here, but nothing was
 * listening.
 *
 * Identifies the exact escalation purely from the opaque, single-use
 * `?token=` query parameter the escalation service embedded in this
 * exact callback URL when it placed the call (see
 * `HumanEscalationService.placeCallForEscalation`) — never from caller
 * ID, and never by repurposing the SMS response code (a keypress can't
 * carry a typed alphanumeric code). See `HumanEscalationService.
 * handleCallResponse` for the full verification chain: Twilio signature
 * → per-sender throttle → token lookup → owner-number cross-check.
 *
 * Same security-hardening gate as the other two escalation webhooks: a
 * 404 unless a real provider is configured, since the mock provider's
 * `verifyInboundRequest()` intentionally trusts everything (there is
 * nothing real to verify in tests).
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.COMMUNICATION_PROVIDER !== "twilio") {
    return new NextResponse(null, { status: 404 });
  }

  const rawBody = await request.text();
  const db = getAppDatabase();
  const service = new HumanEscalationService();

  const result = service.handleCallResponse(db, { headers: request.headers, url: request.url, rawBody });

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(result.message)}</Say></Response>`;
  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
