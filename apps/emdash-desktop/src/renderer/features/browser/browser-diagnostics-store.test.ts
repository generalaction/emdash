import { describe, expect, it } from 'vitest';
import { BrowserDiagnosticsStore } from './browser-diagnostics-store';

describe('BrowserDiagnosticsStore', () => {
  it('bounds diagnostics per browser and keeps newest entries', () => {
    const store = new BrowserDiagnosticsStore();

    for (let i = 0; i < 205; i++) {
      store.append({
        browserId: 'browser-1',
        level: 'info',
        source: 'console',
        message: `message-${i}`,
        timestamp: i,
      });
    }

    const entries = store.entriesForBrowser('browser-1');
    expect(entries).toHaveLength(200);
    expect(entries[0].message).toBe('message-5');
    expect(entries.at(-1)?.message).toBe('message-204');
  });

  it('redacts common secret-shaped diagnostics', () => {
    const store = new BrowserDiagnosticsStore();

    const entry = store.append({
      browserId: 'browser-1',
      level: 'error',
      source: 'console',
      message: 'Authorization failed bearer abc.def token=secret-value',
    });

    expect(entry.message).toBe('Authorization failed bearer [REDACTED] token=[REDACTED]');
  });
});
