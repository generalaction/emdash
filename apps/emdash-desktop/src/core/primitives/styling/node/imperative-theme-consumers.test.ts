import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ACTIVE_IMPERATIVE_CONSUMERS = [
  new URL('../../../features/editor/browser/monaco/monaco-themes.ts', import.meta.url),
  new URL('../../../features/terminals/browser/pty/xterm-theme.ts', import.meta.url),
  new URL('../../../features/terminals/api/browser/pty/pty.ts', import.meta.url),
  new URL('../../../features/settings/browser/agents-page/AgentSignInModal.tsx', import.meta.url),
  new URL('../../../features/conversations/browser/conversations-panel.tsx', import.meta.url),
] as const;

describe('active imperative Theme consumer convergence', () => {
  it('keeps legacy handwritten Monaco and Xterm properties out of active consumers', () => {
    const activeSources = ACTIVE_IMPERATIVE_CONSUMERS.map((file) =>
      readFileSync(file, 'utf8')
    ).join('\n');

    expect(activeSources).not.toMatch(/--(?:monaco|xterm)-/);
    expect(activeSources).toContain('monacoThemeIntegration.read');
    expect(activeSources).toContain('xtermThemeIntegration.read');
  });
});
