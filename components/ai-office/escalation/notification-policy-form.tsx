"use client";

import { useActionState, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateNotificationPolicyAction, type NotificationPolicyActionState } from "@/app/office/actions/escalation";
import type { NotificationPolicyRow, NotificationMode } from "@/lib/ai-office/domain/notification-policy";

const initialState: NotificationPolicyActionState = {};

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const inputClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const MODE_DESCRIPTIONS: Record<NotificationMode, string> = {
  OFF: "No call, SMS, or push ever leaves the app. Everything stays visible only inside the Office.",
  IN_APP: "Same as OFF — every escalation stays in-app only, regardless of urgency.",
  SMS: "Routine info stays in-app. Action-required and urgent requests are sent by SMS.",
  CALL_SMS_FALLBACK: "Action-required requests are sent by SMS. Urgent requests get a phone call first, with SMS if the call isn't answered.",
};

export function NotificationPolicyForm({
  policy,
  phoneConfigured,
  providerConfigured,
  providerName,
}: {
  policy: NotificationPolicyRow;
  phoneConfigured: boolean;
  providerConfigured: boolean;
  providerName: string;
}) {
  const [state, formAction, isPending] = useActionState(updateNotificationPolicyAction, initialState);
  const [mode, setMode] = useState<NotificationMode>(policy.mode);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(policy.quietHoursEnabled === 1);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Owner phone:</span>
        <Badge variant={phoneConfigured ? "secondary" : "outline"} className="font-mono text-[0.6rem] uppercase">
          {phoneConfigured ? "Configured" : "Not configured"}
        </Badge>
        <span className="text-muted-foreground">Provider:</span>
        <Badge variant={providerConfigured ? "secondary" : "outline"} className="font-mono text-[0.6rem] uppercase">
          {providerName}
        </Badge>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notification-mode">Notification mode</Label>
        <select
          id="notification-mode"
          name="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as NotificationMode)}
          className={selectClassName}
        >
          <option value="OFF">OFF — in-app only</option>
          <option value="IN_APP">IN-APP ONLY</option>
          <option value="SMS">SMS</option>
          <option value="CALL_SMS_FALLBACK">CALL + SMS FALLBACK</option>
        </select>
        <p className="text-xs text-muted-foreground">{MODE_DESCRIPTIONS[mode]}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Timezone (IANA, e.g. America/Chicago)</Label>
        <input id="timezone" name="timezone" defaultValue={policy.timezone} className={inputClassName} />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="quietHoursEnabled"
          name="quietHoursEnabled"
          checked={quietHoursEnabled}
          onChange={(e) => setQuietHoursEnabled(e.target.checked)}
          className="size-4"
        />
        <Label htmlFor="quietHoursEnabled">Quiet hours (non-urgent requests wait for the app instead of calling/texting)</Label>
      </div>

      {quietHoursEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quietHoursStart">Quiet hours start</Label>
            <input type="time" id="quietHoursStart" name="quietHoursStart" defaultValue={policy.quietHoursStart} className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quietHoursEnd">Quiet hours end</Label>
            <input type="time" id="quietHoursEnd" name="quietHoursEnd" defaultValue={policy.quietHoursEnd} className={inputClassName} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="callWindowStart">Call window start</Label>
          <input type="time" id="callWindowStart" name="callWindowStart" defaultValue={policy.callWindowStart} className={inputClassName} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="callWindowEnd">Call window end</Label>
          <input type="time" id="callWindowEnd" name="callWindowEnd" defaultValue={policy.callWindowEnd} className={inputClassName} />
        </div>
      </div>

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.success && <p className="text-xs text-muted-foreground">Saved.</p>}

      <Button type="submit" size="sm" variant="outline" disabled={isPending} className="w-fit">
        {isPending ? "Saving..." : "Save notification policy"}
      </Button>
    </form>
  );
}
