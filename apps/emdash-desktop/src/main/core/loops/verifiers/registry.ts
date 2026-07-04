import { agentBrowserVerifier } from './agent-browser';
import { convexVerifier } from './convex';
import { ghVerifier } from './gh';
import type { BuiltInVerifierId, LoopVerifier } from './types';
import { unitTestsVerifier } from './unit-tests';
import { vercelVerifier } from './vercel';

const verifiers = new Map<BuiltInVerifierId, LoopVerifier>(
  [unitTestsVerifier, ghVerifier, vercelVerifier, convexVerifier, agentBrowserVerifier].map(
    (verifier) => [verifier.id, verifier]
  )
);

export function getVerifier(id: BuiltInVerifierId): LoopVerifier | undefined {
  return verifiers.get(id);
}

export function listVerifiers(): LoopVerifier[] {
  return Array.from(verifiers.values());
}

export function requireVerifier(id: BuiltInVerifierId): LoopVerifier {
  const verifier = getVerifier(id);
  if (!verifier) throw new Error(`Unknown verifier: ${id}`);
  return verifier;
}
