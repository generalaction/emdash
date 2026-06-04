import { redactDiagnosticLog } from '@main/lib/file-logger';

const DEFAULT_MAX_CHARS = 8_192;

export type AcpDiagnosticEntry = {
  source: 'stdout' | 'stderr' | 'transport';
  message: string;
  timestamp: number;
};

export class AcpDiagnosticsBuffer {
  private entries: AcpDiagnosticEntry[] = [];
  private totalChars = 0;

  constructor(private readonly maxChars: number = DEFAULT_MAX_CHARS) {}

  append(source: AcpDiagnosticEntry['source'], message: string): void {
    const redacted = this.truncate(redactDiagnosticLog(message));
    if (!redacted) return;

    const entry = {
      source,
      message: redacted,
      timestamp: Date.now(),
    };
    this.entries.push(entry);
    this.totalChars += entry.message.length;
    this.trim();
  }

  snapshot(): AcpDiagnosticEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  summary(): string {
    return this.entries.map((entry) => `[${entry.source}] ${entry.message}`).join('\n');
  }

  private trim(): void {
    while (this.totalChars > this.maxChars && this.entries.length > 0) {
      const removed = this.entries.shift();
      this.totalChars -= removed?.message.length ?? 0;
    }
  }

  private truncate(message: string): string {
    if (message.length <= this.maxChars) return message;
    return message.slice(-this.maxChars);
  }
}
