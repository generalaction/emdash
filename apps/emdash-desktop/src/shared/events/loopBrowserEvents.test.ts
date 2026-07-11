import { describe, expect, it } from 'vitest';
import {
  LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX,
  loopBrowserActionMessageSchema,
  loopBrowserMessageSchema,
  loopBrowserRequestMessageSchema,
} from '@shared/core/loops/loop-browser-contracts';
import {
  loopBrowserActionChannel,
  loopBrowserCloseChannel,
  loopBrowserClosedChannel,
  loopBrowserReadyChannel,
  loopBrowserRequestChannel,
  loopBrowserResultChannel,
} from './loopBrowserEvents';

const lease = {
  verificationRunId: 'run-1',
  browserId: 'browser-1',
  projectId: 'project-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  partition: `${LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX}run-1`,
  allowedPreviewOrigin: 'http://127.0.0.1:4173',
};

describe('Loop browser lease messages', () => {
  it('freezes the request -> ready -> action/result -> close -> closed channels', () => {
    expect([
      loopBrowserRequestChannel.name,
      loopBrowserReadyChannel.name,
      loopBrowserActionChannel.name,
      loopBrowserResultChannel.name,
      loopBrowserCloseChannel.name,
      loopBrowserClosedChannel.name,
    ]).toEqual([
      'loop-browser:request',
      'loop-browser:ready',
      'loop-browser:action',
      'loop-browser:result',
      'loop-browser:close',
      'loop-browser:closed',
    ]);

    const messages = [
      {
        type: 'request',
        ...lease,
        previewUrl: 'http://127.0.0.1:4173/settings',
        requestedAt: '2026-07-11T12:00:00.000Z',
      },
      {
        type: 'ready',
        ...lease,
        currentUrl: 'http://127.0.0.1:4173/settings',
        readyAt: '2026-07-11T12:00:01.000Z',
      },
      {
        type: 'action',
        ...lease,
        actionId: 'action-1',
        action: {
          kind: 'fill',
          target: { role: 'textbox', name: 'Goal' },
          value: 'Run the contract tests',
        },
      },
      {
        type: 'result',
        ...lease,
        actionId: 'action-1',
        result: {
          ok: true,
          observation: {
            kind: 'interaction',
            currentUrl: 'http://127.0.0.1:4173/settings',
          },
        },
      },
      { type: 'close', ...lease, reason: 'completed' },
      {
        type: 'closed',
        ...lease,
        reason: 'completed',
        partitionDataCleared: true,
        closedAt: '2026-07-11T12:00:02.000Z',
      },
    ];

    for (const message of messages) {
      expect(loopBrowserMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it('requires an origin-bound disposable lease without embedded credentials', () => {
    expect(
      loopBrowserRequestMessageSchema.safeParse({
        type: 'request',
        ...lease,
        previewUrl: 'https://example.com/settings',
        requestedAt: '2026-07-11T12:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      loopBrowserRequestMessageSchema.safeParse({
        type: 'request',
        ...lease,
        allowedPreviewOrigin: 'http://user:secret@127.0.0.1:4173',
        previewUrl: 'http://user:secret@127.0.0.1:4173/settings',
        requestedAt: '2026-07-11T12:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      loopBrowserRequestMessageSchema.safeParse({
        type: 'request',
        ...lease,
        partition: 'persist:emdash-browser-profile',
        previewUrl: 'http://127.0.0.1:4173/settings',
        requestedAt: '2026-07-11T12:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      loopBrowserMessageSchema.safeParse({
        type: 'ready',
        ...lease,
        currentUrl: 'https://example.com/settings',
        readyAt: '2026-07-11T12:00:01.000Z',
      }).success
    ).toBe(false);
    expect(
      loopBrowserMessageSchema.safeParse({
        type: 'action',
        ...lease,
        actionId: 'action-external',
        action: { kind: 'navigate', url: 'https://example.com/settings' },
      }).success
    ).toBe(false);
    expect(
      loopBrowserMessageSchema.safeParse({
        type: 'result',
        ...lease,
        actionId: 'action-external',
        result: {
          ok: true,
          observation: { kind: 'interaction', currentUrl: 'https://example.com/settings' },
        },
      }).success
    ).toBe(false);
  });

  it('allows only bounded audited browser actions', () => {
    expect(
      loopBrowserActionMessageSchema.safeParse({
        type: 'action',
        ...lease,
        actionId: 'action-1',
        action: { kind: 'execute-javascript', script: 'document.cookie' },
      }).success
    ).toBe(false);
    expect(
      loopBrowserActionMessageSchema.safeParse({
        type: 'action',
        ...lease,
        actionId: 'action-2',
        action: {
          kind: 'fill',
          target: { role: 'textbox', name: 'Goal' },
          value: 'x'.repeat(16_385),
        },
      }).success
    ).toBe(false);
  });
});
