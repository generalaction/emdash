import { minimatch } from 'minimatch';
import {
  isCiEventKind,
  isIssueEventKind,
  isPrEventKind,
  type AutomationEvent,
  type EventTriggerFilters,
} from '@shared/automations/events';

function branchOf(event: AutomationEvent): string | null {
  if (isPrEventKind(event.kind)) {
    return 'baseBranch' in event.payload ? event.payload.baseBranch : null;
  }
  if (isCiEventKind(event.kind)) {
    return 'branch' in event.payload ? event.payload.branch : null;
  }
  return null;
}

function authorOf(event: AutomationEvent): string | null {
  if (isPrEventKind(event.kind) || isIssueEventKind(event.kind)) {
    return 'author' in event.payload ? event.payload.author : null;
  }
  return null;
}

function isNonEmpty(list: string[] | undefined): list is string[] {
  return Array.isArray(list) && list.length > 0;
}

function matchesAnyGlob(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(value, pattern));
}

function authorEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function eventMatchesFilters(
  event: AutomationEvent,
  filters: EventTriggerFilters | undefined
): boolean {
  if (!filters) return true;

  if (isNonEmpty(filters.branches)) {
    const branch = branchOf(event);
    if (branch !== null && !matchesAnyGlob(branch, filters.branches)) return false;
  }

  const author = authorOf(event);
  if (author !== null) {
    if (
      isNonEmpty(filters.authorsExclude) &&
      filters.authorsExclude.some((entry) => authorEquals(entry, author))
    ) {
      return false;
    }
    if (
      isNonEmpty(filters.authorsInclude) &&
      !filters.authorsInclude.some((entry) => authorEquals(entry, author))
    ) {
      return false;
    }
  }

  return true;
}
