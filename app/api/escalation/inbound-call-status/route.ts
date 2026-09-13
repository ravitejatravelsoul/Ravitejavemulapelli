import { NextResponse } from "next/server";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { HumanEscalationService } from "@/lib/ai-office/escalation/escalation-service";
import { getCommunicationProvider } from "@/lib/ai-office/escalation/provider-factory";

const STATUS_MAP: Record<string, "answered" | "no-answer" | "busy" | "failed"> = {
  completed: "answered",
  "no-answer": "no-answer",
  busy: "busy",
  failed: "failed",
  canceled: "failed",
};

/**
 * Twilio's call-status callback — fires once the call itself resolves
 * (answered, no answer, busy, failed), independent of and prior to any
 * DTMF response (that arrives via `inbound-sms` instead). Drives the
 * real call→SMS fallback (Section D/E) through the exact same
 * `handleCallStatusUpdate` a test can call directly.
 *
 * Same security-hardening gate as `inbound-sms`: a 404 unless a real
 * provider is configured, plus real signature verification even then —
 * an unauthenticated caller must never be able to fabricate a
 * "no-answer" for a call that's actually still ringing and force an
 * early SMS fallback.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.COMMUNICATION_PROVIDER !== "twilio") {
    return new NextResponse(null, { status: 404 });
  }

  const rawBody = await request.text();
  const provider = getCommunicationProvider();
  if (!provider.verifyInboundRequest({ headers: request.headers, url: request.url, rawBody })) {
    return new NextResponse(null, { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const callSid = params.get("CallSid");
  const callStatus = params.get("CallStatus");

  if (callSid && callStatus && STATUS_MAP[callStatus]) {
    const db = getAppDatabase();
    await new HumanEscalationService().handleCallStatusUpdate(db, callSid, STATUS_MAP[callStatus]);
  }

  return new NextResponse(null, { status: 204 });
}
