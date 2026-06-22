import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { getProvider, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';

const MAX_TRANSCRIPT_CHARS = 60_000;
const MAX_EXTRACTED_ITEMS = 20;
const HANDOFF_DIR = 'emdash-handoffs';

const SECRET_REDACTIONS: Array<[RegExp, string]> = [
  [/-----BEGIN[^-\n]{1,40}-----[\s\S]+?-----END[^-\n]{1,40}-----/g, '[REDACTED_PEM_BLOCK]'],
  [/\b(gh[opsu]_[A-Za-z0-9]{36,255})\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\b(glpat-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_GITLAB_TOKEN]'],
  [/\b(npm_[A-Za-z0-9]{36,})\b/g, '[REDACTED_NPM_TOKEN]'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]'],
  [/\b((?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,})\b/g, '[REDACTED_STRIPE_KEY]'],
  [/\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_ANTHROPIC_KEY]'],
  [/\b(sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_OPENAI_KEY]'],
  [/\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\b(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_JWT]'],
  [
    new RegExp(
      `(\\\\?")((?:authorization|api[_-]?key|token|password|passphrase|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret))(\\\\?")(\\s*:\\s*)\\\\?"[^"\\\\]*\\\\?"`,
      'gi'
    ),
    '$1$2$3$4$1[REDACTED]$1',
  ],
  [
    /\b((?:authorization|api[_-]?key|token|password|passphrase|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*)(?:bearer\s+)?[^\s,"'}]+/gi,
    '$1[REDACTED]',
  ],
];

function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .trim();
}

function tail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

function isDecorativeLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  if (/^(?:@@|---|\+\+\+|\*\*\*)/.test(trimmed)) return false;
  if (/[A-Za-z0-9]/.test(trimmed)) return false;
  return /^[\s*#=~_\-.+|/\\:;·•●○◦◆◇■□▪▫✦✧✶✻✽━─═╭╮╰╯│┃┌┐└┘├┤┬┴┼╞╡╪╔╗╚╝║╠╣╦╩╬]+$/.test(trimmed);
}

function unwrapDecorativeFrame(line: string): string {
  if (!/[A-Za-z0-9]/.test(line)) return line;
  return line
    .replace(/^\s*[│┃║|]+\s?/, '')
    .replace(/\s?[│┃║|]+\s*$/, '')
    .replace(/^\s*([╰╭╮╯┌┐└┘├┤┬┴┼╞╡╪╔╗╚╝║╠╣╦╩╬─━═]+\s*)+/, '')
    .replace(/(\s*[╰╭╮╯┌┐└┘├┤┬┴┼╞╡╪╔╗╚╝║╠╣╦╩╬─━═]+)+\s*$/, '')
    .trimEnd();
}

function normalizeTranscript(value: string): string {
  const lines = stripTerminalControls(value)
    .split('\n')
    .map(unwrapDecorativeFrame)
    .filter((line) => !isDecorativeLine(line));

  const compacted: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && compacted.at(-1)?.trim() === '') continue;
    compacted.push(line);
  }

  return compacted.join('\n').trim();
}

function uniqueMatches(value: string, pattern: RegExp, limit: number): string[] {
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const item = match[0].replace(/[),.;:]+$/, '');
    if (seen.has(item)) continue;
    seen.add(item);
    matches.push(item);
    if (matches.length >= limit) break;
  }
  return matches;
}

function extractNotableFiles(transcript: string): string[] {
  return uniqueMatches(
    transcript,
    /\b(?:apps|packages|src|drizzle|scripts|agents|tooling|\.github)\/[^\s'"`),;]+/g,
    MAX_EXTRACTED_ITEMS
  );
}

function extractCommands(transcript: string): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();
  for (const line of transcript.split('\n')) {
    const trimmed = line.trim().replace(/^[>$❯]\s*/, '');
    if (
      !/^(?:pnpm|npm|yarn|git|rg|sed|cat|npx|node|tsx|tsgo|oxlint|oxfmt|vitest|playwright|gh|wrangler|vercel)\b/.test(
        trimmed
      )
    ) {
      continue;
    }
    const command = trimmed.slice(0, 180);
    if (seen.has(command)) continue;
    seen.add(command);
    commands.push(command);
    if (commands.length >= MAX_EXTRACTED_ITEMS) break;
  }
  return commands;
}

function formatBullets(items: string[], fallback: string): string {
  if (items.length === 0) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join('\n');
}

function redactSecrets(value: string): string {
  return SECRET_REDACTIONS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value
  );
}

async function writeHandoffDocument(content: string): Promise<string> {
  const dir = join(tmpdir(), HANDOFF_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const path = join(dir, `handoff-${Date.now()}-${randomUUID()}.md`);
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
  return path;
}

export async function getConversationHandoffPrompt(
  projectId: string,
  taskId: string,
  conversationId: string,
  options: { delivery?: 'document' | 'inline' } = {}
): Promise<{ prompt: string; transcriptIncluded: boolean; documentPath?: string }> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

  if (!row) throw new Error('Conversation not found');

  const providerId = row.provider as AgentProviderId;
  const providerName = getProvider(providerId)?.name ?? providerId;
  const sessionId = makePtySessionId(projectId, taskId, conversationId);
  const transcript = redactSecrets(
    tail(normalizeTranscript(ptySessionRegistry.getBufferSnapshot(sessionId)), MAX_TRANSCRIPT_CHARS)
  );
  const transcriptIncluded = transcript.length > 0;
  const notableFiles = extractNotableFiles(transcript);
  const commands = extractCommands(transcript);
  const document = `# Emdash Agent Handoff

## Goal

Continue the same task in a fresh agent session without asking the user to restate context.

## Source session

- Agent: ${providerName}
- Conversation title: ${row.title}
- Conversation id: ${row.id}
- Project id: ${projectId}
- Task id: ${taskId}

## Notable files

${formatBullets(notableFiles, 'No file paths were detected automatically.')}

## Commands and checks seen

${formatBullets(commands, 'No commands were detected automatically.')}

## Continuation instructions

- Infer the current state from the latest transcript below.
- Preserve important decisions and constraints from the source session.
- Treat build failures, test output, file paths, and pending instructions as the latest actionable context.
- Prefer the summarized files and commands above before scanning unrelated context.

## Cleaned latest terminal transcript

${transcriptIncluded ? `\`\`\`text\n${transcript}\n\`\`\`` : 'No terminal transcript was available from the source session buffer.'}
`;

  if (options.delivery === 'inline') {
    return {
      transcriptIncluded,
      prompt: document,
    };
  }

  const documentPath = await writeHandoffDocument(document);

  return {
    transcriptIncluded,
    documentPath,
    prompt: `You are taking over an existing Emdash agent session. Continue the same task without asking the user to restate context. Read this handoff document first, then continue from the latest actionable point: ${documentPath}`,
  };
}
