import { err, ok, type Result } from '@emdash/shared';
import type {
  CompiledWorkflow,
  CompiledWorkflowNode,
  WorkflowCompileError,
  WorkflowNodeDefinition,
} from './types';

export function compileWorkflow(
  nodes: readonly WorkflowNodeDefinition[]
): Result<CompiledWorkflow, WorkflowCompileError> {
  const defs = new Map<string, WorkflowNodeDefinition>();
  for (const node of nodes) {
    if (defs.has(node.id)) {
      return err({
        type: 'duplicate-node',
        id: node.id,
        message: `Duplicate workflow node "${node.id}"`,
      });
    }
    defs.set(node.id, node);
  }

  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    dependents.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? []) {
      if (dependency === node.id) {
        return err({
          type: 'self-dependency',
          id: node.id,
          message: `Workflow node "${node.id}" cannot depend on itself`,
        });
      }
      if (!defs.has(dependency)) {
        return err({
          type: 'unknown-dependency',
          id: node.id,
          dependsOn: dependency,
          message: `Workflow node "${node.id}" depends on unknown node "${dependency}"`,
        });
      }
      dependents.get(dependency)?.push(node.id);
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
    }
  }

  const remaining = new Map(indegree);
  const queue = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
  const roots = [...queue];
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) continue;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  if (order.length !== defs.size) {
    const cycle = findCycle(nodes, defs, new Set(order));
    return err({
      type: 'cycle',
      cycle,
      message:
        cycle.length > 0
          ? `Workflow graph contains a cycle: ${cycle.join(' -> ')}`
          : 'Workflow graph contains a cycle',
    });
  }

  const compiledNodes = new Map<string, CompiledWorkflowNode>();
  for (const node of nodes) {
    compiledNodes.set(node.id, {
      def: node,
      dependents: dependents.get(node.id) ?? [],
      indegree: indegree.get(node.id) ?? 0,
    });
  }

  return ok({ nodes: compiledNodes, order, roots });
}

function findCycle(
  nodes: readonly WorkflowNodeDefinition[],
  defs: ReadonlyMap<string, WorkflowNodeDefinition>,
  emitted: ReadonlySet<string>
): readonly string[] {
  const unvisited = new Set(nodes.map((node) => node.id).filter((id) => !emitted.has(id)));
  const stack: string[] = [];
  const inStack = new Set<string>();
  const visited = new Set<string>();

  const dfs = (id: string): readonly string[] | undefined => {
    const stackIndex = stack.indexOf(id);
    if (stackIndex !== -1) return [...stack.slice(stackIndex), id];
    if (visited.has(id)) return undefined;

    visited.add(id);
    stack.push(id);
    inStack.add(id);

    for (const dependency of defs.get(id)?.dependsOn ?? []) {
      if (!unvisited.has(dependency) && !inStack.has(dependency)) continue;
      const cycle = dfs(dependency);
      if (cycle) return cycle;
    }

    inStack.delete(id);
    stack.pop();
    return undefined;
  };

  for (const id of unvisited) {
    const cycle = dfs(id);
    if (cycle) return cycle;
  }

  return [];
}
