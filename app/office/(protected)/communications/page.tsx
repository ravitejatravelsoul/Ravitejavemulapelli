import type { Metadata } from "next";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getEffectiveNotificationPolicy } from "@/lib/ai-office/domain/notification-policy";
import { listRecentEscalations } from "@/lib/ai-office/domain/escalations";
import { getPendingApprovalsView } from "@/lib/ai-office/dashboard/dashboard-data";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { NotificationPolicyForm } from "@/components/ai-office/escalation/notification-policy-form";
import { EscalationHistory } from "@/components/ai-office/escalation/escalation-history";

export const metadata: Metadata = { title: "Communications" };

/**
 * Communications / Teja Assistant Center (platform-hardening phase,
 * Part 12) — the owner reported that Human Escalation and Teja Assistant
 * "already exist technically, but are not visible enough as a
 * first-class feature." Every piece of data here already existed and
 * was real (`NotificationPolicyForm`/`EscalationHistory`, previously
 * only reachable buried inside Settings) — this page's job is
 * discoverability and honest framing, not new backend capability. It
 * never fakes a channel's readiness: a channel not configured says so
 * plainly, and a channel that IS configured is never claimed to be more
 * than what it actually is (Teja Assistant chat is deterministic
 * pattern-matching, not a real reasoning model — see intent-parser.ts).
 */
export default async function CommunicationsPage() {
  const db = getAppDatabase();
  const notificationPolicy = getEffectiveNotificationPolicy(db);
  const escalations = listRecentEscalations(db, 30);
  const pendingApprovals = getPendingApprovalsView(db);
  const phoneConfigured = !!process.env.OWNER_PHONE_NUMBER;
  const communicationProviderName = process.env.COMMUNICATION_PROVIDER === "twilio" ? "Twilio" : "Mock (no real telephony)";
  const communicationProviderConfigured = process.env.COMMUNICATION_PROVIDER === "twilio";
  const voiceCallReady = communicationProviderConfigured && phoneConfigured;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Communications</h1>
        <p className="mt-1 text-sm text-muted-foreground">How the Office reaches you, and how you can reach it back — every channel&apos;s real, current status.</p>
      </div>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Channels</h2>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 p-3">
            <Badge variant="secondary" className="font-mono text-[0.6rem] uppercase">
              In-App
            </Badge>
            <span className="text-sm font-medium">Teja Assistant</span>
            <Badge variant="secondary" className="ml-auto font-mono text-[0.6rem] uppercase">
              Ready
            </Badge>
            <p className="w-full text-xs text-muted-foreground">
              Deterministic pattern-matched chat over your real office data — always available, free, and never a real AI reasoning model
              itself.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 p-3">
            <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
              SMS
            </Badge>
            <span className="text-sm font-medium">Text message escalation</span>
            <Badge variant={communicationProviderConfigured ? "secondary" : "destructive"} className="ml-auto font-mono text-[0.6rem] uppercase">
              {communicationProviderConfigured ? "Ready" : "Not configured"}
            </Badge>
            <p className="w-full text-xs text-muted-foreground">
              Provider: {communicationProviderName}.{" "}
              {communicationProviderConfigured
                ? "Real SMS can be sent for urgent decisions, subject to your quiet-hours policy below."
                : "Set COMMUNICATION_PROVIDER=twilio and the Twilio credentials to enable — until then, escalations stay in-app only."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 p-3">
            <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
              Call
            </Badge>
            <span className="text-sm font-medium">Phone call escalation</span>
            <Badge variant={voiceCallReady ? "secondary" : "destructive"} className="ml-auto font-mono text-[0.6rem] uppercase">
              {voiceCallReady ? "Ready" : "Not configured"}
            </Badge>
            <p className="w-full text-xs text-muted-foreground">
              {voiceCallReady
                ? "A real call can be placed for URGENT decisions within your call window; if it goes unanswered, it falls back to SMS automatically."
                : !communicationProviderConfigured
                  ? "Requires the SMS provider above to be configured first."
                  : "Requires OWNER_PHONE_NUMBER to be set."}
            </p>
          </div>
        </div>
      </GlassCard>

      {pendingApprovals.length > 0 && (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Pending owner decisions</h2>
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {pendingApprovals.map((a) => (
              <li key={a.id} className="border-b border-border/40 pb-2 last:border-0">
                <span className="font-medium">{a.projectTitle ?? "Unknown project"}</span> — {a.scopeLabel}
                {a.reason && <p className="mt-0.5 text-muted-foreground">{a.reason}</p>}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Escalation policy — quiet hours &amp; call window</h2>
        <div className="mt-4">
          <NotificationPolicyForm
            policy={notificationPolicy}
            phoneConfigured={phoneConfigured}
            providerConfigured={communicationProviderConfigured}
            providerName={communicationProviderName}
          />
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Recent communications</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every real escalation this office has raised — channel shown as attempted, e.g. &quot;CALL → SMS&quot; means a call went unanswered and fell
          back to text.
        </p>
        <div className="mt-4">
          <EscalationHistory escalations={escalations} />
        </div>
      </GlassCard>
    </div>
  );
}
