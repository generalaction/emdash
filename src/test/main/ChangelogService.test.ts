import { describe, expect, it } from 'vitest';
import { compareChangelogVersions, normalizeChangelogVersion } from '../../shared/changelog';
import { parseChangelogHtml } from '../../main/services/ChangelogService';

describe('normalizeChangelogVersion', () => {
  it('strips a leading v prefix', () => {
    expect(normalizeChangelogVersion('v1.2.3')).toBe('1.2.3');
  });

  it('returns null for invalid values', () => {
    expect(normalizeChangelogVersion('latest')).toBeNull();
  });
});

describe('compareChangelogVersions', () => {
  it('sorts stable versions numerically', () => {
    expect(compareChangelogVersions('1.10.0', '1.2.0')).toBeGreaterThan(0);
  });

  it('treats stable releases as newer than prereleases', () => {
    expect(compareChangelogVersions('1.2.0', '1.2.0-beta.1')).toBeGreaterThan(0);
  });
});

describe('parseChangelogHtml', () => {
  const html = `
    <main>
      <article data-version="0.4.30">
        <time datetime="2026-03-01">Mar 1, 2026</time>
        <h2>Task polish release</h2>
        <p>Improves task creation.</p>
        <h3>Quick create</h3>
        <p>Create tasks faster from the sidebar.</p>
      </article>
      <article data-version="0.4.31">
        <time datetime="2026-03-12">Mar 12, 2026</time>
        <h2>Changelog notifications</h2>
        <p>See release notes directly in the app.</p>
        <h3>Sidebar card</h3>
        <p>A compact notification lives at the bottom of the sidebar.</p>
        <ul>
          <li>Dismiss per version</li>
          <li>Open the full modal</li>
        </ul>
      </article>
    </main>
  `;

  it('picks the exact requested version when present', () => {
    const entry = parseChangelogHtml(html, '0.4.30');

    expect(entry?.version).toBe('0.4.30');
    expect(entry?.title).toBe('Task polish release');
    expect(entry?.summary).toContain('Improves task creation');
  });

  it('falls back to the newest entry when no version is requested', () => {
    const entry = parseChangelogHtml(html);

    expect(entry?.version).toBe('0.4.31');
    expect(entry?.title).toBe('Changelog notifications');
    expect(entry?.content).toContain('## Sidebar card');
    expect(entry?.content).toContain('- Dismiss per version');
  });
});
