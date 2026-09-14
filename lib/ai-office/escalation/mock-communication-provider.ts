import "server-only";
import { randomUUID } from "node:crypto";
import type { CommunicationProvider, SendSmsResult, PlaceCallResult, InboundResponse, InboundCallResponse } from "./communication-provider.ts";

export interface MockSentSms {
  to: string;
  body: string;
  providerMessageId: string;
}
export interface MockPlacedCall {
  to: string;
  voiceMessage: string;
  providerCallId: string;
  callbackToken: string;
}

/**
 * A fully in-memory provider that proves the entire Human Escalation
 * flow end-to-end without any telephony account, real network call, or
 * cost (Section H) — the default provider (`COMMUNICATION_PROVIDER`
 * unset or `mock`), and the only one this phase's own tests ever
 * exercise. Nothing here ever leaves the process.
 */
export class MockCommunicationProvider implements CommunicationProvider {
  readonly name = "mock";
  readonly sentSms: MockSentSms[] = [];
  readonly placedCalls: MockPlacedCall[] = [];

  async sendSms(to: string, body: string): Promise<SendSmsResult> {
    const providerMessageId = `mock-sms-${randomUUID()}`;
    this.sentSms.push({ to, body, providerMessageId });
    return { providerMessageId };
  }

  async placeCall(to: string, voiceMessage: string, callbackToken: string): Promise<PlaceCallResult> {
    const providerCallId = `mock-call-${randomUUID()}`;
    this.placedCalls.push({ to, voiceMessage, providerCallId, callbackToken });
    return { providerCallId };
  }

  /** The mock trusts every inbound payload it's handed (there is no real signature to check) — real providers (Twilio) implement genuine verification instead. */
  verifyInboundRequest(): boolean {
    return true;
  }

  parseInboundResponse(rawBody: string): InboundResponse {
    const params = new URLSearchParams(rawBody);
    return { from: params.get("From") ?? "unknown", body: (params.get("Body") ?? "").trim() };
  }

  parseInboundCallResponse(rawBody: string): InboundCallResponse {
    const params = new URLSearchParams(rawBody);
    return { from: params.get("From") ?? "unknown", to: params.get("To") ?? "unknown", digit: params.get("Digits") };
  }

  reset(): void {
    this.sentSms.length = 0;
    this.placedCalls.length = 0;
  }
}
