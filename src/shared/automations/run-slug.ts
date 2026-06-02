import { adjectives, nouns } from 'human-id';

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function slugFromRunId(id: string): string {
  const hash = fnv1a(id);
  const adj = adjectives[hash % adjectives.length];
  const noun = nouns[(hash >>> 16) % nouns.length];
  const num = ((hash >>> 8) % 10000).toString().padStart(4, '0');
  return `${adj}-${noun}-${num}`;
}
