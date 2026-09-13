import "server-only";

/**
 * The only interface Human Escalation's business logic knows about —
 * Twilio, a mock, or any future vendor (Vonage, Plivo, ...) is an
 * interchangeable implementation of this shape, never referenced by name
 * anywhere outside its own file (Section G/H of the Human Escalation
 * phase).
 */
export interface SendSmsResult {
  providerMessageId: string;
}

export interface PlaceCallResult {
  providerCallId: string;
}

export interface InboundResponse {
  /** The raw sender phone number as the provider reports it — never trusted alone as authorization; only used for logging/audit. */
  from: string;
  /** The free-text body of an inbound SMS, or the DTMF digit pressed on a call, normalized to a plain string. */
  body: string;
}

export interface CommunicationProvider {
  readonly name: string;
  sendSms(to: string, body: string): Promise<SendSmsResult>;
  /** `voiceMessage` is the plain text to speak — the provider implementation owns turning it into TwiML/SSML/etc. */
  placeCall(to: string, voiceMessage: string): Promise<PlaceCallResult>;
  /** Verifies an inbound webhook request genuinely came from this provider (e.g. Twilio's X-Twilio-Signature HMAC) — never trust inbound payloads without this. */
  verifyInboundRequest(input: { headers: Headers; url: string; rawBody: string }): boolean;
  parseInboundResponse(rawBody: string): InboundResponse;
}
