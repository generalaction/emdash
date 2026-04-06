import type { Agent } from '../types';
import type {
  AIReviewConfig,
  AIReviewIssue,
  AIReviewResult,
  ReviewDepth,
  ReviewMessage,
} from '@shared/reviewPreset';
import { REVIEW_DEPTH_AGENTS, REVIEW_PROMPTS } from '@shared/reviewPreset';
import { rpc } from './rpc';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';
import { buildReviewConversationMetadata } from '@shared/reviewPreset';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';

const CONVERSATIONS_CHANGED_EVENT = 'emdash:conversations-changed';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export async function captureTerminalSnapshot(ptyId: string): Promise<string> {
  // First try to grab the active session buffer to prevent failure if it hasn't written a snapshot to disk yet
  const activeSession = terminalSessionRegistry.getSession(ptyId);
  if (activeSession) {
    const data = activeSession.getSnapshotData();
    if (data) {
      return data;
    }
  }

  const response = await window.electronAPI.ptyGetSnapshot({ id: ptyId });
  if (!response?.ok || !response.snapshot?.data) {
    throw new Error(
      'Failed to capture terminal snapshot. Please make sure the terminal has produced output.'
    );
  }
  return response.snapshot.data;
}

function buildReviewPrompt(depth: ReviewDepth, content?: string): string {
  const template = REVIEW_PROMPTS.fileChanges[depth];
  if (!template) {
    throw new Error(`No review prompt found for file-changes/${depth}`);
  }
  if (content) {
    return `${template}\n\n--- Content to review ---\n${content}`;
  }
  return template;
}

export async function startReviewAgentPty(args: {
  taskId: string;
  taskPath: string;
  conversationId: string;
  providerId: ProviderId;
  initialPrompt: string;
}): Promise<{ ptyId: string; started: boolean }> {
  const ptyId = makePtyId(args.providerId, 'chat', args.conversationId);

  const result = await window.electronAPI.ptyStartDirect({
    id: ptyId,
    providerId: args.providerId,
    cwd: args.taskPath,
    cols: 120,
    rows: 40,
    initialPrompt: args.initialPrompt,
    env: {},
    resume: false,
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Failed to start PTY');
  }

  return { ptyId, started: true };
}

export async function launchReviewAgent(args: {
  taskId: string;
  taskPath: string;
  reviewId: string;
  agent: Agent;
  prompt: string;
}): Promise<{ conversationId: string; ptyId: string }> {
  const conversation = await rpc.db.createConversation({
    taskId: args.taskId,
    title: `Review ${args.reviewId.slice(0, 8)}`,
    provider: args.agent,
    isMain: false,
    metadata: buildReviewConversationMetadata(args.prompt),
  });

  window.dispatchEvent(
    new CustomEvent(CONVERSATIONS_CHANGED_EVENT, {
      detail: { taskId: args.taskId, conversationId: conversation.id },
    })
  );

  // Start the PTY for this review agent
  const { ptyId } = await startReviewAgentPty({
    taskId: args.taskId,
    taskPath: args.taskPath,
    conversationId: conversation.id,
    providerId: args.agent as ProviderId,
    initialPrompt: args.prompt,
  });

  return { conversationId: conversation.id, ptyId };
}

export async function launchReviewAgents(
  config: AIReviewConfig,
  taskId: string,
  taskPath: string,
  content?: string
): Promise<{ reviewId: string; conversationIds: string[]; ptyIds: string[] }> {
  const reviewId = generateId();
  const agentCount = REVIEW_DEPTH_AGENTS[config.depth];

  // Launch all agents in parallel using Promise.allSettled to handle partial failures
  const prompt = buildReviewPrompt(config.depth, content);
  const launches = Array.from({ length: agentCount }, () =>
    launchReviewAgent({
      taskId,
      taskPath,
      reviewId,
      agent: config.providerId,
      prompt,
    })
  );

  const results = await Promise.allSettled(launches);

  const conversationIds: string[] = [];
  const ptyIds: string[] = [];
  const failures: string[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      conversationIds.push(result.value.conversationId);
      ptyIds.push(result.value.ptyId);
    } else {
      failures.push(`Agent ${i + 1}: ${result.reason?.message || String(result.reason)}`);
    }
  });

  // If all agents failed, throw an error
  if (conversationIds.length === 0) {
    throw new Error(`All ${agentCount} agent launches failed: ${failures.join('; ')}`);
  }

  // If some agents failed, log a warning (successful agents will still be used)
  if (failures.length > 0) {
    console.warn(
      `Some agent launches failed: ${failures.join('; ')}. Proceeding with ${conversationIds.length} successful agents.`
    );
  }

  return { reviewId, conversationIds, ptyIds };
}

export async function pollReviewMessages(
  conversationId: string,
  sinceTimestamp?: string
): Promise<{ messages: ReviewMessage[]; hasNewMessages: boolean }> {
  const messages = await rpc.db.getMessages(conversationId);
  const since = sinceTimestamp ? new Date(sinceTimestamp) : new Date(0);
  const newMessages = messages.filter((m) => new Date(m.timestamp) > since);
  return {
    messages,
    hasNewMessages: newMessages.length > 0,
  };
}

export function parseReviewMessages(messages: ReviewMessage[]): AIReviewIssue[] {
  // Find the most recent agent message that contains review results
  const agentMessages = messages.filter((m) => m.sender === 'agent').reverse();

  for (const msg of agentMessages) {
    const issues = tryParseIssues(msg.content);
    if (issues.length > 0) {
      return issues;
    }
  }

  return [];
}

function tryParseIssues(content: string): AIReviewIssue[] {
  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map((item, index) => normalizeIssue(item, index));
    }
    if (parsed.issues && Array.isArray(parsed.issues)) {
      return parsed.issues.map((item: unknown, index: number) => normalizeIssue(item, index));
    }
  } catch {
    // Not JSON, try markdown parsing
  }

  // Fallback: parse from markdown format
  return parseMarkdownIssues(content);
}

function normalizeIssue(item: unknown, index: number): AIReviewIssue {
  const obj = item as Record<string, unknown>;
  return {
    id: (obj.id as string) || generateId(),
    severity: normalizeSeverity(obj.severity),
    category: String(obj.category || obj.type || 'other'),
    title: String(obj.title || obj.name || `Issue ${index + 1}`),
    description: String(obj.description || obj.body || obj.content || ''),
    codeSnapshot: (obj.codeSnapshot || obj.code || obj.snippet) as string | undefined,
    filePath: (obj.filePath || obj.file || obj.path) as string | undefined,
    lineRange: (obj.lineRange || obj.lines) as { start: number; end: number } | undefined,
    fixPrompt: (obj.fixPrompt || obj.fix || obj.recommendation) as string | undefined,
  };
}

function normalizeSeverity(severity: unknown): 'critical' | 'major' | 'minor' | 'info' {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical' || s === 'error' || s === 'blocker') return 'critical';
  if (s === 'major' || s === 'warning') return 'major';
  if (s === 'minor') return 'minor';
  if (s === 'info') return 'info';
  return 'info';
}

function parseMarkdownIssues(content: string): AIReviewIssue[] {
  const issues: AIReviewIssue[] = [];
  const lines = content.split('\n');
  let currentIssue: Partial<AIReviewIssue> | null = null;
  let currentCodeBlock: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Handle code fences
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        if (currentIssue) {
          currentIssue.codeSnapshot = currentCodeBlock.join('\n');
        }
        currentCodeBlock = [];
        inCodeBlock = false;
      } else {
        // Start of code block
        inCodeBlock = true;
      }
      continue;
    }

    // Look for issue headers like "## Issue:" or "### [CRITICAL]" or "- **Title**:"
    const headerMatch = line.match(/^#{1,3}\s*\[?(\w+)\]?\s*[:\-]?\s*(.*)/i);
    if (headerMatch) {
      if (currentIssue && currentIssue.title) {
        currentIssue.description = currentCodeBlock.join('\n') || currentIssue.description;
        issues.push(currentIssue as AIReviewIssue);
      }
      const severity = normalizeSeverity(headerMatch[1]);
      currentIssue = {
        id: generateId(),
        severity,
        title: headerMatch[2].trim(),
        description: '',
        category: 'other',
      };
      currentCodeBlock = [];
      continue;
    }

    // Check for bullet points with severity
    const bulletMatch = line.match(/^[-*]\s*\*\*\[?(\w+)\]?\*\*[:\-]?\s*(.*)/i);
    if (bulletMatch && !headerMatch) {
      if (currentIssue && currentIssue.title) {
        currentIssue.description = currentCodeBlock.join('\n') || currentIssue.description;
        issues.push(currentIssue as AIReviewIssue);
      }
      currentIssue = {
        id: generateId(),
        severity: normalizeSeverity(bulletMatch[1]),
        title: bulletMatch[2].trim(),
        description: '',
        category: 'other',
      };
      currentCodeBlock = [];
      continue;
    }

    if (currentIssue) {
      if (line.match(/^File:|Path:|Location:/i)) {
        currentIssue.filePath = line.replace(/^File:|Path:|Location:\s*/i, '').trim();
      } else if (line.match(/^Category:|Type:/i)) {
        currentIssue.category = line.replace(/^Category:|Type:\s*/i, '').trim();
      } else if (inCodeBlock || line.match(/^\s{2,}/)) {
        currentCodeBlock.push(line);
      } else if (line.trim()) {
        currentIssue.description = (currentIssue.description || '') + line + '\n';
      }
    }
  }

  if (currentIssue && currentIssue.title) {
    currentIssue.description = currentCodeBlock.join('\n') || currentIssue.description;
    issues.push(currentIssue as AIReviewIssue);
  }

  return issues;
}

export async function aggregateReviewResults(
  results: Array<{ conversationId: string; messages: ReviewMessage[] }>,
  config: AIReviewConfig,
  reviewId: string,
  durationMs: number
): Promise<AIReviewResult> {
  const allIssues: AIReviewIssue[] = [];

  for (const result of results) {
    const issues = parseReviewMessages(result.messages);
    allIssues.push(...issues);
  }

  // Sort by severity
  const severityOrder = { critical: 0, major: 1, minor: 2, info: 3 };
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const summary = `Found ${allIssues.length} issues: ${
    allIssues.filter((i) => i.severity === 'critical').length
  } critical, ${allIssues.filter((i) => i.severity === 'major').length} major, ${
    allIssues.filter((i) => i.severity === 'minor').length
  } minor, ${allIssues.filter((i) => i.severity === 'info').length} info`;

  return {
    reviewId,
    timestamp: new Date().toISOString(),
    depth: config.depth,
    reviewType: config.reviewType,
    issues: allIssues,
    summary,
    durationMs,
    agentIds: results.map((r) => r.conversationId),
  };
}
