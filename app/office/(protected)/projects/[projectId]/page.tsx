import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getProjectDetail } from "@/lib/ai-office/dashboard/project-detail-data";
import { getPendingApprovalsView, getRunnerActivityView } from "@/lib/ai-office/dashboard/dashboard-data";
import { getOfficeFloorView } from "@/lib/ai-office/dashboard/office-floor-data";
import { getPreviewStatusLabel } from "@/lib/ai-office/dashboard/delivery-status";
import { signPreviewToken } from "@/lib/ai-office/auth/preview-token";
import { readFile } from "@/lib/ai-office/workspace/workspace-service";
import { highlightFileContent } from "@/lib/ai-office/workspace/code-highlight";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ai-office/action-button";
import { approveApprovalAction, rejectApprovalAction, revokeApprovalAction } from "@/app/office/actions/approvals";
import { checkRevokeEligibility } from "@/lib/ai-office/approvals/approval-service";
import { getEffectiveApprovalStatus } from "@/lib/ai-office/domain/project-outputs";
import { TaskFlow } from "@/components/ai-office/dashboard/task-flow";
import { AutoRefresh } from "@/components/ai-office/auto-refresh";
import { ProjectPipeline } from "@/components/ai-office/dashboard/project-pipeline";
import { ProjectProgress } from "@/components/ai-office/dashboard/project-progress";
import { CollaborationFeed } from "@/components/ai-office/dashboard/collaboration-feed";
import { FileBrowser, type WorkspaceFileEntry } from "@/components/ai-office/workspace/file-browser";
import { PreviewPanel } from "@/components/ai-office/workspace/preview-panel";
import { ModelPolicyPanel } from "@/components/ai-office/workspace/model-policy-panel";
import { pauseProjectAction, resumeProjectAction } from "@/app/office/actions/projects";
import { checkOllamaHealth } from "@/lib/ai-office/providers/ollama/health";
import { getProjectModelPolicy } from "@/lib/ai-office/domain/model-routing";
import { AGENT_ROLE_CATALOG } from "@/lib/ai-office/domain/agent-role-catalog";
import { ProviderBadge } from "@/components/ai-office/provider-badge";
import { generateReadme } from "@/lib/ai-office/workspace/readme-generator";
import { Download } from "lucide-react";

export const metadata: Metadata = { title: "Project" };

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getAppDatabase();
  const detail = getProjectDetail(db, projectId);
  if (!detail) notFound();

  const {
    project,
    ideaText,
    tasks,
    progress,
    failures,
    decisions,
    artifacts,
    approvals,
    activity,
    memorySummary,
    knownIssues,
    simulatedCostUsd,
    liveCostUsd,
    workspace,
    displayStatusLabel,
    isUnverifiedCompletion,
    isStalledWithNoDeliverable,
    roleProviders,
    budget,
    claudeCosts,
    pipeline,
    collaboration,
  } = detail;
  const canPause = project.status === "IN_PROGRESS";
  const canResume = project.status === "PAUSED";

  const isActive = project.status === "IN_PROGRESS";

  // The one place on this page the owner can actually decide a pending
  // approval — previously this page only ever listed approvals read-only,
  // buried behind a tab that didn't even appear unless clicked, with no
  // Approve/Reject controls anywhere on it (the only real controls lived
  // on the main dashboard's ApprovalsPanel). Reuses the exact same
  // `getPendingApprovalsView` projection and `approveApprovalAction`/
  // `rejectApprovalAction` Server Actions that panel already uses — never
  // a second decision path.
  const pendingApprovalsForProject = getPendingApprovalsView(db).filter((a) => a.projectId === project.id);
  const waitingForOwnerApproval = pendingApprovalsForProject.length > 0;

  // Revoke-approval capability (second Claude LIVE pilot safety gap): an
  // APPROVED decision can be undone, but only for as long as nothing real
  // has happened under it yet — `checkRevokeEligibility` is the single
  // real-state check the Revoke button itself is gated on too, so this
  // page can never offer a control it wouldn't actually be allowed to act on.
  const revocableApprovalIds = new Set(approvals.filter((a) => a.status === "APPROVED" && checkRevokeEligibility(db, a).eligible).map((a) => a.id));
  const hasRevocableApproval = revocableApprovalIds.size > 0;

  // Real system-reliability fix (found during the first Claude LIVE pilot):
  // a project can sit IN_PROGRESS with no pending approval while the
  // standalone runner process simply isn't running — previously this page
  // gave no indication of that at all, and just looked silently stuck. Only
  // surfaced for a project that could otherwise still be making progress —
  // never for one that's paused or already at a terminal state, where an
  // offline runner is irrelevant.
  const NON_ACTIVE_STATUSES = new Set(["PAUSED", "READY_FOR_REVIEW", "APPROVED", "FAILED", "ARCHIVED", "DRAFT"]);
  const runnerActivity = getRunnerActivityView(db);
  const runnerOfflineBlockingProgress = !NON_ACTIVE_STATUSES.has(project.status) && !waitingForOwnerApproval && runnerActivity.runnerStatus === "OFFLINE";

  const modelPolicy = project.provider === "ollama" ? getProjectModelPolicy(db, project.id) : null;
  const ollamaHealth = project.provider === "ollama" ? await checkOllamaHealth() : null;
  const routableRoles = AGENT_ROLE_CATALOG.filter((r) => r.id !== "orchestrator").map((r) => ({ id: r.id, name: r.name }));
  const projectAgents = getOfficeFloorView(db, project.id).agents;

  const workspaceFilePaths = workspace.files.map((f) => f.path);
  const hasOwnReadme = workspaceFilePaths.some((p) => p.toLowerCase() === "readme.md");
  const generatedReadme = workspace.hasWorkspace
    ? hasOwnReadme
      ? await readFile(project.id, workspace.files.find((f) => f.path.toLowerCase() === "readme.md")!.path)
      : generateReadme({ projectTitle: project.title, ideaText, files: workspaceFilePaths })
    : null;
  const workspaceTotalBytes = workspace.files.reduce((sum, f) => sum + f.sizeBytes, 0);

  const hasIndexHtml = workspace.files.some((f) => f.path === "index.html");
  const previewStatus = getPreviewStatusLabel(workspace.hasWorkspace, workspace.deliveryState, hasIndexHtml);
  const previewToken = previewStatus === "PREVIEW READY" ? await signPreviewToken(project.id) : null;
  const fileEntries: WorkspaceFileEntry[] = workspace.hasWorkspace
    ? await Promise.all(
        workspace.files.map(async (file) => {
          const content = await readFile(project.id, file.path);
          return {
            path: file.path,
            sizeBytes: file.sizeBytes,
            lastModifiedByRoleId: file.lastModifiedByRoleId,
            html: await highlightFileContent(file.path, content),
          };
        }),
      )
    : [];

  return (
    <div className="flex flex-col gap-4">
      {isActive && <AutoRefresh />}

      {/* ---- Project header (Section 22) — always visible ---- */}
      <GlassCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{project.title}</h1>
              <Badge variant={isStalledWithNoDeliverable ? "destructive" : isUnverifiedCompletion ? "outline" : "default"}>{displayStatusLabel}</Badge>
              <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                {project.aiMode}
              </Badge>
              <Badge variant="secondary" className="font-mono text-[0.6rem] uppercase">
                {project.provider}
              </Badge>
              <Badge variant={project.aiPolicyMode === "LOCAL_ONLY" ? "outline" : "default"} className="font-mono text-[0.6rem] uppercase">
                AI Policy: {project.aiPolicyMode.replace("_", " ")}
              </Badge>
              {waitingForOwnerApproval && (
                <Badge variant="destructive" className="animate-pulse font-mono text-[0.6rem] uppercase">
                  Waiting for your approval
                </Badge>
              )}
              {runnerOfflineBlockingProgress && (
                <Badge variant="destructive" className="font-mono text-[0.6rem] uppercase">
                  Runner offline
                </Badge>
              )}
              {hasRevocableApproval && (
                <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                  Claude authorized — revocable
                </Badge>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{ideaText}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Created {formatDate(project.createdAt)} · Updated {formatDate(project.updatedAt)}
            </p>
          </div>
          {(canPause || canResume) && (
            <div className="flex gap-2">
              {canPause && (
                <ActionButton action={pauseProjectAction.bind(null, project.id)} variant="outline" size="sm" successMessage="Project paused.">
                  Pause
                </ActionButton>
              )}
              {canResume && (
                <ActionButton action={resumeProjectAction.bind(null, project.id)} variant="outline" size="sm" successMessage="Project resumed.">
                  Resume
                </ActionButton>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            Progress: {progress.completed}/{progress.total} tasks
          </span>
          <span>Simulated cost: ${simulatedCostUsd.toFixed(2)}</span>
          <span>LIVE cost: ${liveCostUsd.toFixed(2)}</span>
          {waitingForOwnerApproval && (
            <span className="font-medium text-destructive">
              Work is paused — {pendingApprovalsForProject.length} decision{pendingApprovalsForProject.length === 1 ? "" : "s"} needed below before the
              runner can continue.
            </span>
          )}
          {runnerOfflineBlockingProgress && (
            <span className="font-medium text-destructive">Runner offline — projects cannot progress. Start it with `npm run ai-office:runner`.</span>
          )}
        </div>

        <div className="mt-4 overflow-x-auto pb-1">
          <ProjectPipeline stages={pipeline} />
        </div>
      </GlassCard>

      {/* ---- Owner approval — prominent, above the fold, with real Approve/Reject controls ----
          Previously the only approval UI on this page was a read-only list buried behind an
          "Approvals" tab that never even had Approve/Reject buttons. Reuses the exact same
          approveApprovalAction/rejectApprovalAction Server Actions the main dashboard's
          ApprovalsPanel already uses — never a second decision path. */}
      {pendingApprovalsForProject.length > 0 && (
        <GlassCard className="border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2">
            <Badge variant="destructive">Action needed</Badge>
            <h2 className="text-sm font-semibold tracking-tight">Waiting for your approval</h2>
          </div>
          <ul className="mt-3 flex flex-col gap-4">
            {pendingApprovalsForProject.map((approval) => {
              const roleName = approval.roleId ? (AGENT_ROLE_CATALOG.find((r) => r.id === approval.roleId)?.name ?? approval.roleId) : null;
              return (
                <li key={approval.id} className="rounded-xl border border-border/60 bg-background/60 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {approval.provider && (
                      <Badge variant="outline" className="font-mono uppercase">
                        Provider: {approval.provider}
                      </Badge>
                    )}
                    {roleName && (
                      <Badge variant="secondary" className="font-mono uppercase">
                        Agent: {roleName}
                      </Badge>
                    )}
                  </div>
                  {approval.reason && <p className="mt-2 text-sm">{approval.reason}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Project LIVE spend: ${budget.projectLiveSpendUsd.toFixed(2)}/
                      {budget.projectLiveCapUsd != null ? `$${budget.projectLiveCapUsd.toFixed(2)}` : "(no cap)"}
                    </span>
                    <span>
                      Monthly LIVE spend: ${budget.officeMonthlySpendUsd.toFixed(2)}/${budget.officeMonthlyCapUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <ActionButton
                      action={approveApprovalAction.bind(null, approval.id)}
                      size="sm"
                      successMessage="Approved."
                      confirmMessage="Approve this action? Only this exact request becomes eligible to proceed."
                    >
                      Approve
                    </ActionButton>
                    <ActionButton
                      action={rejectApprovalAction.bind(null, approval.id)}
                      variant="outline"
                      size="sm"
                      successMessage="Rejected."
                      confirmMessage="Reject this action? It will remain blocked."
                    >
                      Reject
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </GlassCard>
      )}

      {/* ---- Everything else, organized into tabs (Section 21) ---- */}
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          {approvals.length > 0 && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
          {(project.aiPolicyMode !== "LOCAL_ONLY" || claudeCosts.totalCalls > 0) && <TabsTrigger value="cost">AI Cost &amp; Context</TabsTrigger>}
          <TabsTrigger value="technical">Technical Details</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <GlassCard>
            <h2 className="text-sm font-semibold tracking-tight">Project Progress</h2>
            <div className="mt-3">
              <ProjectProgress agents={projectAgents} />
            </div>
          </GlassCard>
          <CollaborationFeed entries={collaboration} />
        </TabsContent>

        <TabsContent value="workspace" className="flex flex-col gap-4">
          <GlassCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-tight">Real Development Workspace</h2>
              {workspace.hasWorkspace && (
                <a
                  href={`/office/download/${project.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <Download className="size-3.5" />
                  Download ZIP
                </a>
              )}
            </div>
            {workspace.hasWorkspace ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Delivery: <span className="font-mono uppercase text-foreground">{workspace.deliveryState ?? "—"}</span>
                  </span>
                  <span>{fileEntries.length} file(s)</span>
                  <span>{(workspaceTotalBytes / 1024).toFixed(1)} KB total</span>
                </div>
                <div className="mt-4">
                  <FileBrowser files={fileEntries} />
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No workspace yet — real files appear once a development role writes its first output.</p>
            )}
          </GlassCard>

          {generatedReadme && (
            <GlassCard>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight">README{hasOwnReadme ? "" : " (auto-generated preview)"}</h2>
              </div>
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted/50 p-4 text-xs whitespace-pre-wrap">{generatedReadme}</pre>
            </GlassCard>
          )}
        </TabsContent>

        <TabsContent value="preview">
          <GlassCard>
            <h2 className="text-sm font-semibold tracking-tight">Final Product Preview</h2>
            <div className="mt-4">
              <PreviewPanel projectId={project.id} status={previewStatus} previewToken={previewToken} />
            </div>
          </GlassCard>
        </TabsContent>

        <TabsContent value="activity" className="flex flex-col gap-4">
          <GlassCard>
            <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
            {activity.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-xs">
                {activity.map((entry) => (
                  <li key={entry.id} className="border-b border-border/40 pb-2 last:border-0">
                    {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </TabsContent>

        {approvals.length > 0 && (
          <TabsContent value="approvals">
            <GlassCard>
              <h2 className="text-sm font-semibold tracking-tight">Approvals</h2>
              <ul className="mt-3 flex flex-col gap-2 text-xs">
                {approvals.map((approval) => {
                  const effectiveStatus = getEffectiveApprovalStatus(approval);
                  const revocable = revocableApprovalIds.has(approval.id);
                  return (
                    <li key={approval.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 last:border-0">
                      <Badge variant={effectiveStatus === "PENDING" ? "default" : effectiveStatus === "APPROVED" ? "secondary" : "destructive"}>
                        {effectiveStatus}
                      </Badge>
                      {approval.kind === "paid_service_purchase" && (
                        <Badge variant="outline" className="font-mono text-[0.55rem] uppercase">
                          Paid AI
                        </Badge>
                      )}
                      <span>{approval.kind.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">{approval.taskId ? "task-scoped" : "project-wide"}</span>
                      {revocable && (
                        <ActionButton
                          action={revokeApprovalAction.bind(null, approval.id)}
                          variant="outline"
                          size="sm"
                          successMessage="Approval revoked."
                          confirmMessage="Revoke this approval? The paid action will remain blocked until you approve a new request."
                        >
                          Revoke
                        </ActionButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </GlassCard>
          </TabsContent>
        )}

        {(project.aiPolicyMode !== "LOCAL_ONLY" || claudeCosts.totalCalls > 0) && (
          <TabsContent value="cost" className="flex flex-col gap-4">
            {project.aiPolicyMode !== "LOCAL_ONLY" && (
              <GlassCard>
                <h2 className="text-sm font-semibold tracking-tight">AI Provider &amp; Budget</h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Project LIVE budget: ${budget.projectLiveSpendUsd.toFixed(2)}/
                    {budget.projectLiveCapUsd != null ? `$${budget.projectLiveCapUsd.toFixed(2)}` : "(no cap)"}
                  </span>
                  <span>
                    Monthly LIVE budget: ${budget.officeMonthlySpendUsd.toFixed(2)}/${budget.officeMonthlyCapUsd.toFixed(2)} · $
                    {budget.officeMonthlyRemainingUsd.toFixed(2)} remaining
                  </span>
                  <Badge variant={budget.claudeConfigured ? "secondary" : "destructive"} className="font-mono text-[0.6rem] uppercase">
                    Claude {budget.claudeConfigured ? "configured" : "not configured"}
                  </Badge>
                </div>
                {roleProviders.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 text-xs">
                    {roleProviders.map((rp) => (
                      <li key={rp.roleId} className="flex items-center gap-2">
                        <span className="font-medium">{rp.roleName}</span>
                        <ProviderBadge provider={rp.provider} model={rp.model} />
                      </li>
                    ))}
                  </ul>
                )}
              </GlassCard>
            )}

            {claudeCosts.totalCalls > 0 && (
              <GlassCard>
                <h2 className="text-sm font-semibold tracking-tight">Claude Cost &amp; Context</h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Total: ${claudeCosts.totalCostUsd.toFixed(4)} across {claudeCosts.totalCalls} call{claudeCosts.totalCalls === 1 ? "" : "s"}
                  </span>
                  <span>Paid retries: {claudeCosts.paidRetries}</span>
                  <span>Avg call: ${claudeCosts.averageCallCostUsd.toFixed(4)}</span>
                  <span>Cost/completed task: ${claudeCosts.costPerCompletedPaidTask.toFixed(4)}</span>
                  <span>Largest prompt: {claudeCosts.largestPromptTokens.toLocaleString()} tok</span>
                  <span>Largest output: {claudeCosts.largestOutputTokens.toLocaleString()} tok</span>
                  {claudeCosts.callsUsingBurstAllowance > 0 && (
                    <Badge variant="destructive" className="font-mono text-[0.6rem] uppercase">
                      {claudeCosts.callsUsingBurstAllowance} call{claudeCosts.callsUsingBurstAllowance === 1 ? "" : "s"} used burst allowance
                    </Badge>
                  )}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="pb-1 pr-3 font-normal">Role</th>
                        <th className="pb-1 pr-3 font-normal">Task</th>
                        <th className="pb-1 pr-3 font-normal">Model</th>
                        <th className="pb-1 pr-3 font-normal">Input</th>
                        <th className="pb-1 pr-3 font-normal">Output</th>
                        <th className="pb-1 pr-3 font-normal">Cache R/W</th>
                        <th className="pb-1 pr-3 font-normal">Files</th>
                        <th className="pb-1 pr-3 font-normal">Budget</th>
                        <th className="pb-1 font-normal">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claudeCosts.calls.map((call) => (
                        <tr key={call.agentRunId} className="border-t border-border/40">
                          <td className="py-1 pr-3">{call.roleName ?? call.roleId ?? "—"}</td>
                          <td className="max-w-[180px] truncate py-1 pr-3" title={call.taskTitle ?? undefined}>
                            {call.taskTitle ?? "—"}
                          </td>
                          <td className="py-1 pr-3 font-mono">{call.model ?? "—"}</td>
                          <td className="py-1 pr-3">{call.inputTokens.toLocaleString()}</td>
                          <td className="py-1 pr-3">{call.outputTokens.toLocaleString()}</td>
                          <td className="py-1 pr-3">
                            {call.cacheReadInputTokens != null || call.cacheCreationInputTokens != null
                              ? `${call.cacheReadInputTokens ?? 0}/${call.cacheCreationInputTokens ?? 0}`
                              : "—"}
                          </td>
                          <td className="py-1 pr-3">
                            {call.contextFilesSelected != null ? `${call.contextFilesSelected} sel · ${call.contextFilesExcluded ?? 0} excl` : "—"}
                          </td>
                          <td className="py-1 pr-3">
                            {call.contextBurstWarning ? (
                              <Badge
                                variant="destructive"
                                className="font-mono text-[0.6rem] uppercase"
                                title={`estimated ${call.contextEstimatedInputTokens} / target ${call.contextTargetEstimatedInputTokens} / burst ${call.contextBurstEstimatedInputTokens}`}
                              >
                                burst
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">ok</span>
                            )}
                          </td>
                          <td className="py-1">${call.costUsd.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            )}
          </TabsContent>
        )}

        <TabsContent value="technical" className="flex flex-col gap-4">
          <GlassCard>
            <h2 className="text-sm font-semibold tracking-tight">
              Task Graph <span className="font-normal text-muted-foreground">· {tasks.length} steps</span>
            </h2>
            <div className="mt-4">
              <TaskFlow tasks={tasks} />
            </div>
          </GlassCard>

          {project.provider === "ollama" && modelPolicy && (
            <GlassCard>
              <h2 className="text-sm font-semibold tracking-tight">Local Model Routing</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {ollamaHealth?.online
                  ? `Ollama online · ${ollamaHealth.models.length} model${ollamaHealth.models.length === 1 ? "" : "s"} installed.`
                  : "Ollama appears offline — routing will fail honestly until it's reachable."}
              </p>
              <div className="mt-4 max-w-md">
                <ModelPolicyPanel
                  projectId={project.id}
                  availableModels={ollamaHealth?.models ?? []}
                  initialMode={modelPolicy.mode}
                  initialSingleModel={modelPolicy.singleModel}
                  initialCustomMapping={modelPolicy.customMapping}
                  roles={routableRoles}
                />
              </div>
            </GlassCard>
          )}

          {failures.length > 0 && (
            <GlassCard>
              <h2 className="text-sm font-semibold tracking-tight text-destructive">Unresolved Failures</h2>
              <ul className="mt-3 flex flex-col gap-2 text-xs">
                {failures.map((failure) => (
                  <li key={failure.id} className="border-b border-border/40 pb-2 last:border-0">
                    {failure.reason}
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <GlassCard>
              <h2 className="text-sm font-semibold tracking-tight">Decisions</h2>
              {decisions.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No decisions recorded yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2.5 text-xs">
                  {decisions.map((decision) => (
                    <li key={decision.id} className="border-b border-border/40 pb-2.5 last:border-0">
                      <p className="font-medium">{decision.summary}</p>
                      {decision.rationale && <p className="mt-0.5 text-muted-foreground">{decision.rationale}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>

            <GlassCard>
              <h2 className="text-sm font-semibold tracking-tight">Artifacts</h2>
              {artifacts.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No artifacts produced yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2.5 text-xs">
                  {artifacts.map((artifact) => (
                    <li key={artifact.id} className="border-b border-border/40 pb-2.5 last:border-0">
                      <p className="font-medium">
                        {artifact.type} <span className="text-muted-foreground">v{artifact.version}</span>
                      </p>
                      <p className="mt-0.5 text-muted-foreground">{artifact.preview}</p>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </div>

          <GlassCard>
            <h2 className="text-sm font-semibold tracking-tight">Project Memory</h2>
            {memorySummary ? (
              <>
                <p className="mt-3 text-sm text-muted-foreground">{memorySummary}</p>
                {knownIssues.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                    {knownIssues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No memory recorded yet — memory builds up once the first task finishes.</p>
            )}
          </GlassCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
