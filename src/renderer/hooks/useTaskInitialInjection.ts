import { useMemo } from 'react';
import type { TaskMetadata } from '../types/chat';

interface UseTaskInitialInjectionParams {
  metadata: TaskMetadata | null | undefined;
  isTerminal: boolean;
  isMainConversation: boolean;
  commentsContext: string | null;
}

const MAX_BODY_LENGTH = 1500;

function clip(text: string): string {
  return text.length > MAX_BODY_LENGTH ? text.slice(0, MAX_BODY_LENGTH) + '\n…' : text;
}

function withComments(content: string, commentsContext: string | null): string {
  if (!commentsContext) return content;
  return `The user has left the following comments on the code changes:\n\n${commentsContext}\n\n${content}`;
}

/**
 * Assembles the initial injection string for an agent session from task metadata:
 * Linear issue, GitHub issue, Jira issue, inline comments, or a plain initialPrompt.
 * Returns null when the session is not a terminal or not the main conversation.
 */
export function useTaskInitialInjection({
  metadata,
  isTerminal,
  isMainConversation,
  commentsContext,
}: UseTaskInitialInjectionParams): string | null {
  return useMemo(() => {
    if (!isTerminal) return null;
    if (!isMainConversation) return null;

    const md = metadata ?? null;
    const p = (md?.initialPrompt || '').trim();
    if (p) return p;

    const issue = md?.linearIssue;
    if (issue) {
      const parts: string[] = [];
      const linearTitle = issue.title ? ' — ' + issue.title : '';
      parts.push(`Linked Linear issue: ${issue.identifier}${linearTitle}`);
      const details: string[] = [];
      if (issue.state?.name) details.push(`State: ${issue.state.name}`);
      if (issue.assignee?.displayName || issue.assignee?.name)
        details.push(`Assignee: ${issue.assignee?.displayName || issue.assignee?.name}`);
      if (issue.team?.key) details.push(`Team: ${issue.team.key}`);
      if (issue.project?.name) details.push(`Project: ${issue.project.name}`);
      if (details.length) parts.push(`Details: ${details.join(' • ')}`);
      if (issue.url) parts.push(`URL: ${issue.url}`);
      const desc = (issue as { description?: unknown })?.description;
      if (typeof desc === 'string' && desc.trim()) {
        parts.push('', 'Issue Description:', clip(desc.trim()));
      }
      return withComments(parts.join('\n'), commentsContext);
    }

    const gh = md?.githubIssue;
    if (gh) {
      const parts: string[] = [];
      const ghTitle = gh.title ? ' — ' + gh.title : '';
      parts.push(`Linked GitHub issue: #${gh.number}${ghTitle}`);
      const details: string[] = [];
      if (gh.state) details.push(`State: ${gh.state}`);
      try {
        const assignees = Array.isArray(gh.assignees)
          ? gh.assignees
              .map((a) => a?.name || a?.login)
              .filter(Boolean)
              .join(', ')
          : '';
        if (assignees) details.push(`Assignees: ${assignees}`);
      } catch {}
      try {
        const labels = Array.isArray(gh.labels)
          ? gh.labels
              .map((l) => l?.name)
              .filter(Boolean)
              .join(', ')
          : '';
        if (labels) details.push(`Labels: ${labels}`);
      } catch {}
      if (details.length) parts.push(`Details: ${details.join(' • ')}`);
      if (gh.url) parts.push(`URL: ${gh.url}`);
      const body = typeof gh.body === 'string' ? gh.body.trim() : '';
      if (body) parts.push('', 'Issue Description:', clip(body));
      return withComments(parts.join('\n'), commentsContext);
    }

    const j = md?.jiraIssue;
    if (j) {
      const lines: string[] = [];
      const jiraSummary = j.summary ? ' — ' + j.summary : '';
      lines.push(`Linked Jira issue: ${j.key}${jiraSummary}`);
      const details: string[] = [];
      if (j.status?.name) details.push(`Status: ${j.status.name}`);
      if (j.assignee?.displayName || j.assignee?.name)
        details.push(`Assignee: ${j.assignee?.displayName || j.assignee?.name}`);
      if (j.project?.key) details.push(`Project: ${j.project.key}`);
      if (details.length) lines.push(`Details: ${details.join(' • ')}`);
      if (j.url) lines.push(`URL: ${j.url}`);
      const desc = typeof j.description === 'string' ? j.description.trim() : '';
      if (desc) lines.push('', 'Issue Description:', clip(desc));
      return withComments(lines.join('\n'), commentsContext);
    }

    if (commentsContext) {
      return `The user has left the following comments on the code changes:\n\n${commentsContext}`;
    }
    return null;
  }, [isTerminal, isMainConversation, metadata, commentsContext]);
}
