import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManualClock } from '@emdash/shared/testing';
import { remote, snapshot } from '@emdash/wire';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import type { TempStoreHandle } from '@primitives/sqlite-store/api';
import { conversationsContract } from '@runtimes/conversations/api';
import {
  conversationsStore,
  type ConversationsDb,
} from '@runtimes/conversations/node/persistence/store';
import { ConversationsRuntime } from '@runtimes/conversations/node/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationsController } from './controller';

// Contract-seam tests for the host conversation index (spec §3–4), against real SQLite
// in a temp dir. Property statements under test (spec §9):
//
// - conv.identity: a conversation's `id` is minted once at creation, never changes, and is
//   never reused. Any provider handle the record holds is a last-observed pointer under an
//   explicit id regime, not the identity.
// - conv.sole-writer: exactly one host component writes the conversation index. These tests
//   drive every mutation through the wire contract — the only client-facing write path.
// - conv.records-only: everything the index knows arrives through its feeders; nothing here
//   reads, enumerates, or parses provider session storage.

const baseCreate = {
  id: 'conv-1',
  provider: 'claude-code',
  type: 'acp' as const,
  cwd: '/work/repo',
  workspacePath: '/work/repo',
  idRegime: 'provider-minted' as const,
  createdAt: 1_000,
  title: 'First conversation',
  config: { model: 'sonnet' },
};

describe('conversations contract', () => {
  let handle: TempStoreHandle<ConversationsDb>;
  let clock: ManualClock;
  let runtime: ConversationsRuntime;
  let wire: TestWire<typeof conversationsContract>;

  beforeEach(async () => {
    handle = await conversationsStore.openTemp();
    clock = new ManualClock(10_000);
    runtime = new ConversationsRuntime({ handle, clock });
    wire = createTestWire(conversationsContract, createConversationsController(runtime), {
      validate: 'full',
    });
  });

  afterEach(() => {
    wire.dispose();
    runtime.dispose();
    handle.close();
  });

  it('create registers a durable record and the records model lists it', async () => {
    const created = await wire.client.create(baseCreate);
    expect(created).toEqual({
      success: true,
      data: {
        ...baseCreate,
        providerSessionId: null,
        providerSessionIdObservedAt: null,
        lastSessionActivityAt: null,
        lastSpawnedAt: null,
        lastResumeOutcome: 'never-resumed',
        updatedAt: 10_000,
      },
    });

    const records = remote(conversationsContract.records, wire.client.records);
    const model = records(undefined);
    try {
      await model.states.list.refresh();
      expect(snapshot(model.states.list).value).toMatchObject({
        'conv-1': { id: 'conv-1', title: 'First conversation' },
      });
    } finally {
      await records.dispose();
    }
  });

  it('replaying create with identical immutable fields is a no-op success (conv.identity)', async () => {
    const first = await wire.client.create(baseCreate);
    expect(first.success).toBe(true);

    await clock.advanceTo(20_000);
    // Replay carries different client-editable fields; the no-op returns the existing
    // record untouched — the id is never reused for different content.
    const replay = await wire.client.create({
      ...baseCreate,
      title: 'Replayed title',
      config: { model: 'other' },
    });
    expect(replay).toEqual(first);
  });

  it('create with mismatched immutable fields is an error (conv.identity)', async () => {
    await wire.client.create(baseCreate);

    const mismatch = await wire.client.create({
      ...baseCreate,
      cwd: '/work/elsewhere',
      createdAt: 2_000,
    });
    expect(mismatch.success).toBe(false);
    if (mismatch.success) throw new Error('expected error');
    expect(mismatch.error).toMatchObject({
      type: 'immutable-field-mismatch',
      conversationId: 'conv-1',
      fields: ['cwd', 'createdAt'],
    });

    // The stored record is untouched by the failed replay.
    const records = remote(conversationsContract.records, wire.client.records);
    const model = records(undefined);
    try {
      await model.states.list.refresh();
      expect(snapshot(model.states.list).value?.['conv-1']).toMatchObject({
        cwd: '/work/repo',
        createdAt: 1_000,
      });
    } finally {
      await records.dispose();
    }
  });

  it('rename mutates only the title, last-write-wins', async () => {
    await wire.client.create(baseCreate);

    await clock.advanceTo(20_000);
    const renamed = await wire.client.rename({ id: 'conv-1', title: 'Renamed' });
    expect(renamed).toEqual({
      success: true,
      data: {
        ...baseCreate,
        title: 'Renamed',
        providerSessionId: null,
        providerSessionIdObservedAt: null,
        lastSessionActivityAt: null,
        lastSpawnedAt: null,
        lastResumeOutcome: 'never-resumed',
        updatedAt: 20_000,
      },
    });

    await clock.advanceTo(30_000);
    const renamedAgain = await wire.client.rename({ id: 'conv-1', title: 'Renamed again' });
    expect(renamedAgain.success).toBe(true);
    if (!renamedAgain.success) throw new Error('expected success');
    expect(renamedAgain.data.title).toBe('Renamed again');
    expect(renamedAgain.data.updatedAt).toBe(30_000);
  });

  it('updateConfig mutates only the config payload', async () => {
    await wire.client.create(baseCreate);

    await clock.advanceTo(20_000);
    const updated = await wire.client.updateConfig({
      id: 'conv-1',
      config: { model: 'opus', initialQueue: [{ text: 'hello' }] },
    });
    expect(updated.success).toBe(true);
    if (!updated.success) throw new Error('expected success');
    expect(updated.data.config).toEqual({ model: 'opus', initialQueue: [{ text: 'hello' }] });
    expect(updated.data.title).toBe('First conversation');
    expect(updated.data.updatedAt).toBe(20_000);
  });

  it('rename and updateConfig of an unknown record are conversation-not-found errors', async () => {
    const renamed = await wire.client.rename({ id: 'conv-missing', title: 'x' });
    expect(renamed).toMatchObject({
      success: false,
      error: { type: 'conversation-not-found', conversationId: 'conv-missing' },
    });

    const updated = await wire.client.updateConfig({ id: 'conv-missing', config: {} });
    expect(updated).toMatchObject({
      success: false,
      error: { type: 'conversation-not-found', conversationId: 'conv-missing' },
    });
  });

  it('delete removes the record and is idempotent', async () => {
    await wire.client.create(baseCreate);

    const deleted = await wire.client.delete({ id: 'conv-1' });
    expect(deleted).toEqual({ success: true, data: undefined });

    // Deleting an absent record succeeds — Outbox retries replay the same delete.
    const replay = await wire.client.delete({ id: 'conv-1' });
    expect(replay).toEqual({ success: true, data: undefined });

    const records = remote(conversationsContract.records, wire.client.records);
    const model = records(undefined);
    try {
      await model.states.list.refresh();
      expect(snapshot(model.states.list).value).toEqual({});
    } finally {
      await records.dispose();
    }
  });

  it('a live subscription sees mutations as diffs after the initial snapshot', async () => {
    await wire.client.create(baseCreate);

    const records = remote(conversationsContract.records, wire.client.records);
    const model = records(undefined);
    try {
      await model.states.list.refresh();
      expect(Object.keys(snapshot(model.states.list).value ?? {})).toEqual(['conv-1']);

      await wire.client.create({ ...baseCreate, id: 'conv-2', title: 'Second' });
      await wire.client.rename({ id: 'conv-1', title: 'Renamed live' });
      await vi.waitFor(() => {
        const value = snapshot(model.states.list).value;
        expect(value?.['conv-2']).toMatchObject({ title: 'Second' });
        expect(value?.['conv-1']).toMatchObject({ title: 'Renamed live' });
      });

      await wire.client.delete({ id: 'conv-2' });
      await vi.waitFor(() => {
        expect(snapshot(model.states.list).value?.['conv-2']).toBeUndefined();
      });
    } finally {
      await records.dispose();
    }
  });
});

describe('conversations durability', () => {
  it('records survive a runtime restart on the same database file', async () => {
    // Worker restart / host reboot: a fresh runtime over the same WAL SQLite file serves
    // every durable record, not just live sessions (spec §4.1).
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'emdash-conversations-'));
    const dbFile = path.join(dir, 'conversations.db');
    try {
      const clock = new ManualClock(10_000);

      const firstHandle = conversationsStore.open(dbFile);
      const firstRuntime = new ConversationsRuntime({ handle: firstHandle, clock });
      const created = firstRuntime.create(baseCreate);
      expect(created.success).toBe(true);
      firstRuntime.dispose();
      firstHandle.close();

      const secondHandle = conversationsStore.open(dbFile);
      const secondRuntime = new ConversationsRuntime({ handle: secondHandle, clock });
      const wire = createTestWire(
        conversationsContract,
        createConversationsController(secondRuntime),
        { validate: 'full' }
      );
      const records = remote(conversationsContract.records, wire.client.records);
      const model = records(undefined);
      try {
        await model.states.list.refresh();
        expect(snapshot(model.states.list).value).toMatchObject({
          'conv-1': {
            id: 'conv-1',
            title: 'First conversation',
            config: { model: 'sonnet' },
            idRegime: 'provider-minted',
            lastResumeOutcome: 'never-resumed',
          },
        });
      } finally {
        await records.dispose();
        wire.dispose();
        secondRuntime.dispose();
        secondHandle.close();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
