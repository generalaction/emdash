import { describe, expect, it } from 'vitest';
import { compileWorkflow } from './compile';
import { defineWorkflowNode } from './types';

describe('compileWorkflow', () => {
  it('builds a deterministic topological order and reverse edges', () => {
    const result = compileWorkflow([
      node('fetch'),
      node('lint', ['fetch']),
      node('test', ['fetch']),
      node('package', ['lint', 'test']),
    ]);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.roots).toEqual(['fetch']);
    expect(result.data.order).toEqual(['fetch', 'lint', 'test', 'package']);
    expect(result.data.nodes.get('fetch')?.dependents).toEqual(['lint', 'test']);
    expect(result.data.nodes.get('package')?.indegree).toBe(2);
  });

  it('rejects duplicate node ids', () => {
    const result = compileWorkflow([node('build'), node('build')]);

    expect(result).toEqual({
      success: false,
      error: {
        type: 'duplicate-node',
        id: 'build',
        message: 'Duplicate workflow node "build"',
      },
    });
  });

  it('rejects self dependencies', () => {
    const result = compileWorkflow([node('build', ['build'])]);

    expect(result).toEqual({
      success: false,
      error: {
        type: 'self-dependency',
        id: 'build',
        message: 'Workflow node "build" cannot depend on itself',
      },
    });
  });

  it('rejects unknown dependencies', () => {
    const result = compileWorkflow([node('build', ['install'])]);

    expect(result).toEqual({
      success: false,
      error: {
        type: 'unknown-dependency',
        id: 'build',
        dependsOn: 'install',
        message: 'Workflow node "build" depends on unknown node "install"',
      },
    });
  });

  it('reports a concrete cycle path', () => {
    const result = compileWorkflow([node('a', ['c']), node('b', ['a']), node('c', ['b'])]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({
        type: 'cycle',
        cycle: ['a', 'c', 'b', 'a'],
      });
    }
  });
});

function node(id: string, dependsOn: readonly string[] = []) {
  return defineWorkflowNode({
    id,
    dependsOn,
    run: () => ({ status: 'done' }),
  });
}
