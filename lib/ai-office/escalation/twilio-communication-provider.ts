import "server-only";
import { createHmac } from "node:crypto";
import type { CommunicationProvider, SendSmsResult, PlaceCallResult, InboundResponse } from "./communication-provider.ts";

/**
 * A real (if minimal) Twilio REST implementation — plain `fetch` against
 * Twilio's documented HTTP API rather than adding the `twilio` SDK as a
 * dependency for a provider this phase never actually invokes (Section
 * G/H: "Do NOT hardwire business logic to one vendor" + "Do not require
 * a real telephony account to complete this phase"). Selecting this
 * provider requires an explicit `COMMUNICATION_PROVIDER=twilio` — see
 * `provider-factory.ts`, which defaults to the mock provider otherwise
 * even if Twilio credentials happen to be present in the environment.
 */
interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /** The public base URL Twilio should call back for call-response TwiML — required only for `placeCall`. */
  publicBaseUrl?: string;
}

export class TwilioCommunicationProvider implements CommunicationProvider {
  readonly name = "twilio";
  private readonly config: TwilioConfig;

  constructor(config: TwilioConfig) {
    this.config = config;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString("base64")}`;
  }

  async sendSms(to: string, body: string): Promise<SendSmsResult> {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: this.authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: this.config.fromNumber, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio sendSms failed: HTTP ${res.status}`);
    const data = (await res.json()) as { sid: string };
    return { providerMessageId: data.sid };
  }

  async placeCall(to: string, voiceMessage: string): Promise<PlaceCallResult> {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" action="${this.config.publicBaseUrl ?? ""}/api/escalation/inbound-call-response" method="POST"><Say>${escapeXml(voiceMessage)}</Say></Gather><Say>No response received. Goodbye.</Say></Response>`;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: this.authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: this.config.fromNumber, Twiml: twiml }),
    });
    if (!res.ok) throw new Error(`Twilio placeCall failed: HTTP ${res.status}`);
    const data = (await res.json()) as { sid: string };
    return { providerCallId: data.sid };
  }

  /** Twilio's documented request-signing scheme: HMAC-SHA1(authToken, url + sorted-concatenated-POST-params), base64, compared to X-Twilio-Signature. */
  verifyInboundRequest(input: { headers: Headers; url: string; rawBody: string }): boolean {
    const signature = input.headers.get("x-twilio-signature");
    if (!signature) return false;
    const params = new URLSearchParams(input.rawBody);
    const sortedKeys = Array.from(params.keys()).sort();
    let data = input.url;
    for (const key of sortedKeys) data += key + params.get(key);
    const expected = createHmac("sha1", this.config.authToken).update(data, "utf8").digest("base64");
    return timingSafeEqualString(expected, signature);
  }

  parseInboundResponse(rawBody: string): InboundResponse {
    const params = new URLSearchParams(rawBody);
    const from = params.get("From") ?? "unknown";
    const digits = params.get("Digits");
    if (digits) {
      const menu: Record<string, string> = { "1": "APPROVE", "2": "REJECT", "3": "DETAILS" };
      return { from, body: menu[digits] ?? digits };
    }
    return { from, body: (params.get("Body") ?? "").trim() };
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
