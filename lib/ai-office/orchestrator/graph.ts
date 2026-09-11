import "server-only";

/**
 * Pure, DB-free DAG validation for an in-memory task plan, before a
 * single row is written. Per the Phase 5 brief: "Do not start execution
 * if the plan is invalid" — `planProject()`
 * (lib/ai-office/orchestrator/orchestrator.ts) calls this before opening
 * its transaction, not after.
 */

export interface PlanTaskNode {
  id: string;
  roleId: string;
  title: string;
  dependsOn: string[];
}

export type GraphValidationResult = { valid: true } | { valid: false; reason: string };

export function validateTaskGraph(nodes: PlanTaskNode[]): GraphValidationResult {
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) {
    return { valid: false, reason: "Duplicate task id in plan." };
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (dep === node.id) {
        return { valid: false, reason: `Task "${node.title}" depends on itself.` };
      }
      if (!ids.has(dep)) {
        return { valid: false, reason: `Task "${node.title}" depends on a task id not present in the plan: ${dep}.` };
      }
    }
  }

  // Kahn's algorithm — if every node can be placed in a topological
  // order, the graph is a DAG; if some remain unplaceable, there's a
  // cycle among them.
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, n.dependsOn.length]));
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), node.id]);
    }
  }

  const queue = nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const dependent of dependents.get(current) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  if (visited !== nodes.length) {
    return { valid: false, reason: "Task plan contains a dependency cycle." };
  }

  return { valid: true };
}
