import { makeAutoObservable } from 'mobx';
import type { ParsedAiAnnotation } from '../ai-annotations';

export type AiAnnotation = ParsedAiAnnotation & {
  id: string;
  targetKey: string;
};

const EMPTY: readonly AiAnnotation[] = Object.freeze([]);

/** Read-only agent explanations for diff targets, keyed by draft-comment target key. */
export class AiAnnotationsStore {
  readonly annotationsByTarget = new Map<string, AiAnnotation[]>();
  readonly pendingTargets = new Set<string>();

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  getForTarget(targetKey: string): readonly AiAnnotation[] {
    return this.annotationsByTarget.get(targetKey) ?? EMPTY;
  }

  isPending(targetKey: string): boolean {
    return this.pendingTargets.has(targetKey);
  }

  setPending(targetKey: string, pending: boolean): void {
    if (pending) this.pendingTargets.add(targetKey);
    else this.pendingTargets.delete(targetKey);
  }

  setForTarget(targetKey: string, annotations: readonly ParsedAiAnnotation[]): void {
    if (annotations.length === 0) {
      this.annotationsByTarget.delete(targetKey);
      return;
    }
    this.annotationsByTarget.set(
      targetKey,
      annotations.map((annotation) => ({ ...annotation, id: crypto.randomUUID(), targetKey }))
    );
  }

  dismiss(targetKey: string, id: string): void {
    const remaining = this.getForTarget(targetKey).filter((annotation) => annotation.id !== id);
    this.setForTarget(targetKey, remaining);
  }

  clear(): void {
    this.annotationsByTarget.clear();
    this.pendingTargets.clear();
  }
}
