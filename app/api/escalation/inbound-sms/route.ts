import { NextResponse } from "next/server";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { HumanEscalationService } from "@/lib/ai-office/escalation/escalation-service";

/**
 * The one inbound webhook a real SMS provider posts owner replies to.
 * Deliberately NOT gated by `verifySession()` — a webhook has no owner
 * cookie to send — its authenticity instead comes entirely from
 * `CommunicationProvider.verifyInboundRequest()` (Twilio's request
 * signature). See Section D: "Responses must NEVER be trusted solely
 * from caller ID."
 *
 * Security-hardening fix: this route is a 404 unless
 * `COMMUNICATION_PROVIDER=twilio` is explicitly configured. The mock
 * provider's `verifyInboundRequest()` intentionally trusts every
 * payload (there is nothing real to verify in tests) — leaving that
 * true for a publicly reachable route would let anyone attempt to
 * brute-force a pending escalation's response code and approve/reject a
 * real approval with no phone involved at all. The mock provider is
 * only ever meant to be exercised by calling the service directly (see
 * this phase's own tests), never over HTTP.
 *
 * Even with a real provider, `HumanEscalationService.handleInboundResponse`
 * additionally requires the sender to match the configured
 * `OWNER_PHONE_NUMBER` and throttles repeated failed attempts per sender
 * — a valid Twilio signature alone only proves Twilio relayed the
 * message, not that the owner sent it.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.COMMUNICATION_PROVIDER !== "twilio") {
    return new NextResponse(null, { status: 404 });
  }

  const rawBody = await request.text();
  const db = getAppDatabase();
  const service = new HumanEscalationService();

  const result = service.handleInboundResponse(db, { headers: request.headers, url: request.url, rawBody });

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${result.message ? `<Message>${escapeXml(result.message)}</Message>` : ""}</Response>`;
  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
