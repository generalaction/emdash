import { exec, execFile, spawn } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

type PromisifyInput = (...args: never[]) => void;

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: (fn: PromisifyInput) => fn,
  };
});

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// eslint-disable-next-line import/first
import { PrGenerationService } from '../../main/services/PrGenerationService';

/** Type for accessing private methods in tests - using Record to avoid intersection with private members */
type PrGenerationServicePrivate = {
  generateCommitMessageFromFiles: (
    files: string[],
    diff: string
  ) => { message: string; body: string };
  parseCommitMessageResponse: (response: string) => { message: string };
  buildCommitMessagePrompt: (stagedFiles: string[], diff: string) => string;
};

/** Type for mocked exec result */
type ExecResult = { stdout: string; stderr: string };

/** Type for mocked child process from spawn */
type MockedChildProcess = {
  stdout: { on: (event: string, fn: (data: Buffer) => void) => void };
  stderr: { on: () => void };
  stdin: { write: () => void; end: () => void };
  on: (event: string, fn: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  kill: () => void;
};

describe('PrGenerationService', () => {
  let service: PrGenerationService;

  beforeEach(() => {
    service = new PrGenerationService();
    vi.clearAllMocks();
  });

  describe('generateCommitMessageFromFiles', () => {
    // Access private method for testing
    const callGenerateCommitMessageFromFiles = (
      service: PrGenerationService,
      files: string[],
      diff: string
    ) => {
      return (service as unknown as PrGenerationServicePrivate).generateCommitMessageFromFiles(
        files,
        diff
      );
    };

    it('generates test commit for test files only', () => {
      const files = ['src/test/main/Service.test.ts', 'src/test/renderer/Component.spec.tsx'];
      const result = callGenerateCommitMessageFromFiles(service, files, '');

      expect(result.message).toBe('test: update tests');
    });

    it('generates docs commit for documentation files only', () => {
      const files = ['README.md', 'docs/guide.md'];
      const result = callGenerateCommitMessageFromFiles(service, files, '');

      expect(result.message).toBe('docs: update documentation');
    });

    it('generates ci commit for CI files only', () => {
      const files = ['.github/workflows/build.yml', '.github/workflows/test.yml'];
      const result = callGenerateCommitMessageFromFiles(service, files, '');

      expect(result.message).toBe('ci: update CI configuration');
    });

    it('generates style commit for style files only', () => {
      const files = ['src/styles/main.css', 'src/components/Button.styled.ts'];
      const result = callGenerateCommitMessageFromFiles(service, files, '');

      expect(result.message).toBe('style: update styles');
    });

    it('generates chore commit for config files only', () => {
      const files = ['package.json', 'tsconfig.json'];
      const result = callGenerateCommitMessageFromFiles(service, files, '');

      expect(result.message).toBe('chore: update configuration');
    });

    it('extracts scope from component path', () => {
      const files = ['src/components/Button/Button.tsx'];
      const diff = '1 file changed, 10 insertions(+), 5 deletions(-)';
      const result = callGenerateCommitMessageFromFiles(service, files, diff);

      expect(result.message).toContain('Button');
    });

    it('extracts scope from services path', () => {
      const files = ['src/services/AuthService.ts'];
      const diff = '1 file changed, 10 insertions(+), 5 deletions(-)';
      const result = callGenerateCommitMessageFromFiles(service, files, diff);

      expect(result.message).toContain('AuthService');
    });

    it('detects refactor from high deletion ratio', () => {
      const files = ['src/services/OldService.ts'];
      const diff = '1 file changed, 10 insertions(+), 100 deletions(-)';
      const result = callGenerateCommitMessageFromFiles(service, files, diff);

      expect(result.message).toMatch(/^refactor/);
    });

    it('detects feat from high insertion ratio', () => {
      const files = ['src/components/NewFeature.tsx'];
      const diff = '1 file changed, 200 insertions(+), 5 deletions(-)';
      const result = callGenerateCommitMessageFromFiles(service, files, diff);

      expect(result.message).toMatch(/^feat/);
    });

    it('truncates long commit messages', () => {
      const files = ['src/components/VeryLongComponentNameThatExceedsTheMaximumLength.tsx'];
      const diff = '1 file changed, 10 insertions(+), 5 deletions(-)';
      const result = callGenerateCommitMessageFromFiles(service, files, diff);

      expect(result.message.length).toBeLessThanOrEqual(72);
    });

    it('uses scope from multiple files in same scope', () => {
      const files = ['src/components/Button/Button.tsx', 'src/components/Button/index.ts'];
      const diff = '2 files changed, 10 insertions(+), 5 deletions(-)';
      const result = callGenerateCommitMessageFromFiles(service, files, diff);

      expect(result.message).toContain('Button');
    });

    it('uses majority scope when files have mixed scopes', () => {
      const files = [
        'src/components/Button/Button.tsx',
        'src/components/Button/Button.test.tsx',
        'src/components/Button/index.ts',
        'src/utils/helpers.ts',
      ];
      const diff = '4 files changed, 20 insertions(+), 2 deletions(-)';
      const result = callGenerateCommitMessageFromFiles(service, files, diff);

      expect(result.message).toContain('Button');
    });
  });

  describe('parseCommitMessageResponse', () => {
    const callParseCommitMessageResponse = (service: PrGenerationService, response: string) => {
      return (service as unknown as PrGenerationServicePrivate).parseCommitMessageResponse(
        response
      );
    };

    it('parses clean commit message', () => {
      const result = callParseCommitMessageResponse(service, 'feat: add new feature');

      expect(result).toEqual({ message: 'feat: add new feature' });
    });

    it('removes surrounding quotes', () => {
      const result = callParseCommitMessageResponse(service, '"fix: resolve bug"');

      expect(result).toEqual({ message: 'fix: resolve bug' });
    });

    it('removes code block formatting', () => {
      const result = callParseCommitMessageResponse(service, '```\nchore: update deps\n```');

      expect(result).toEqual({ message: 'chore: update deps' });
    });

    it('takes only first line of multi-line response', () => {
      const result = callParseCommitMessageResponse(
        service,
        'feat: add login\n\nThis adds a new login feature with validation.'
      );

      expect(result).toEqual({ message: 'feat: add login' });
    });

    it('returns null for empty response', () => {
      const result = callParseCommitMessageResponse(service, '');

      expect(result).toBeNull();
    });

    it('returns null for explanation-like responses', () => {
      const result = callParseCommitMessageResponse(
        service,
        'Here is the commit message: feat: add feature'
      );

      expect(result).toBeNull();
    });

    it('returns null for "Suggested message:" prefix', () => {
      const result = callParseCommitMessageResponse(service, 'Suggested message: feat: add login');

      expect(result).toBeNull();
    });

    it('returns null for "The commit message is" prefix', () => {
      const result = callParseCommitMessageResponse(
        service,
        'The commit message is: fix: resolve bug'
      );

      expect(result).toBeNull();
    });

    it('returns null for overly long responses', () => {
      const longMessage = 'feat: ' + 'a'.repeat(100);
      const result = callParseCommitMessageResponse(service, longMessage);

      expect(result).toBeNull();
    });

    it('truncates messages over 72 characters', () => {
      const message = 'feat: ' + 'a'.repeat(70); // 76 chars total
      const result = callParseCommitMessageResponse(service, message);

      expect(result?.message.length).toBeLessThanOrEqual(72);
      expect(result?.message).toMatch(/\.\.\.$/);
    });

    it('handles backtick quotes', () => {
      const result = callParseCommitMessageResponse(service, '`fix: resolve issue`');

      expect(result).toEqual({ message: 'fix: resolve issue' });
    });

    it('trims whitespace', () => {
      const result = callParseCommitMessageResponse(service, '  chore: cleanup  \n\n');

      expect(result).toEqual({ message: 'chore: cleanup' });
    });
  });

  describe('generateCommitMessage', () => {
    it('returns parsed commit message when provider CLI succeeds', async () => {
      vi.mocked(exec).mockImplementation(((cmd: string) => {
        if (cmd.includes('--name-only')) {
          return Promise.resolve({ stdout: 'src/foo.ts\n', stderr: '' } as ExecResult);
        }
        if (cmd.includes('--stat')) {
          return Promise.resolve({
            stdout: '1 file changed, 10 insertions(+), 2 deletions(-)\n',
            stderr: '',
          } as ExecResult);
        }
        return Promise.resolve({ stdout: '', stderr: '' } as ExecResult);
      }) as unknown as typeof exec);

      vi.mocked(execFile).mockImplementation((() =>
        Promise.resolve(undefined)) as unknown as typeof execFile);

      const expectedMessage = 'feat(auth): add login';
      vi.mocked(spawn).mockImplementation((() => {
        const child: MockedChildProcess = {
          stdout: {
            on: (_ev: string, fn: (data: Buffer) => void) => {
              fn(Buffer.from(expectedMessage + '\n', 'utf8'));
            },
          },
          stderr: { on: () => {} },
          stdin: { write: () => {}, end: () => {} },
          on: (ev: string, fn: (code: number | null, signal: NodeJS.Signals | null) => void) => {
            if (ev === 'exit') setImmediate(() => fn(0, null));
          },
          kill: () => {},
        };
        return child;
      }) as unknown as typeof spawn);

      const result = await service.generateCommitMessage('/fake/path', 'claude');

      expect(result).toEqual({ message: expectedMessage });
    });
  });

  describe('buildCommitMessagePrompt', () => {
    const callBuildCommitMessagePrompt = (
      service: PrGenerationService,
      stagedFiles: string[],
      diff: string
    ) => {
      return (service as unknown as PrGenerationServicePrivate).buildCommitMessagePrompt(
        stagedFiles,
        diff
      );
    };

    it('includes staged files in prompt', () => {
      const files = ['src/main.ts', 'src/utils.ts'];
      const prompt = callBuildCommitMessagePrompt(service, files, '');

      expect(prompt).toContain('src/main.ts');
      expect(prompt).toContain('src/utils.ts');
    });

    it('includes diff summary in prompt', () => {
      const diff = '2 files changed, 50 insertions(+), 10 deletions(-)';
      const prompt = callBuildCommitMessagePrompt(service, ['file.ts'], diff);

      expect(prompt).toContain('50 insertions');
      expect(prompt).toContain('10 deletions');
    });

    it('truncates very long diffs', () => {
      const longDiff = 'a'.repeat(3000);
      const prompt = callBuildCommitMessagePrompt(service, ['file.ts'], longDiff);

      expect(prompt.length).toBeLessThan(3000 + 500); // diff truncated + prompt text
      expect(prompt).toContain('...');
    });

    it('includes conventional commit format instruction', () => {
      const prompt = callBuildCommitMessagePrompt(service, ['file.ts'], '');

      expect(prompt).toContain('conventional commit');
      expect(prompt).toContain('feat:');
      expect(prompt).toContain('fix:');
    });

    it('requests message under 72 characters', () => {
      const prompt = callBuildCommitMessagePrompt(service, ['file.ts'], '');

      expect(prompt).toContain('72 characters');
    });
  });
});
