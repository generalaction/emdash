export type PtySignal =
  | 'SIGHUP'
  | 'SIGINT'
  | 'SIGQUIT'
  | 'SIGILL'
  | 'SIGTRAP'
  | 'SIGABRT'
  | 'SIGBUS'
  | 'SIGFPE'
  | 'SIGKILL'
  | 'SIGUSR1'
  | 'SIGSEGV'
  | 'SIGUSR2'
  | 'SIGPIPE'
  | 'SIGALRM'
  | 'SIGTERM'
  | 'SIGCHLD'
  | 'SIGCONT'
  | 'SIGSTOP'
  | 'SIGTSTP'
  | 'SIGTTIN'
  | 'SIGTTOU'
  | 'SIGURG'
  | 'SIGXCPU'
  | 'SIGXFSZ'
  | 'SIGVTALRM'
  | 'SIGPROF'
  | 'SIGWINCH'
  | 'SIGPWR'
  | 'SIGSYS';

export const SIGNAL_BY_NUMBER: Readonly<Record<number, PtySignal>> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  4: 'SIGILL',
  5: 'SIGTRAP',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  9: 'SIGKILL',
  10: 'SIGUSR1',
  11: 'SIGSEGV',
  12: 'SIGUSR2',
  13: 'SIGPIPE',
  14: 'SIGALRM',
  15: 'SIGTERM',
  17: 'SIGCHLD',
  18: 'SIGCONT',
  19: 'SIGSTOP',
  20: 'SIGTSTP',
  21: 'SIGTTIN',
  22: 'SIGTTOU',
  23: 'SIGURG',
  24: 'SIGXCPU',
  25: 'SIGXFSZ',
  26: 'SIGVTALRM',
  27: 'SIGPROF',
  28: 'SIGWINCH',
  30: 'SIGPWR',
  31: 'SIGSYS',
};

const KNOWN_SIGNAL_NAMES = new Set<string>(Object.values(SIGNAL_BY_NUMBER));

export function normalizeSignal(raw: number | string | null | undefined): PtySignal | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return SIGNAL_BY_NUMBER[raw];
  const canonical = raw.startsWith('SIG') ? raw : `SIG${raw}`;
  return KNOWN_SIGNAL_NAMES.has(canonical) ? (canonical as PtySignal) : undefined;
}
