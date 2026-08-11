import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '@core/primitives/commands/api';
import { defineViewScope } from '@core/primitives/view-scopes/api';
import {
  assertViewScopeImplsComplete,
  getViewScopeImpl,
  registerViewScopeImpl,
  unregisterViewScopeImpl,
} from './impl-registry';

const command = defineCommand({
  id: 'app.test',
  title: 'Test',
  category: 'Test',
});
const logicalScope = defineViewScope({
  id: 'logical',
  params: z.object({}),
  commands: [command],
  activation: 'logical',
});
const focusScope = defineViewScope({
  id: 'focus',
  params: z.object({}),
  commands: [command],
  activation: 'focus',
});
const implementation = {
  'app.test': () => ({ execute: () => undefined }),
};

afterEach(() => {
  unregisterViewScopeImpl(logicalScope);
  unregisterViewScopeImpl(focusScope);
});

describe('view scope implementation registry', () => {
  it('registers and resolves an implementation', () => {
    registerViewScopeImpl(logicalScope, implementation);

    expect(getViewScopeImpl(logicalScope)).toBe(implementation);
  });

  it('rejects duplicate registrations', () => {
    registerViewScopeImpl(logicalScope, implementation);

    expect(() => registerViewScopeImpl(logicalScope, implementation)).toThrow(
      'Duplicate view scope implementation: logical'
    );
  });

  it('rejects implementations with missing command bindings', () => {
    expect(() => registerViewScopeImpl(logicalScope, {} as never)).toThrow(
      'View scope implementation logical is missing command bindings: app.test'
    );
  });

  it('requires implementations only for logical scopes', () => {
    expect(() => assertViewScopeImplsComplete([logicalScope, focusScope])).toThrow(
      'Missing view scope implementations: logical'
    );

    registerViewScopeImpl(logicalScope, implementation);
    expect(() => assertViewScopeImplsComplete([logicalScope, focusScope])).not.toThrow();
  });
});
