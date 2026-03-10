/**
 * Content Workflow Status Management
 *
 * Maps content Kanban columns to task metadata and provides
 * utilities for workflow status transitions.
 */

import { DEFAULT_CONTENT_COLUMNS, type ContentColumn } from './contentKanbanStore';

/**
 * Content workflow stage metadata stored in task.metadata.contentWorkflow
 */
export interface ContentWorkflowMetadata {
  /** Current content workflow stage */
  stage: string;
  /** Collection ID assigned to this task */
  collectionId?: string;
  /** Content brief data */
  brief?: {
    topic?: string;
    audience?: string;
    keywords?: string;
    tone?: string;
    notes?: string;
  };
  /** Timestamp when stage last changed */
  stageChangedAt?: string;
}

/**
 * Get the next stage in the workflow.
 */
export function getNextStage(
  currentStage: string,
  columns: ContentColumn[] = [...DEFAULT_CONTENT_COLUMNS]
): string | null {
  const currentIndex = columns.findIndex((c) => c.id === currentStage);
  if (currentIndex === -1 || currentIndex >= columns.length - 1) {
    return null;
  }
  return columns[currentIndex + 1].id;
}

/**
 * Get the previous stage in the workflow.
 */
export function getPreviousStage(
  currentStage: string,
  columns: ContentColumn[] = [...DEFAULT_CONTENT_COLUMNS]
): string | null {
  const currentIndex = columns.findIndex((c) => c.id === currentStage);
  if (currentIndex <= 0) {
    return null;
  }
  return columns[currentIndex - 1].id;
}

/**
 * Check if task is in a "working" stage (not backlog or final ready stage).
 */
export function isWorkingStage(
  stage: string,
  columns: ContentColumn[] = [...DEFAULT_CONTENT_COLUMNS]
): boolean {
  const index = columns.findIndex((c) => c.id === stage);
  // Not first (backlog) and not last (ready)
  return index > 0 && index < columns.length - 1;
}

/**
 * Check if task is in the final "ready" stage.
 */
export function isReadyStage(
  stage: string,
  columns: ContentColumn[] = [...DEFAULT_CONTENT_COLUMNS]
): boolean {
  const lastColumn = columns[columns.length - 1];
  return lastColumn?.id === stage;
}

/**
 * Get display label for a stage.
 */
export function getStageLabel(
  stage: string,
  columns: ContentColumn[] = [...DEFAULT_CONTENT_COLUMNS]
): string {
  const column = columns.find((c) => c.id === stage);
  return column?.title || stage;
}

/**
 * Parse content workflow metadata from task metadata.
 */
export function parseContentWorkflow(
  metadata: Record<string, unknown> | null | undefined
): ContentWorkflowMetadata | null {
  if (!metadata?.contentWorkflow) return null;
  const cw = metadata.contentWorkflow as ContentWorkflowMetadata;
  if (typeof cw.stage !== 'string') return null;
  return cw;
}

/**
 * Create content workflow metadata object.
 */
export function createContentWorkflowMetadata(
  stage: string,
  collectionId?: string,
  brief?: ContentWorkflowMetadata['brief']
): ContentWorkflowMetadata {
  return {
    stage,
    collectionId,
    brief,
    stageChangedAt: new Date().toISOString(),
  };
}

/**
 * Update stage in content workflow metadata.
 */
export function updateContentWorkflowStage(
  existing: ContentWorkflowMetadata | null,
  newStage: string
): ContentWorkflowMetadata {
  return {
    ...(existing || { stage: newStage }),
    stage: newStage,
    stageChangedAt: new Date().toISOString(),
  };
}
