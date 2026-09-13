import "server-only";
import type { CommunicationProvider } from "./communication-provider.ts";
import { MockCommunicationProvider } from "./mock-communication-provider.ts";
import { TwilioCommunicationProvider } from "./twilio-communication-provider.ts";

// A single shared mock instance per process so tests/routes that both
// send and later inspect/simulate against it see the same in-memory state.
const sharedMock = new MockCommunicationProvider();

/**
 * `COMMUNICATION_PROVIDER` must be the literal string `"twilio"` to ever
 * select a real provider — its mere presence, or Twilio credentials
 * simply existing in the environment, is never enough (Section H: "If
 * real provider credentials happen to exist, DO NOT place a real
 * call/SMS unless Teja explicitly authorized a real external
 * communication test"). Unset, empty, or any other value is the mock.
 */
export function getCommunicationProvider(): CommunicationProvider {
  if (process.env.COMMUNICATION_PROVIDER !== "twilio") return sharedMock;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("COMMUNICATION_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to be set.");
  }
  return new TwilioCommunicationProvider({ accountSid, authToken, fromNumber, publicBaseUrl: process.env.OFFICE_PUBLIC_BASE_URL });
}

/** Test-only escape hatch to inspect/reset the shared mock's recorded calls/SMS. */
export function getSharedMockProvider(): MockCommunicationProvider {
  return sharedMock;
}
