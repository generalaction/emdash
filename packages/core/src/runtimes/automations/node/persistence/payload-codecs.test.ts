import { LOCAL_HOST_REF } from '@primitives/host/api';
import { describe, expect, it } from 'vitest';
import type { AutomationDeployment } from '../../api/deployment';
import type { AutomationRun } from '../../api/run';
import {
  parseDeploymentPayload,
  parseRunPayload,
  serializeDeploymentPayload,
  serializeRunPayload,
} from './payload-codecs';

function deployment(): AutomationDeployment {
  return {
    automationId: 'auto-1',
    enabled: true,
    name: 'Nightly',
    schedule: { expr: '0 9 * * *', tz: 'UTC' },
    agent: {
      type: 'acp',
      start: {
        providerId: 'claude',
        model: null,
        initialQueue: [{ text: 'Review open PRs' }],
      },
    },
    workspace: {
      kind: 'worktree',
      repository: {
        host: LOCAL_HOST_REF,
        path: { root: { kind: 'posix' }, segments: ['repo'] },
      },
      preservePatterns: ['.env*'],
      git: {
        kind: 'create-branch',
        fromBranch: { type: 'local', branch: 'main' },
        pushRemote: null,
      },
    },
    revision: 1,
  };
}

function run(): AutomationRun {
  const deployed = deployment();
  return {
    id: 'run-1',
    seq: 1,
    automationId: deployed.automationId,
    status: 'scheduled',
    triggerKind: 'cron',
    configSnapshot: {
      name: deployed.name,
      schedule: deployed.schedule,
      agent: deployed.agent,
      workspace: deployed.workspace,
    },
    generatedName: 'automation-1',
    scheduledAt: Date.UTC(2026, 0, 2),
    deadlineAt: Date.UTC(2026, 0, 3),
    startedAt: null,
    finishedAt: null,
    workspace: null,
    branchName: null,
    conversationId: null,
    sessionId: null,
    error: null,
  };
}

describe('stored automation payloads', () => {
  it('round-trips runs without leaking the storage version', () => {
    const value = run();
    const serialized = serializeRunPayload(value);

    expect(JSON.parse(serialized)).toMatchObject({ version: '1', id: value.id });
    expect(parseRunPayload(serialized)).toEqual(value);
  });

  it('round-trips deployments without leaking the storage version', () => {
    const value = deployment();
    const serialized = serializeDeploymentPayload(value);

    expect(JSON.parse(serialized)).toMatchObject({
      version: '1',
      automationId: value.automationId,
    });
    expect(parseDeploymentPayload(serialized)).toEqual(value);
  });

  it('rejects version-less and future-version payloads', () => {
    expect(() => parseRunPayload(JSON.stringify(run()))).toThrow(/Missing 'version'/);
    expect(() => parseRunPayload(JSON.stringify({ ...run(), version: '2' }))).toThrow(
      /future-version '2'/
    );
    expect(() => parseDeploymentPayload(JSON.stringify(deployment()))).toThrow(/Missing 'version'/);
    expect(() => parseDeploymentPayload(JSON.stringify({ ...deployment(), version: '2' }))).toThrow(
      /future-version '2'/
    );
  });

  it('reports malformed JSON explicitly', () => {
    expect(() => parseRunPayload('{')).toThrow('Stored automation run contains invalid JSON');
    expect(() => parseDeploymentPayload('{')).toThrow(
      'Stored automation deployment contains invalid JSON'
    );
  });
});
