import { describe, expect, it } from 'vitest';

import {
  computeNextCloneDestination,
  deriveCloneProjectArgs,
  endsWithSeparator,
  joinPath,
  parseGitHubRepoUrl,
  splitPathForDisplay,
  stripTrailingSeparators,
} from './projectCloneDestination';

describe('projectCloneDestination', () => {
  describe('parseGitHubRepoUrl', () => {
    it('parses https GitHub repo URLs', () => {
      const parsed = parseGitHubRepoUrl('https://github.com/foo/bar');
      expect(parsed).toEqual({
        owner: 'foo',
        repo: 'bar',
        normalizedUrl: 'https://github.com/foo/bar',
      });
    });

    it('accepts .git and trailing slashes', () => {
      expect(parseGitHubRepoUrl('https://github.com/foo/bar.git')?.repo).toBe('bar');
      expect(parseGitHubRepoUrl('https://github.com/foo/bar/')?.repo).toBe('bar');
      expect(parseGitHubRepoUrl('https://github.com/foo/bar.git/')?.repo).toBe('bar');
    });

    it('accepts extra path segments and canonicalizes to repo root', () => {
      expect(parseGitHubRepoUrl('https://github.com/foo/bar/issues/273')?.normalizedUrl).toBe(
        'https://github.com/foo/bar'
      );
      expect(parseGitHubRepoUrl('https://github.com/foo/bar/pull/123')?.normalizedUrl).toBe(
        'https://github.com/foo/bar'
      );
      expect(parseGitHubRepoUrl('https://github.com/foo/bar/pr/123')?.normalizedUrl).toBe(
        'https://github.com/foo/bar'
      );
      expect(parseGitHubRepoUrl('https://github.com/foo/bar/blob/main/README.md')?.normalizedUrl).toBe(
        'https://github.com/foo/bar'
      );
    });

    it('accepts query strings and hashes', () => {
      expect(parseGitHubRepoUrl('https://github.com/foo/bar?tab=readme')?.normalizedUrl).toBe(
        'https://github.com/foo/bar'
      );
      expect(parseGitHubRepoUrl('https://github.com/foo/bar#readme')?.normalizedUrl).toBe(
        'https://github.com/foo/bar'
      );
      expect(parseGitHubRepoUrl('https://github.com/foo/bar.git?tab=readme')?.normalizedUrl).toBe(
        'https://github.com/foo/bar'
      );
    });

    it('accepts SSH GitHub repo URLs', () => {
      expect(parseGitHubRepoUrl('git@github.com:foo/bar.git')?.repo).toBe('bar');
      expect(parseGitHubRepoUrl('ssh://git@github.com/foo/bar.git')?.repo).toBe('bar');
    });

    it('accepts case and www variants', () => {
      expect(parseGitHubRepoUrl('HTTPS://GITHUB.COM/foo/bar')?.repo).toBe('bar');
      expect(parseGitHubRepoUrl('https://www.github.com/foo/bar')?.repo).toBe('bar');
    });

    it('rejects non-repo and non-GitHub URLs', () => {
      expect(parseGitHubRepoUrl('https://github.com/foo')).toBeNull();
      expect(parseGitHubRepoUrl('https://gitlab.com/foo/bar')).toBeNull();
      expect(parseGitHubRepoUrl('not a url')).toBeNull();
    });
  });

  describe('path helpers', () => {
    it('detects and strips trailing separators', () => {
      expect(endsWithSeparator('/tmp/')).toBe(true);
      expect(stripTrailingSeparators('/tmp/')).toBe('/tmp');
      expect(stripTrailingSeparators('/')).toBe('/');
      expect(stripTrailingSeparators('////')).toBe('/');
      expect(stripTrailingSeparators('')).toBe('');
    });

    it('splits paths for display', () => {
      expect(splitPathForDisplay('/Users/me/Emdash/repo')).toEqual({
        prefix: '/Users/me/Emdash/',
        name: 'repo',
      });
      expect(splitPathForDisplay('/Users/me/Emdash/')).toEqual({
        prefix: '/Users/me/',
        name: 'Emdash',
      });
      expect(splitPathForDisplay('repo')).toEqual({ prefix: '', name: 'repo' });
      expect(splitPathForDisplay('/')).toEqual({ prefix: '/', name: '' });
    });

    it('joins paths safely', () => {
      expect(joinPath('/Users/me/Emdash', 'repo', '/')).toBe('/Users/me/Emdash/repo');
      expect(joinPath('/Users/me/Emdash/', '/repo', '/')).toBe('/Users/me/Emdash/repo');
      expect(joinPath('/', 'repo', '/')).toBe('/repo');
      expect(joinPath('C:\\', 'repo', '\\')).toBe('C:\\repo');
    });
  });

  describe('deriveCloneProjectArgs', () => {
    const defaultBasePath = '/Users/me/Emdash';

    it('treats an empty destination as default base + repo', () => {
      expect(
        deriveCloneProjectArgs({
          destinationPath: '',
          defaultBasePath,
          repoNameFromUrl: 'repo',
        })
      ).toEqual({ parentDir: defaultBasePath, repoName: 'repo' });
    });

    it('treats the default base path as a parent directory', () => {
      expect(
        deriveCloneProjectArgs({
          destinationPath: defaultBasePath,
          defaultBasePath,
          repoNameFromUrl: 'repo',
        })
      ).toEqual({ parentDir: defaultBasePath, repoName: 'repo' });
    });

    it('treats a trailing separator as a parent directory', () => {
      expect(
        deriveCloneProjectArgs({
          destinationPath: '/tmp/',
          defaultBasePath,
          repoNameFromUrl: 'repo',
        })
      ).toEqual({ parentDir: '/tmp', repoName: 'repo' });
    });

    it('treats a full path as parent + final segment', () => {
      expect(
        deriveCloneProjectArgs({
          destinationPath: '/tmp/custom',
          defaultBasePath,
          repoNameFromUrl: 'repo',
        })
      ).toEqual({ parentDir: '/tmp', repoName: 'custom' });
    });

    it('falls back to the default base when no parent dir is provided', () => {
      expect(
        deriveCloneProjectArgs({
          destinationPath: 'custom',
          defaultBasePath,
          repoNameFromUrl: 'repo',
        })
      ).toEqual({ parentDir: defaultBasePath, repoName: 'custom' });
    });

    it('handles root destinations', () => {
      expect(
        deriveCloneProjectArgs({
          destinationPath: '/',
          defaultBasePath,
          repoNameFromUrl: 'repo',
        })
      ).toEqual({ parentDir: '/', repoName: 'repo' });
    });
  });

  describe('computeNextCloneDestination', () => {
    const defaultBasePath = '/Users/me/Emdash';

    it('auto-fills under the default base when untouched', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: defaultBasePath,
          defaultBasePath,
          repoName: 'repo',
          sep: '/',
          destinationTouched: false,
          lastAutoRepoName: null,
        })
      ).toEqual({
        shouldUpdate: true,
        nextDestination: '/Users/me/Emdash/repo',
        nextLastAutoRepoName: 'repo',
      });
    });

    it('updates only the final segment when it matches the last auto repo', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: '/tmp/old',
          defaultBasePath,
          repoName: 'new',
          sep: '/',
          destinationTouched: true,
          lastAutoRepoName: 'old',
        })
      ).toEqual({
        shouldUpdate: true,
        nextDestination: '/tmp/new',
        nextLastAutoRepoName: 'new',
      });
    });

    it('does not overwrite a custom repo name', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: '/tmp/custom',
          defaultBasePath,
          repoName: 'new',
          sep: '/',
          destinationTouched: true,
          lastAutoRepoName: 'old',
        })
      ).toEqual({
        shouldUpdate: false,
        nextDestination: '/tmp/custom',
        nextLastAutoRepoName: 'old',
      });
    });

    it('re-populates after clearing the destination', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: '',
          defaultBasePath,
          repoName: 'repo',
          sep: '/',
          destinationTouched: true,
          lastAutoRepoName: 'old',
        })
      ).toEqual({
        shouldUpdate: true,
        nextDestination: '/Users/me/Emdash/repo',
        nextLastAutoRepoName: 'repo',
      });
    });

    it('treats a trailing separator as a base directory', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: '/tmp/',
          defaultBasePath,
          repoName: 'repo',
          sep: '/',
          destinationTouched: true,
          lastAutoRepoName: null,
        })
      ).toEqual({
        shouldUpdate: true,
        nextDestination: '/tmp/repo',
        nextLastAutoRepoName: 'repo',
      });
    });

    it('treats a custom base directory as base directory before first auto-fill', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: '/tmp/custom',
          defaultBasePath,
          repoName: 'repo',
          sep: '/',
          destinationTouched: true,
          lastAutoRepoName: null,
        })
      ).toEqual({
        shouldUpdate: true,
        nextDestination: '/tmp/custom/repo',
        nextLastAutoRepoName: 'repo',
      });
    });

    it('does not duplicate when destination already ends with repo name before first auto-fill', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: '/tmp/repo',
          defaultBasePath,
          repoName: 'repo',
          sep: '/',
          destinationTouched: true,
          lastAutoRepoName: null,
        })
      ).toEqual({
        shouldUpdate: true,
        nextDestination: '/tmp/repo',
        nextLastAutoRepoName: 'repo',
      });
    });

    it('ignores default base while editing custom destination', () => {
      expect(
        computeNextCloneDestination({
          currentDestination: '/Users/me/Emdash',
          defaultBasePath,
          repoName: 'repo',
          sep: '/',
          destinationTouched: true,
          lastAutoRepoName: 'repo',
        })
      ).toEqual({
        shouldUpdate: false,
        nextDestination: '/Users/me/Emdash',
        nextLastAutoRepoName: 'repo',
      });
    });
  });
});
