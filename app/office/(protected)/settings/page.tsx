import type { Metadata } from "next";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getOfficeStatus } from "@/lib/ai-office/domain/office";
import { getBudgetSnapshot } from "@/lib/ai-office/budget/budget-service";
import { isClaudeConfigured } from "@/lib/ai-office/providers/claude/claude-adapter";
import { getEffectiveNotificationPolicy } from "@/lib/ai-office/domain/notification-policy";
import { listRecentEscalations } from "@/lib/ai-office/domain/escalations";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ai-office/action-button";
import { openOfficeAction, closeOfficeAction } from "@/app/office/actions/office";
import { NotificationPolicyForm } from "@/components/ai-office/escalation/notification-policy-form";
import { EscalationHistory } from "@/components/ai-office/escalation/escalation-history";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings — deliberately minimal (Section 40's "do not clutter the
 * interface with developer/debug controls"). Only real, currently
 * owner-controllable state lives here: office open/close (relocated from
 * the top bar so it has one clear home) and read-only visibility into
 * budget/Claude configuration. No API key value, no raw environment
 * dump, no destructive controls.
 */
export default async function SettingsPage() {
  const db = getAppDatabase();
  const officeStatus = getOfficeStatus(db);
  const isOpen = officeStatus?.state === "OPEN";
  const budget = getBudgetSnapshot(db);
  const claudeConfigured = isClaudeConfigured();
  const notificationPolicy = getEffectiveNotificationPolicy(db);
  const escalations = listRecentEscalations(db, 30);
  const phoneConfigured = !!process.env.OWNER_PHONE_NUMBER;
  const communicationProviderName = process.env.COMMUNICATION_PROVIDER === "twilio" ? "Twilio" : "Mock (no real telephony)";
  const communicationProviderConfigured = process.env.COMMUNICATION_PROVIDER === "twilio";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      <GlassCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Office State</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isOpen
                ? "The Office is open — agents may pick up eligible work and paid calls (if any project is configured for them) may proceed."
                : "The Office is closed — all work is preserved, but no new agent or model execution will start."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isOpen ? "default" : "outline"} className="font-mono text-[0.65rem] uppercase">
              {isOpen ? "OPEN" : "CLOSED"}
            </Badge>
            {isOpen ? (
              <ActionButton action={closeOfficeAction} variant="outline" size="sm">
                Close Office
              </ActionButton>
            ) : (
              <ActionButton action={openOfficeAction} variant="outline" size="sm">
                Open Office
              </ActionButton>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Monthly LIVE Budget</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            ${budget.liveSpendUsd.toFixed(2)} spent / ${budget.reservedUsd.toFixed(2)} reserved of ${budget.capUsd.toFixed(2)} cap
          </span>
          <span>${budget.remainingUsd.toFixed(2)} remaining</span>
          <Badge variant={budget.status === "SAFE" ? "secondary" : budget.status === "WARNING" ? "outline" : "destructive"} className="font-mono text-[0.6rem] uppercase">
            {budget.status}
          </Badge>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Claude Configuration</h2>
        <div className="mt-3 flex items-center gap-2">
          <Badge variant={claudeConfigured ? "secondary" : "destructive"} className="font-mono text-[0.6rem] uppercase">
            {claudeConfigured ? "Configured" : "Not configured"}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {claudeConfigured
              ? "A credential and pricing configuration are present on the server."
              : "No ANTHROPIC_API_KEY/pricing configuration is set — Claude-routed roles will show a clean blocked state."}
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          No credential value is ever displayed here, logged, or returned by any API — this is a configuration-presence check only, and never
          makes a billable request.
        </p>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold tracking-tight">Human Escalation</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          When the Office needs your action, it can reach you by call or SMS through this policy. No external message is ever sent unless a
          mode below is explicitly selected — the default is fully in-app.
        </p>
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
        <h2 className="text-sm font-semibold tracking-tight">Escalation History</h2>
        <p className="mt-1 text-xs text-muted-foreground">Every real escalation this office has raised, regardless of channel.</p>
        <div className="mt-4">
          <EscalationHistory escalations={escalations} />
        </div>
      </GlassCard>
    </div>
  );
}
