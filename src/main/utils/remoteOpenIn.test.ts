import { describe, expect, it } from 'vitest';
import { buildRemoteEditorUrl } from './remoteOpenIn';

describe('buildRemoteEditorUrl', () => {
  it('builds VSCodium remote SSH URLs', () => {
    expect(buildRemoteEditorUrl('vscodium', 'example.com', 'alice', '/repo')).toBe(
      'vscodium://vscode-remote/ssh-remote+alice%40example.com/repo'
    );
  });
});
