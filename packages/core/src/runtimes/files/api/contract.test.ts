import { defineContract } from '@emdash/wire/rpc';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hostAbsolutePathSchema } from '#primitives/path/api';
import { filesContract } from './contract';
import { homeDirectoryResultSchema } from './schemas';

describe('filesContract', () => {
  it('uses Wire-native endpoint kinds and standalone IDs', () => {
    expect(filesContract.getHomeDir.kind).toBe('procedure');
    expect(filesContract.fs.stat.kind).toBe('procedure');
    expect(filesContract.fs.readBytes.kind).toBe('downloadFile');
    expect(filesContract.fs.readBytes.id).toBe('fs.readBytes');
    expect(filesContract.fs.enumerate.kind).toBe('liveJob');
    expect(filesContract.fs.enumerate.id).toBe('fs.enumerate');
    expect(filesContract.tree.model.kind).toBe('liveModel');
    expect(filesContract.tree.model.id).toBe('tree.model');
    expect(filesContract.tree.model.states.tree.id).toBe('tree.model.tree');
    expect(filesContract.tree.model.mutations.expand.kind).toBe('mutation');
    expect(filesContract.content.id).toBe('content');
  });

  it('retains mounted live endpoint IDs inside a parent contract', () => {
    const parent = defineContract({ files: filesContract });
    expect(parent.files.tree.model.id).toBe('files.tree.model');
    expect(parent.files.tree.model.states.tree.id).toBe('files.tree.model.tree');
    expect(parent.files.content.id).toBe('files.content');
    expect(parent.files.fs.readBytes.id).toBe('files.fs.readBytes');
  });

  it('accepts a home directory response from an older server without a path profile', () => {
    const legacyResponse = {
      path: { root: { kind: 'posix' }, segments: ['home', 'jona'] },
    };

    expect(filesContract.getHomeDir.output).toBe(homeDirectoryResultSchema);
    expect(filesContract.getHomeDir.output.parse(legacyResponse)).toEqual(legacyResponse);
  });

  it('allows an older client to ignore a new server path profile', () => {
    const path = { root: { kind: 'posix' }, segments: ['home', 'jona'] };
    const response = {
      path,
      profile: {
        style: 'posix',
        caseSensitivity: 'sensitive',
        unicodeNormalization: 'nfc',
      },
    };
    const legacyOutputSchema = z.object({ path: hostAbsolutePathSchema });

    expect(homeDirectoryResultSchema.parse(response)).toEqual(response);
    expect(legacyOutputSchema.parse(response)).toEqual({ path });
  });
});
