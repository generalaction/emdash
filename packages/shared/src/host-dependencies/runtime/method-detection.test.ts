import { describe, expect, it } from 'vitest';
import type { IExecutionContext } from '../../exec/execution-context';
import { createInstallMethodDetector } from './method-detection';

function makeCtx(
  handler: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: handler as IExecutionContext['exec'],
    execStreaming: async () => {},
    dispose: () => {},
  } as unknown as IExecutionContext;
}

/** Returns a ctx where brew and npm queries produce stable roots. */
function makeRootCtx(brewCellar: string | null, npmRoot: string | null): IExecutionContext {
  return makeCtx(async (command, args = []) => {
    if (command === 'brew' && args[0] === '--cellar') {
      if (brewCellar === null) throw new Error('brew not found');
      return { stdout: `${brewCellar}\n`, stderr: '' };
    }
    if (command === 'npm' && args[0] === 'root') {
      if (npmRoot === null) throw new Error('npm not found');
      return { stdout: `${npmRoot}\n`, stderr: '' };
    }
    throw new Error(`unexpected: ${command} ${args.join(' ')}`);
  });
}

describe('createInstallMethodDetector', () => {
  describe('homebrew detection', () => {
    it('returns homebrew when realpath is under brew --cellar', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      expect(await detector.detect('/opt/homebrew/Cellar/claude-code/1.2.3/bin/claude')).toBe(
        'homebrew'
      );
    });

    it('returns homebrew for Cellar path containing node_modules (avoids npm misattribution)', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', '/opt/homebrew/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'macos');
      // A Homebrew formula that is a node CLI — realpath is under Cellar AND node_modules.
      // The detector must return 'homebrew', not 'npm'.
      expect(
        await detector.detect(
          '/opt/homebrew/Cellar/claude-code/1.2.3/libexec/lib/node_modules/@anthropic-ai/claude-code/bin/claude'
        )
      ).toBe('homebrew');
    });

    it('returns homebrew for Intel Mac Cellar at /usr/local/Cellar', async () => {
      const ctx = makeRootCtx('/usr/local/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      expect(await detector.detect('/usr/local/Cellar/goose/2.3.1/bin/goose')).toBe('homebrew');
    });

    it('returns homebrew for linuxbrew Cellar', async () => {
      const ctx = makeRootCtx('/home/linuxbrew/.linuxbrew/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'linux');
      expect(
        await detector.detect('/home/linuxbrew/.linuxbrew/Cellar/claude/1.0.0/bin/claude')
      ).toBe('homebrew');
    });

    it('is case-insensitive for homebrew', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      expect(await detector.detect('/opt/Homebrew/Cellar/claude/1.0.0/bin/claude')).toBe(
        'homebrew'
      );
    });
  });

  describe('npm detection', () => {
    it('returns npm when realpath is under npm root -g', async () => {
      const ctx = makeRootCtx(null, '/Users/user/.nvm/versions/node/v22.0.0/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'macos');
      expect(
        await detector.detect(
          '/Users/user/.nvm/versions/node/v22.0.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude'
        )
      ).toBe('npm');
    });

    it('returns npm for npm global on brew-managed node (path under brew prefix but not Cellar)', async () => {
      // Node.js itself is a brew formula but npm installs packages into lib/node_modules
      // under the prefix — NOT under Cellar. This ensures npm wins over the fallback hints.
      const ctx = makeRootCtx('/opt/homebrew/Cellar', '/opt/homebrew/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'macos');
      // This path is under /opt/homebrew/lib/node_modules (npm root), but NOT under Cellar
      expect(
        await detector.detect('/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude')
      ).toBe('npm');
    });

    it('is case-insensitive for npm', async () => {
      const ctx = makeRootCtx(null, '/usr/local/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'linux');
      expect(await detector.detect('/usr/local/lib/Node_Modules/@openai/codex/bin/codex')).toBe(
        'npm'
      );
    });
  });

  describe('fallback to inferMethod', () => {
    it('returns cargo when neither brew nor npm matches', async () => {
      const ctx = makeRootCtx(null, null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      expect(await detector.detect('/Users/user/.cargo/bin/aichat')).toBe('cargo');
    });

    it('returns null for an unrecognised path when both tools are absent', async () => {
      const ctx = makeRootCtx(null, null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      expect(await detector.detect('/usr/local/bin/something')).toBeNull();
    });

    it('falls back to inferMethod when brew query fails', async () => {
      // brew not installed, npm not installed — cargo hint should still work
      const ctx = makeRootCtx(null, null);
      const detector = createInstallMethodDetector(ctx, 'linux');
      expect(await detector.detect('/home/user/.cargo/bin/aichat')).toBe('cargo');
    });

    it('falls back to inferMethod hints on Windows (brew not queried)', async () => {
      // Windows: brew is skipped; npm is queried but not available; fallback to winget hint
      const ctx = makeCtx(async (command) => {
        if (command === 'npm') {
          throw new Error('npm not found');
        }
        throw new Error(`unexpected: ${command}`);
      });
      const detector = createInstallMethodDetector(ctx, 'windows');
      expect(
        await detector.detect('C:\\Users\\user\\AppData\\Local\\Microsoft\\WindowsApps\\claude.exe')
      ).toBe('winget');
    });
  });

  describe('memoisation', () => {
    it('queries brew --cellar only once across multiple detect calls', async () => {
      let brewCallCount = 0;
      const ctx = makeCtx(async (command, args = []) => {
        if (command === 'brew' && args[0] === '--cellar') {
          brewCallCount++;
          return { stdout: '/opt/homebrew/Cellar\n', stderr: '' };
        }
        if (command === 'npm') throw new Error('no npm');
        throw new Error('unexpected');
      });
      const detector = createInstallMethodDetector(ctx, 'macos');

      await detector.detect('/opt/homebrew/Cellar/tool/1.0.0/bin/tool');
      await detector.detect('/opt/homebrew/Cellar/other/2.0.0/bin/other');

      expect(brewCallCount).toBe(1);
    });

    it('queries npm root -g only once across multiple detect calls', async () => {
      let npmCallCount = 0;
      const ctx = makeCtx(async (command, args = []) => {
        if (command === 'brew') throw new Error('no brew');
        if (command === 'npm' && args[0] === 'root') {
          npmCallCount++;
          return { stdout: '/usr/local/lib/node_modules\n', stderr: '' };
        }
        throw new Error('unexpected');
      });
      const detector = createInstallMethodDetector(ctx, 'macos');

      await detector.detect('/usr/local/lib/node_modules/@openai/codex/bin/codex');
      await detector.detect('/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude');

      expect(npmCallCount).toBe(1);
    });
  });
});
