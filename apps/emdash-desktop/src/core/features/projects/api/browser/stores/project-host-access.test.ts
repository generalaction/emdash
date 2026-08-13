import { hostRef } from '@emdash/core/primitives/host/api';
import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import { describe, expect, it } from 'vitest';
import type { ProjectAttachmentState } from '@core/features/projects/api';
import { deriveProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';
import type { HostAvailabilityState } from '@core/services/hosts/api';

describe('deriveProjectHostAccessState', () => {
  it.each<
    [
      string,
      HostAvailabilityState | undefined,
      ProjectAttachmentState | undefined,
      ReturnType<typeof deriveProjectHostAccessState>,
    ]
  >([
    [
      'unavailable Host',
      { kind: 'unavailable', recovery: 'eligible' },
      { kind: 'absent' },
      { kind: 'offline' },
    ],
    [
      'automatic Host recovery between attempts',
      {
        kind: 'unavailable',
        recovery: 'waiting',
        nextAttemptAt: 12_000,
      },
      { kind: 'absent' },
      { kind: 'recovering', nextAttemptAt: 12_000 },
    ],
    [
      'immediately manual Host recovery',
      { kind: 'unavailable', recovery: 'manual' },
      { kind: 'absent' },
      { kind: 'offline', recovery: 'manual' },
    ],
    [
      'exhausted automatic Host recovery',
      {
        kind: 'unavailable',
        issue: runtimeHostUnavailable(
          hostRef('remote', 'ssh-1'),
          'runtime-unavailable',
          'Host runtime is unavailable'
        ),
        recovery: 'manual',
      },
      { kind: 'absent' },
      { kind: 'offline', recovery: 'manual', automaticExhausted: true },
    ],
    [
      'suspended Host with a retained attachment',
      { kind: 'suspended', reason: 'user-disconnected' },
      { kind: 'attached', establishedHostGeneration: 1 },
      { kind: 'offline' },
    ],
    ['availability still loading', undefined, undefined, { kind: 'offline' }],
    [
      'connecting Host',
      { kind: 'preparing', phase: 'connecting', attempt: 1 },
      { kind: 'absent' },
      { kind: 'preparing', phase: 'connecting' },
    ],
    [
      'provisioning Host',
      { kind: 'preparing', phase: 'provisioning', attempt: 1 },
      { kind: 'absent' },
      { kind: 'preparing', phase: 'provisioning' },
    ],
    [
      'ready Host before attachment publication',
      { kind: 'ready', generation: 2 },
      undefined,
      { kind: 'attaching' },
    ],
    [
      'ready Host with absent attachment',
      { kind: 'ready', generation: 2 },
      { kind: 'absent' },
      { kind: 'attaching' },
    ],
    [
      'attachment in progress',
      { kind: 'ready', generation: 2 },
      { kind: 'attaching', hostGeneration: 2, attemptId: 'attempt-1' },
      { kind: 'attaching' },
    ],
    [
      'retained attachment from an earlier Host generation',
      { kind: 'ready', generation: 3 },
      { kind: 'attached', establishedHostGeneration: 2 },
      { kind: 'ready', hostGeneration: 3 },
    ],
    [
      'available Project',
      { kind: 'ready', generation: 3 },
      { kind: 'attached', establishedHostGeneration: 3 },
      { kind: 'ready', hostGeneration: 3 },
    ],
  ])('derives %s', (_label, availability, attachment, expected) => {
    expect(deriveProjectHostAccessState(availability, attachment)).toEqual(expected);
  });
});
