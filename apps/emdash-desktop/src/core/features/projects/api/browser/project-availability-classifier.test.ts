import { hostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeHostIdentityLost,
  runtimeHostNotConfigured,
  runtimeHostUnavailable,
  type RuntimeUnavailableReason,
} from '@emdash/core/primitives/runtime-resolution/api';
import { describe, expect, it } from 'vitest';
import type { ProjectAttachmentError } from '@core/features/projects/api/attachments';
import {
  classifyProjectAttachmentIssue,
  classifyProjectAvailability,
  type ProjectAttachmentIssueClassification,
  type ProjectAvailabilityPresentation,
} from './project-availability-classifier';
import type { ProjectHostAccessState } from './stores/project-context';

const host = hostRef('remote', 'connection-private-id');
const runtimeReasons: RuntimeUnavailableReason[] = [
  'offline',
  'connection-failed',
  'daemon-start-failed',
  'artifact-download-failed',
  'install-failed',
  'unsupported-platform',
  'protocol-upgrade-client',
  'protocol-upgrade-server',
  'runtime-unavailable',
];
const runtimeIssues = Object.fromEntries(
  runtimeReasons.map((reason) => [
    reason,
    runtimeHostUnavailable(host, reason, `raw lower-level ${reason} message`),
  ])
) as Record<RuntimeUnavailableReason, ProjectAttachmentError>;
const issues = {
  ...runtimeIssues,
  'not-configured': runtimeHostNotConfigured(host, 'raw not-configured message'),
  'host-identity-lost': runtimeHostIdentityLost(host, 'raw identity message'),
  'attachment-unavailable': {
    type: 'attachment-unavailable',
    host,
    phase: 'waiting',
  },
  'repository-missing': {
    type: 'repository-missing',
    path: '/private/repository/path',
  },
  'repository-unavailable': {
    type: 'repository-unavailable',
    path: '/private/repository/path',
    message: 'raw filesystem message',
  },
  unexpected: {
    type: 'unexpected',
    stage: 'session-open',
    message: 'raw provider message',
  },
  'project-missing': {
    type: 'project-missing',
    projectId: 'project-private-id',
  },
} satisfies Record<string, ProjectAttachmentError>;

describe('classifyProjectAttachmentIssue', () => {
  it.each<[label: keyof typeof issues, expected: ProjectAttachmentIssueClassification]>([
    [
      'offline',
      { semantic: 'offline', recovery: 'automatic', correctiveActions: ['retry', 'diagnostics'] },
    ],
    [
      'connection-failed',
      {
        semantic: 'connection-failed',
        recovery: 'automatic',
        correctiveActions: ['retry', 'diagnostics'],
      },
    ],
    [
      'daemon-start-failed',
      {
        semantic: 'daemon-start-failed',
        recovery: 'automatic',
        correctiveActions: ['retry', 'diagnostics'],
      },
    ],
    [
      'artifact-download-failed',
      {
        semantic: 'artifact-download-failed',
        recovery: 'manual',
        correctiveActions: ['retry', 'diagnostics'],
      },
    ],
    [
      'install-failed',
      {
        semantic: 'install-failed',
        recovery: 'manual',
        correctiveActions: ['retry', 'diagnostics'],
      },
    ],
    [
      'unsupported-platform',
      {
        semantic: 'unsupported-platform',
        recovery: 'blocked',
        correctiveActions: ['diagnostics'],
      },
    ],
    [
      'protocol-upgrade-client',
      {
        semantic: 'protocol-upgrade-client',
        recovery: 'blocked',
        correctiveActions: ['update-client'],
      },
    ],
    [
      'protocol-upgrade-server',
      {
        semantic: 'protocol-upgrade-server',
        recovery: 'blocked',
        correctiveActions: ['diagnostics', 'retry'],
      },
    ],
    [
      'runtime-unavailable',
      {
        semantic: 'runtime-unavailable',
        recovery: 'automatic',
        correctiveActions: ['retry', 'diagnostics'],
      },
    ],
    [
      'not-configured',
      {
        semantic: 'not-configured',
        recovery: 'blocked',
        correctiveActions: ['configure'],
      },
    ],
    [
      'host-identity-lost',
      {
        semantic: 'host-identity-lost',
        recovery: 'blocked',
        correctiveActions: ['relink-project', 'remove-project'],
      },
    ],
    [
      'attachment-unavailable',
      {
        semantic: 'attachment-unavailable',
        recovery: 'automatic',
        correctiveActions: [],
      },
    ],
    [
      'repository-missing',
      {
        semantic: 'repository-missing',
        recovery: 'manual',
        correctiveActions: ['retry'],
      },
    ],
    [
      'repository-unavailable',
      {
        semantic: 'repository-unavailable',
        recovery: 'manual',
        correctiveActions: ['retry', 'diagnostics'],
      },
    ],
    [
      'unexpected',
      {
        semantic: 'unexpected',
        recovery: 'manual',
        correctiveActions: ['retry', 'diagnostics'],
      },
    ],
    [
      'project-missing',
      {
        semantic: 'project-missing',
        recovery: 'dispose-context',
        correctiveActions: [],
      },
    ],
  ])('classifies $label with its fixed recovery and corrective actions', (label, expected) => {
    expect(classifyProjectAttachmentIssue(issues[label]!)).toEqual(expected);
  });
});

describe('classifyProjectAvailability', () => {
  const ssh = { kind: 'ssh', machineName: 'Orion' } as const;
  const local = { kind: 'local' } as const;

  it.each<
    [
      label: string,
      state: ProjectHostAccessState,
      expected: Pick<
        ProjectAvailabilityPresentation,
        'title' | 'announcement' | 'progress' | 'actions'
      > | null,
    ]
  >([
    ['ready', { kind: 'ready', hostGeneration: 4 }, null],
    [
      'suspended',
      { kind: 'degraded', situation: 'suspended', recovery: 'manual' },
      {
        title: 'Orion is offline',
        announcement: 'polite',
        progress: false,
        actions: [{ kind: 'connect', label: 'Connect' }],
      },
    ],
    [
      'offline',
      { kind: 'degraded', situation: 'offline', recovery: 'automatic' },
      {
        title: 'Orion is offline',
        announcement: 'polite',
        progress: false,
        actions: [{ kind: 'connect', label: 'Connect' }],
      },
    ],
    [
      'connecting',
      { kind: 'degraded', situation: 'connecting', recovery: 'automatic' },
      {
        title: 'Connecting to Orion',
        announcement: 'polite',
        progress: true,
        actions: [{ kind: 'diagnostics', label: 'Open Machines' }],
      },
    ],
    [
      'provisioning',
      { kind: 'degraded', situation: 'provisioning', recovery: 'automatic' },
      {
        title: 'Preparing Orion',
        announcement: 'polite',
        progress: true,
        actions: [{ kind: 'diagnostics', label: 'Open Machines' }],
      },
    ],
    [
      'handshaking',
      { kind: 'degraded', situation: 'handshaking', recovery: 'automatic' },
      {
        title: 'Preparing Orion',
        announcement: 'polite',
        progress: true,
        actions: [{ kind: 'diagnostics', label: 'Open Machines' }],
      },
    ],
    [
      'attaching',
      { kind: 'degraded', situation: 'attaching', recovery: 'automatic' },
      {
        title: 'Opening Project on Orion',
        announcement: 'polite',
        progress: true,
        actions: [],
      },
    ],
    [
      'recovering',
      { kind: 'degraded', situation: 'recovering', recovery: 'automatic' },
      {
        title: 'Reconnecting to Orion',
        announcement: 'polite',
        progress: true,
        actions: [
          { kind: 'retry', label: 'Retry now' },
          { kind: 'diagnostics', label: 'Open Machines' },
        ],
      },
    ],
    [
      'manual attention without a typed issue',
      { kind: 'degraded', situation: 'attention', recovery: 'manual' },
      {
        title: 'Orion needs attention',
        announcement: 'assertive',
        progress: false,
        actions: [
          { kind: 'retry', label: 'Retry' },
          { kind: 'diagnostics', label: 'Open Machines' },
        ],
      },
    ],
  ])('presents the SSH $label state', (_label, state, expected) => {
    const presentation = classifyProjectAvailability({ host: ssh, state });
    if (!expected) {
      expect(presentation).toBeNull();
      return;
    }
    expect(presentation).toMatchObject(expected);
  });

  it.each<[semantic: keyof typeof issues, title: string, actionLabels: string[]]>([
    ['offline', 'Orion is offline', ['Retry now', 'Open Machines']],
    ['connection-failed', 'Could not connect to Orion', ['Retry now', 'Open Machines']],
    [
      'daemon-start-failed',
      "Could not start Orion's workspace server",
      ['Retry now', 'Open Machines'],
    ],
    [
      'artifact-download-failed',
      'Could not download the workspace server',
      ['Retry', 'Open Machines'],
    ],
    ['install-failed', 'Could not install the workspace server', ['Retry', 'Open Machines']],
    ['unsupported-platform', 'Orion is not supported', ['Open Machines']],
    ['protocol-upgrade-client', 'Update Emdash to use this Project', ['Update Emdash']],
    ['protocol-upgrade-server', "Update Orion's workspace server", ['Open Machines', 'Retry']],
    [
      'runtime-unavailable',
      "Orion's workspace server is unavailable",
      ['Retry now', 'Open Machines'],
    ],
    ['not-configured', 'Orion is not configured', ['Configure Machine']],
    [
      'host-identity-lost',
      'This Project is no longer linked to a Machine',
      ['Relink Project', 'Remove Project'],
    ],
    ['attachment-unavailable', 'Opening Project on Orion', []],
    ['repository-missing', 'Repository is missing', ['Retry']],
    ['repository-unavailable', 'Repository is unavailable', ['Retry', 'Open Machines']],
    ['unexpected', 'Project access failed', ['Retry', 'Open Machines']],
    ['project-missing', '', []],
  ])(
    'presents the SSH $semantic outcome without lower-level data',
    (semantic, title, actionLabels) => {
      const presentation = classifyProjectAvailability({
        host: ssh,
        state: stateForIssue(issues[semantic]),
      });
      if (semantic === 'project-missing') {
        expect(presentation).toBeNull();
        return;
      }
      expect(presentation?.title).toBe(title);
      expect(presentation?.actions.map((action) => action.label)).toEqual(actionLabels);
      expect(JSON.stringify(presentation)).not.toMatch(
        /connection-private-id|project-private-id|\/private\/|raw lower-level|raw filesystem|raw provider/
      );
    }
  );

  it.each<[semantic: keyof typeof issues, title: string, actionLabels: string[]]>([
    ['offline', 'Local runtime is unavailable', ['Retry now', 'Open Diagnostics']],
    ['connection-failed', 'Local runtime connection failed', ['Retry now', 'Open Diagnostics']],
    ['daemon-start-failed', 'Local runtime could not start', ['Retry now', 'Open Diagnostics']],
    ['artifact-download-failed', 'Local runtime download failed', ['Retry', 'Open Diagnostics']],
    ['install-failed', 'Local runtime installation failed', ['Retry', 'Open Diagnostics']],
    ['unsupported-platform', 'This platform is not supported', ['Open Diagnostics']],
    ['protocol-upgrade-client', 'Update Emdash to use this Project', ['Update Emdash']],
    ['protocol-upgrade-server', 'Update the local runtime', ['Open Diagnostics', 'Retry']],
    ['runtime-unavailable', 'Local runtime is unavailable', ['Retry now', 'Open Diagnostics']],
    ['not-configured', 'Local runtime is not configured', ['Configure Runtime']],
    [
      'host-identity-lost',
      'This Project lost its local runtime link',
      ['Relink Project', 'Remove Project'],
    ],
    ['attachment-unavailable', 'Opening Project locally', []],
    ['repository-missing', 'Repository is missing', ['Retry']],
    ['repository-unavailable', 'Repository is unavailable', ['Retry', 'Open Diagnostics']],
    ['unexpected', 'Project access failed', ['Retry', 'Open Diagnostics']],
    ['project-missing', '', []],
  ])('uses local-only copy and actions for $semantic', (semantic, title, actionLabels) => {
    const presentation = classifyProjectAvailability({
      host: local,
      state: stateForIssue(issues[semantic]),
    });
    if (semantic === 'project-missing') {
      expect(presentation).toBeNull();
      return;
    }
    expect(presentation?.title).toBe(title);
    expect(presentation?.actions.map((action) => action.label)).toEqual(actionLabels);
    expect(JSON.stringify(presentation)).not.toMatch(
      /SSH|Machine|Open Machines|Connect|connection-private-id|\/private\/|raw /
    );
  });
});

function stateForIssue(issue: ProjectAttachmentError): ProjectHostAccessState {
  const classification = classifyProjectAttachmentIssue(issue);
  if (issue.type === 'attachment-unavailable') {
    return {
      kind: 'degraded',
      situation: 'attaching',
      recovery: 'automatic',
      issue,
    };
  }
  return {
    kind: 'degraded',
    situation: classification.recovery === 'automatic' ? 'recovering' : 'attention',
    recovery: classification.recovery === 'dispose-context' ? 'blocked' : classification.recovery,
    issue,
  };
}
