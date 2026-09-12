import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAppDatabase } from "@/lib/ai-office/db/client";
import { getProjectDetail } from "@/lib/ai-office/dashboard/project-detail-data";
import { getPreviewStatusLabel } from "@/lib/ai-office/dashboard/delivery-status";
import { signPreviewToken } from "@/lib/ai-office/auth/preview-token";
import { readFile } from "@/lib/ai-office/workspace/workspace-service";
import { highlightFileContent } from "@/lib/ai-office/workspace/code-highlight";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ai-office/action-button";
import { TaskFlow } from "@/components/ai-office/dashboard/task-flow";
import { AutoRefresh } from "@/components/ai-office/auto-refresh";
import { FileBrowser, type WorkspaceFileEntry } from "@/components/ai-office/workspace/file-browser";
import { PreviewPanel } from "@/components/ai-office/workspace/preview-panel";
import { ModelPolicyPanel } from "@/components/ai-office/workspace/model-policy-panel";
import { pauseProjectAction, resumeProjectAction } from "@/app/office/actions/projects";
import { checkOllamaHealth } from "@/lib/ai-office/providers/ollama/health";
import { getProjectModelPolicy } from "@/lib/ai-office/domain/model-routing";
import { AGENT_ROLE_CATALOG } from "@/lib/ai-office/domain/agent-role-catalog";

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
  } = detail;
  const canPause = project.status === "IN_PROGRESS";
  const canResume = project.status === "PAUSED";

  const isActive = project.status === "IN_PROGRESS";

  const modelPolicy = project.provider === "ollama" ? getProjectModelPolicy(db, project.id) : null;
  const ollamaHealth = project.provider === "ollama" ? await checkOllamaHealth() : null;
  const routableRoles = AGENT_ROLE_CATALOG.filter((r) => r.id !== "orchestrator").map((r) => ({ id: r.id, name: r.name }));

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
    <div className="flex flex-col gap-6">
      {isActive && <AutoRefresh />}
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
              <Badge
                variant={project.aiPolicyMode === "LOCAL_ONLY" ? "outline" : "default"}
                className="font-mono text-[0.6rem] uppercase"
              >
                AI Policy: {project.aiPolicyMode.replace("_", " ")}
              </Badge>
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
        </div>
      </GlassCard>

      {project.aiPolicyMode !== "LOCAL_ONLY" && (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">AI Provider &amp; Budget</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>
              Project LIVE budget: ${budget.projectLiveSpendUsd.toFixed(2)}/{budget.projectLiveCapUsd != null ? `$${budget.projectLiveCapUsd.toFixed(2)}` : "(no cap)"}
            </span>
            <span>
              Monthly LIVE budget: ${budget.officeMonthlySpendUsd.toFixed(2)}/${budget.officeMonthlyCapUsd.toFixed(2)} · ${budget.officeMonthlyRemainingUsd.toFixed(2)} remaining
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
                  <Badge variant={rp.provider === "claude" ? "default" : "outline"} className="font-mono text-[0.6rem] uppercase">
                    {rp.provider}
                    {rp.model ? ` · ${rp.model}` : ""}
                  </Badge>
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
            <span>Total: ${claudeCosts.totalCostUsd.toFixed(4)} across {claudeCosts.totalCalls} call{claudeCosts.totalCalls === 1 ? "" : "s"}</span>
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
                        <Badge variant="destructive" className="font-mono text-[0.6rem] uppercase" title={`estimated ${call.contextEstimatedInputTokens} / target ${call.contextTargetEstimatedInputTokens} / burst ${call.contextBurstEstimatedInputTokens}`}>
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

      {workspace.hasWorkspace && (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Real Development Workspace</h2>
          <Tabs defaultValue="files" className="mt-4">
            <TabsList>
              <TabsTrigger value="files">Files ({fileEntries.length})</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="files">
              <FileBrowser files={fileEntries} />
            </TabsContent>
            <TabsContent value="preview">
              <PreviewPanel projectId={project.id} status={previewStatus} previewToken={previewToken} />
            </TabsContent>
          </Tabs>
        </GlassCard>
      )}

      {approvals.length > 0 && (
        <GlassCard>
          <h2 className="text-sm font-semibold tracking-tight">Approvals</h2>
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {approvals.map((approval) => (
              <li key={approval.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 last:border-0">
                <Badge variant={approval.status === "PENDING" ? "default" : approval.status === "APPROVED" ? "secondary" : "destructive"}>
                  {approval.status}
                </Badge>
                <span>{approval.kind.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">{approval.taskId ? "task-scoped" : "project-wide"}</span>
              </li>
            ))}
          </ul>
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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
    </div>
  );
}
