import type { AgentIconVariant } from '@shared/core/agents/agent-payload';

/** Pick the variant with the largest minSize that fits the rendered size. */
export function pickIconVariant(variants: AgentIconVariant[], size: number): AgentIconVariant {
  return (
    [...variants].sort((a, b) => b.minSize - a.minSize).find((v) => v.minSize <= size) ??
    variants[0]
  );
}
