import { PROVIDER_IDS, type ProviderId } from './providers/registry';

// Delimiter chosen to be unambiguous — providers are validated against PROVIDER_IDS
const MAIN_SEP = '-main-';
const CHAT_SEP = '-chat-';

export type PtyIdKind = 'main' | 'chat';

export function makePtyId(provider: ProviderId, kind: PtyIdKind, suffix: string): string {
  const sep = kind === 'main' ? MAIN_SEP : CHAT_SEP;
  return `${provider}${sep}${suffix}`;
}

export function parsePtyId(id: string): {
  providerId: ProviderId;
  kind: PtyIdKind;
  suffix: string; // taskId for 'main', conversationId for 'chat'
} | null {
  // Try each known provider prefix to avoid ambiguity from greedy matching.
  // Longest-first so e.g. "continue" is tried before a hypothetical "co".
  const sorted = [...PROVIDER_IDS].sort((a, b) => b.length - a.length);
  for (const pid of sorted) {
    if (id.startsWith(pid + MAIN_SEP)) {
      return { providerId: pid, kind: 'main', suffix: id.slice(pid.length + MAIN_SEP.length) };
    }
    if (id.startsWith(pid + CHAT_SEP)) {
      return { providerId: pid, kind: 'chat', suffix: id.slice(pid.length + CHAT_SEP.length) };
    }
  }
  return null;
}

/** Quick check without full parse */
export function isMainPty(id: string): boolean {
  return id.includes(MAIN_SEP);
}

export function isChatPty(id: string): boolean {
  return id.includes(CHAT_SEP) && !id.includes(MAIN_SEP);
}
