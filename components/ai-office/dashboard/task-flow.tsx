import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ai-office/action-button";
import { retryTaskAction } from "@/app/office/actions/tasks";
import type { TaskDetailView } from "@/lib/ai-office/dashboard/project-detail-data";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  IN_PROGRESS: "default",
  DONE: "secondary",
  BLOCKED: "destructive",
};

/**
 * A dependency/timeline view built from cards + simple connectors, per
 * the Phase 6 brief's "no giant graph library" — tasks are grouped into
 * waves by dependency depth (every task in a wave depends only on tasks
 * in earlier waves), rendered left-to-right on desktop and stacked on
 * mobile, with a plain chevron standing in for an edge. Good enough for
 * this system's small, single-digit task counts; not a general-purpose
 * DAG layout.
 */
function computeWaves(tasks: TaskDetailView[]): TaskDetailView[][] {
  const depthById = new Map<string, number>();
  const byId = new Map(tasks.map((task) => [task.id, task]));

  function depthOf(taskId: string, seen: Set<string>): number {
    if (depthById.has(taskId)) return depthById.get(taskId)!;
    if (seen.has(taskId)) return 0; // defensive — a validated plan never actually cycles
    seen.add(taskId);
    const task = byId.get(taskId);
    const deps = task?.dependsOnTaskIds ?? [];
    const depth = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => depthOf(d, seen)));
    depthById.set(taskId, depth);
    return depth;
  }

  for (const task of tasks) depthOf(task.id, new Set());

  const maxDepth = Math.max(0, ...tasks.map((task) => depthById.get(task.id) ?? 0));
  const waves: TaskDetailView[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const task of tasks) waves[depthById.get(task.id) ?? 0].push(task);
  return waves;
}

function TaskCard({ task, step }: { task: TaskDetailView; step: number }) {
  return (
    <div className="w-full shrink-0 rounded-xl border border-border/60 p-3 sm:w-56">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold">
          <span className="text-muted-foreground">{step}.</span> {task.roleName}
        </p>
        <Badge variant={STATUS_VARIANT[task.status] ?? "outline"} className="shrink-0">
          {task.status.replace(/_/g, " ")}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.title}</p>
      <p className="mt-1.5 text-[0.65rem] text-muted-foreground">
        Attempts: {task.attemptCount}
        {task.testResults.length > 0 && ` · Latest test: ${task.testResults[task.testResults.length - 1].status}`}
      </p>
      {task.reopenedNote && <p className="mt-1.5 text-[0.65rem] font-medium text-amber-600 dark:text-amber-400">{task.reopenedNote}</p>}
      {task.status === "BLOCKED" && (
        <ActionButton
          action={retryTaskAction.bind(null, task.id)}
          variant="outline"
          size="sm"
          className="mt-2 h-7 w-full text-[0.65rem]"
          confirmMessage="Retry this escalated task? It will get a fresh attempt window; every prior attempt stays in its history."
          successMessage="Task retried — a fresh attempt is queued."
        >
          Retry
        </ActionButton>
      )}
    </div>
  );
}

export function TaskFlow({ tasks }: { tasks: TaskDetailView[] }) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks yet.</p>;
  }

  const waves = computeWaves(tasks);
  const stepById = new Map(waves.flat().map((task, i) => [task.id, i + 1]));

  return (
    <div className="relative">
      <div
        tabIndex={0}
        role="group"
        aria-label={`Task sequence, ${tasks.length} steps across ${waves.length} stages. Scrollable horizontally on wide screens.`}
        className="flex flex-col gap-3 overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:flex-row sm:items-start"
      >
        {waves.map((wave, index) => (
          <div key={index} className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex flex-col gap-2">
              {wave.map((task) => (
                <TaskCard key={task.id} task={task} step={stepById.get(task.id)!} />
              ))}
            </div>
            {index < waves.length - 1 && (
              <ChevronRight className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground sm:mx-0 sm:mt-6 sm:rotate-0" />
            )}
          </div>
        ))}
      </div>
      {waves.length > 1 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-10 sm:block"
          style={{ background: "linear-gradient(to left, color-mix(in oklch, var(--card) 70%, transparent), transparent)" }}
        />
      )}
    </div>
  );
}
