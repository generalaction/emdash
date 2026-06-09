import { action, computed, makeObservable, observable } from 'mobx';
import type { BrowserDiagnosticsEntry, BrowserDiagnosticsLevel } from '@shared/browser';

const MAX_DIAGNOSTICS_PER_BROWSER = 200;
const MAX_MESSAGE_LENGTH = 2_000;

export type BrowserDiagnosticsInput = {
  browserId: string;
  level: BrowserDiagnosticsLevel;
  source: BrowserDiagnosticsEntry['source'];
  message: string;
  url?: string;
  line?: number;
  column?: number;
  timestamp?: number;
};

export class BrowserDiagnosticsStore {
  readonly entries = observable.map<string, BrowserDiagnosticsEntry[]>();

  constructor() {
    makeObservable(this, {
      entries: observable,
      allEntries: computed,
      append: action,
      clear: action,
      clearBrowser: action,
    });
  }

  get allEntries(): BrowserDiagnosticsEntry[] {
    return Array.from(this.entries.values()).flat();
  }

  entriesForBrowser(browserId: string): BrowserDiagnosticsEntry[] {
    return this.entries.get(browserId) ?? [];
  }

  append(input: BrowserDiagnosticsInput): BrowserDiagnosticsEntry {
    const entry: BrowserDiagnosticsEntry = {
      id: crypto.randomUUID(),
      browserId: input.browserId,
      level: input.level,
      source: input.source,
      message: redactDiagnosticMessage(input.message).slice(0, MAX_MESSAGE_LENGTH),
      url: input.url,
      line: input.line,
      column: input.column,
      timestamp: input.timestamp ?? Date.now(),
    };
    const existing = this.entries.get(input.browserId) ?? [];
    const next = [...existing, entry].slice(-MAX_DIAGNOSTICS_PER_BROWSER);
    this.entries.set(input.browserId, next);
    return entry;
  }

  clearBrowser(browserId: string): void {
    this.entries.delete(browserId);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const browserDiagnosticsStore = new BrowserDiagnosticsStore();

function redactDiagnosticMessage(message: string): string {
  return message
    .replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/(bearer)\s+[a-z0-9._~+/=-]+/gi, '$1 [REDACTED]');
}
