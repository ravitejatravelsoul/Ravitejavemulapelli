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
  /** The raw sender phone number as the provider reports it — never trusted alone as authorization on its own; callers must still normalize and compare it to the configured owner number before acting on it. */
  from: string;
  /** The free-text body of an inbound SMS, normalized to a plain string. */
  body: string;
}

export interface InboundCallResponse {
  /** The number that answered the outbound call, as the provider reports it. */
  from: string;
  /** The number that was dialed (should always be the owner's configured number) — a defense-in-depth cross-check independent of the call token itself. */
  to: string;
  /** The single DTMF digit pressed, if any. */
  digit: string | null;
}

export interface CommunicationProvider {
  readonly name: string;
  sendSms(to: string, body: string): Promise<SendSmsResult>;
  /**
   * `voiceMessage` is the plain text to speak — the provider implementation
   * owns turning it into TwiML/SSML/etc. `callbackToken` is an opaque,
   * single-use, escalation-scoped token the provider must embed in
   * whatever URL it calls back to report the caller's keypress (e.g.
   * Twilio's `<Gather action=...>`) — this is what lets the callback
   * route identify the exact escalation without trusting caller ID
   * (Defect 1).
   */
  placeCall(to: string, voiceMessage: string, callbackToken: string): Promise<PlaceCallResult>;
  /** Verifies an inbound webhook request genuinely came from this provider (e.g. Twilio's X-Twilio-Signature HMAC) — never trust inbound payloads without this. */
  verifyInboundRequest(input: { headers: Headers; url: string; rawBody: string }): boolean;
  parseInboundResponse(rawBody: string): InboundResponse;
  /** Parses an inbound call-response (DTMF) callback — kept separate from `parseInboundResponse` since the wire format/field names for a call callback are provider-specific and unrelated to SMS body parsing. */
  parseInboundCallResponse(rawBody: string): InboundCallResponse;
}
