import { makeAutoObservable } from 'mobx';
import {
  formatBrowserAnnotationsForAgent,
  type BrowserAnnotation,
  type BrowserAnnotationTarget,
} from '@shared/browserAnnotations';

const MAX_BROWSER_ANNOTATIONS_PER_TASK = 200;

type CreateBrowserAnnotationInput = BrowserAnnotationTarget & {
  browserId: string;
  comment: string;
};

function byCreatedAt(a: BrowserAnnotation, b: BrowserAnnotation): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export class BrowserAnnotationsStore {
  readonly annotationsById = new Map<string, BrowserAnnotation>();

  constructor(readonly taskId: string) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get annotations(): BrowserAnnotation[] {
    return Array.from(this.annotationsById.values()).sort(byCreatedAt);
  }

  get pendingAnnotations(): BrowserAnnotation[] {
    return this.annotations.filter((annotation) => annotation.status === 'pending');
  }

  get count(): number {
    return this.annotationsById.size;
  }

  get pendingCount(): number {
    return this.pendingAnnotations.length;
  }

  get formattedForAgent(): string {
    return formatBrowserAnnotationsForAgent(this.pendingAnnotations, { includeIntro: false });
  }

  addAnnotation(input: CreateBrowserAnnotationInput): string {
    if (this.annotationsById.size >= MAX_BROWSER_ANNOTATIONS_PER_TASK) {
      console.warn(
        `BrowserAnnotationsStore: reached ${MAX_BROWSER_ANNOTATIONS_PER_TASK} annotation limit for task ${this.taskId}`
      );
      return crypto.randomUUID();
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.annotationsById.set(id, {
      ...input,
      id,
      taskId: this.taskId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  updateAnnotation(id: string, comment: string): boolean {
    const existing = this.annotationsById.get(id);
    if (!existing) return false;
    this.annotationsById.set(id, {
      ...existing,
      comment,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  dismissAnnotation(id: string): boolean {
    const existing = this.annotationsById.get(id);
    if (!existing) return false;
    this.annotationsById.set(id, {
      ...existing,
      status: 'dismissed',
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  deleteAnnotation(id: string): boolean {
    return this.annotationsById.delete(id);
  }

  consumePending(): string {
    const formatted = this.formattedForAgent;
    for (const annotation of this.pendingAnnotations) {
      this.annotationsById.delete(annotation.id);
    }
    return formatted;
  }

  clear(): void {
    this.annotationsById.clear();
  }

  dispose(): void {
    this.clear();
  }
}
