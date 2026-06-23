import { describe, expect, it } from 'vitest';
import { inferMethod } from './location-hints';

describe('inferMethod', () => {
  describe('macOS', () => {
    it('identifies homebrew installs from /opt/homebrew/', () => {
      expect(inferMethod('/opt/homebrew/Cellar/claude/1.0.0/bin/claude', 'macos')).toBe('homebrew');
    });

    it('identifies homebrew installs from /opt/homebrew/bin/', () => {
      expect(inferMethod('/opt/homebrew/bin/claude', 'macos')).toBe('homebrew');
    });

    it('identifies homebrew installs from /usr/local/Cellar/', () => {
      expect(inferMethod('/usr/local/Cellar/goose/2.3.1/bin/goose', 'macos')).toBe('homebrew');
    });

    it('identifies homebrew installs from /usr/local/opt/', () => {
      expect(inferMethod('/usr/local/opt/node@20/bin/node', 'macos')).toBe('homebrew');
    });

    it('identifies macOS app bundle installs', () => {
      expect(inferMethod('/Applications/Claude.app/Contents/MacOS/claude', 'macos')).toBe(
        'installer-macos'
      );
    });

    it('identifies npm global installs via node_modules', () => {
      expect(
        inferMethod('/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude', 'macos')
      ).toBe('npm');
    });

    it('identifies npm installs via .nvm', () => {
      expect(inferMethod('/Users/user/.nvm/versions/node/v20.0.0/bin/claude', 'macos')).toBe('npm');
    });

    it('identifies cargo installs', () => {
      expect(inferMethod('/Users/user/.cargo/bin/aichat', 'macos')).toBe('cargo');
    });

    it('identifies pip installs via site-packages', () => {
      expect(
        inferMethod('/usr/local/lib/python3.11/site-packages/aider/__main__.py', 'macos')
      ).toBe('pip');
    });

    it('identifies curl/user-install scripts via .local/bin', () => {
      expect(inferMethod('/Users/user/.local/bin/goose', 'macos')).toBe('curl');
    });

    it('returns null for unrecognised paths', () => {
      expect(inferMethod('/usr/local/bin/something', 'macos')).toBeNull();
    });

    it('is case-insensitive', () => {
      expect(inferMethod('/opt/Homebrew/bin/claude', 'macos')).toBe('homebrew');
    });
  });

  describe('linux', () => {
    it('identifies linuxbrew', () => {
      expect(inferMethod('/home/linuxbrew/.linuxbrew/bin/claude', 'linux')).toBe('homebrew');
    });

    it('identifies apt installs from /usr/bin/', () => {
      expect(inferMethod('/usr/bin/git', 'linux')).toBe('apt');
    });

    it('identifies apt installs from /usr/sbin/', () => {
      expect(inferMethod('/usr/sbin/nginx', 'linux')).toBe('apt');
    });

    it('identifies npm global installs', () => {
      expect(inferMethod('/usr/local/lib/node_modules/.bin/claude', 'linux')).toBe('npm');
    });

    it('identifies cargo installs', () => {
      expect(inferMethod('/home/user/.cargo/bin/aichat', 'linux')).toBe('cargo');
    });

    it('identifies curl/user installs via .local/bin', () => {
      expect(inferMethod('/home/user/.local/bin/goose', 'linux')).toBe('curl');
    });

    it('returns null for unrecognised paths', () => {
      expect(inferMethod('/usr/local/bin/something', 'linux')).toBeNull();
    });
  });

  describe('windows', () => {
    it('identifies winget installs', () => {
      expect(
        inferMethod(
          'C:\\Users\\user\\AppData\\Local\\Microsoft\\WindowsApps\\claude.exe',
          'windows'
        )
      ).toBe('winget');
    });

    it('identifies npm global installs', () => {
      expect(inferMethod('C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd', 'windows')).toBe(
        'npm'
      );
    });

    it('identifies cargo installs', () => {
      expect(inferMethod('C:\\Users\\user\\.cargo\\bin\\aichat.exe', 'windows')).toBe('cargo');
    });

    it('returns null for unrecognised paths', () => {
      expect(inferMethod('C:\\Users\\user\\custom\\bin\\tool.exe', 'windows')).toBeNull();
    });
  });

  describe('cross-platform', () => {
    it('does not match macOS hints on linux', () => {
      expect(inferMethod('/opt/homebrew/bin/claude', 'linux')).toBeNull();
    });

    it('does not match linux hints on macos', () => {
      expect(inferMethod('/usr/bin/claude', 'macos')).toBeNull();
    });

    it('returns null for empty path', () => {
      expect(inferMethod('', 'macos')).toBeNull();
    });
  });
});
