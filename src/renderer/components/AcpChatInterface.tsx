import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clipboard,
  Copy,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Task } from '../types/chat';
import { type Provider } from '../types';
import InstallBanner from './InstallBanner';
import { Button } from './ui/button';
import { getInstallCommandForProvider } from '@shared/providers/registry';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// OpenAI logo SVG component
const OpenAIIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
  </svg>
);
import { Spinner } from './ui/spinner';
import { extractCurrentModelId, extractModelsFromPayload } from '@shared/acpUtils';
import type { AcpConfigOption, AcpModel } from '@shared/types/acp';

type ContentBlock = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  name?: string;
  uri?: string;
  description?: string;
  title?: string;
  size?: number;
  resource?: {
    uri?: string;
    mimeType?: string;
    text?: string;
    blob?: string;
    name?: string;
    title?: string;
    description?: string;
    size?: number;
  };
};

type ToolCallContent =
  | { type: 'content'; content: ContentBlock }
  | { type: 'diff'; path?: string; oldText?: string; newText?: string }
  | { type: 'terminal'; terminalId: string };

type ToolCall = {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  locations?: Array<{ path: string; line?: number }>;
  content?: ToolCallContent[];
  rawInput?: string;
  rawOutput?: string;
};

type DiffPreviewLine = { type: 'context' | 'add' | 'del'; text: string };
type DiffPreview = {
  path?: string;
  lines: DiffPreviewLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
};

type FeedItem =
  | {
      id: string;
      type: 'message';
      role: 'user' | 'assistant' | 'system';
      blocks: ContentBlock[];
      streaming?: boolean;
      messageKind?: 'thought' | 'system';
      runDurationMs?: number;
    }
  | { id: string; type: 'tool'; toolCallId: string }
  | {
      id: string;
      type: 'plan';
      entries: Array<{ content?: string; status?: string; priority?: string }>;
    }
  | { id: string; type: 'permission'; requestId: number };

type PermissionRequest = {
  requestId: number;
  toolCall?: ToolCall;
  options?: Array<{ id: string; label: string; kind?: string }>;
};

type Attachment = {
  id: string;
  name: string;
  path?: string;
  mimeType?: string;
  size?: number;
  kind: 'file' | 'image' | 'audio';
  data?: string;
  textContent?: string;
};

type Props = {
  task: Task;
  projectName: string;
  className?: string;
  provider: Provider;
  isProviderInstalled: boolean | null;
  runInstallCommand: (cmd: string) => void;
};

const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_PREVIEW_LINES = 80;
const MAX_DIFF_SOURCE_LINES = 400;
const DEFAULT_TRUNCATE_LIMIT = 120;

const normalizeNewlines = (text: string) => text.replace(/\r\n/g, '\n');

const splitLines = (text: string) => normalizeNewlines(text).split('\n');

const truncateText = (text: string, limit: number = DEFAULT_TRUNCATE_LIMIT) => {
  if (text.length <= limit) return text;
  const clipped = Math.max(0, limit - 3);
  return `${text.slice(0, clipped)}...`;
};

const pluralize = (value: number, noun: string) =>
  value === 1 ? `${value} ${noun}` : `${value} ${noun}s`;

const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const LoadingTimer: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <Spinner size="sm" className="text-muted-foreground/70" aria-hidden="true" />
    <span className="tabular-nums">{label}</span>
  </div>
);

const commonPrefixLength = (a: string[], b: string[]) => {
  const max = Math.min(a.length, b.length);
  let idx = 0;
  while (idx < max && a[idx] === b[idx]) idx += 1;
  return idx;
};

const commonSuffixLength = (a: string[], b: string[], prefix: number) => {
  let idx = 0;
  const max = Math.min(a.length, b.length) - prefix;
  while (idx < max && a[a.length - 1 - idx] === b[b.length - 1 - idx]) idx += 1;
  return idx;
};

const estimateLineChanges = (oldLines: string[], newLines: string[]) => {
  const prefix = commonPrefixLength(oldLines, newLines);
  const suffix = commonSuffixLength(oldLines, newLines, prefix);
  const deletions = Math.max(0, oldLines.length - prefix - suffix);
  const additions = Math.max(0, newLines.length - prefix - suffix);
  return { additions, deletions };
};

const myersDiff = (a: string[], b: string[]): DiffPreviewLine[] => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return buildMyersResult(trace, a, b);
      }
    }
  }
  return buildMyersResult(trace, a, b);
};

const buildMyersResult = (trace: number[][], a: string[], b: string[]): DiffPreviewLine[] => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const result: DiffPreviewLine[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      result.push({ type: 'context', text: a[x - 1] ?? '' });
      x -= 1;
      y -= 1;
    }
    if (d === 0) break;
    if (x === prevX) {
      result.push({ type: 'add', text: b[prevY] ?? '' });
    } else {
      result.push({ type: 'del', text: a[prevX] ?? '' });
    }
    x = prevX;
    y = prevY;
  }

  return result.reverse();
};

const buildFallbackDiffLines = (
  oldLines: string[],
  newLines: string[],
  context: number
): DiffPreviewLine[] => {
  const prefix = commonPrefixLength(oldLines, newLines);
  const suffix = commonSuffixLength(oldLines, newLines, prefix);
  const beforeStart = Math.max(0, prefix - context);
  const before = oldLines.slice(beforeStart, prefix);
  const afterStart = Math.max(prefix, oldLines.length - suffix);
  const afterEnd = Math.min(oldLines.length, afterStart + context);
  const after = oldLines.slice(afterStart, afterEnd);
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);

  return [
    ...before.map((text) => ({ type: 'context' as const, text })),
    ...removed.map((text) => ({ type: 'del' as const, text })),
    ...added.map((text) => ({ type: 'add' as const, text })),
    ...after.map((text) => ({ type: 'context' as const, text })),
  ];
};

const trimDiffLines = (lines: DiffPreviewLine[], maxLines: number, context: number) => {
  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  const changeIndexes = lines
    .map((line, idx) => (line.type === 'context' ? -1 : idx))
    .filter((idx) => idx >= 0);
  if (changeIndexes.length === 0) {
    return { lines: lines.slice(0, maxLines), truncated: true };
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (const idx of changeIndexes) {
    const start = Math.max(0, idx - context);
    const end = Math.min(lines.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const total = ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
  const output: DiffPreviewLine[] = [];

  if (total <= maxLines) {
    ranges.forEach((range, idx) => {
      if (idx > 0) output.push({ type: 'context', text: '...' });
      output.push(...lines.slice(range.start, range.end + 1));
    });
    return { lines: output, truncated: total < lines.length };
  }

  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first.start === last.start && first.end === last.end) {
    return { lines: lines.slice(first.start, first.end + 1), truncated: true };
  }
  const half = Math.max(4, Math.floor((maxLines - 1) / 2));
  let firstSlice = lines.slice(first.start, first.end + 1);
  let lastSlice = lines.slice(last.start, last.end + 1);
  if (firstSlice.length > half) firstSlice = firstSlice.slice(0, half);
  if (lastSlice.length > half) lastSlice = lastSlice.slice(lastSlice.length - half);
  return {
    lines: [...firstSlice, { type: 'context', text: '...' }, ...lastSlice],
    truncated: true,
  };
};

const buildDiffPreview = (oldText: string, newText: string) => {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const useFallback = oldLines.length + newLines.length > MAX_DIFF_SOURCE_LINES * 2;
  const diffLines = useFallback
    ? buildFallbackDiffLines(oldLines, newLines, DIFF_CONTEXT_LINES)
    : myersDiff(oldLines, newLines);
  const { additions, deletions } = useFallback
    ? estimateLineChanges(oldLines, newLines)
    : diffLines.reduce(
        (acc, line) => {
          if (line.type === 'add') acc.additions += 1;
          if (line.type === 'del') acc.deletions += 1;
          return acc;
        },
        { additions: 0, deletions: 0 }
      );
  const trimmed = trimDiffLines(diffLines, MAX_DIFF_PREVIEW_LINES, DIFF_CONTEXT_LINES);
  return {
    lines: trimmed.lines,
    additions,
    deletions,
    truncated: trimmed.truncated,
  };
};

const getTailLines = (text: string, maxLines: number) => {
  const lines = splitLines(text);
  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(lines.length - maxLines), truncated: true };
};

// Truncate text to last N lines to prevent unbounded state growth.
// Uses a buffer (maxLines + 10) to avoid truncating on every chunk.
const truncateToTailLines = (text: string, maxLines: number): string => {
  const lines = splitLines(text);
  if (lines.length <= maxLines) {
    return text;
  }
  // Add a small buffer to avoid truncating on every chunk
  const buffer = 10;
  const limit = maxLines + buffer;
  if (lines.length <= limit) {
    return text;
  }
  return lines.slice(lines.length - maxLines).join('\n');
};

const statusStyles: Record<string, string> = {
  pending: 'text-amber-700 bg-amber-50 border-amber-200',
  in_progress: 'text-blue-700 bg-blue-50 border-blue-200',
  completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed: 'text-red-700 bg-red-50 border-red-200',
  cancelled: 'text-gray-600 bg-gray-100 border-gray-200',
};

type ConfigChoice = {
  value: unknown;
  label?: string;
  name?: string;
  description?: string;
};

type ModelOption = {
  id: string;
  label: string;
  description?: string;
};

type ModelVariant = ModelOption & {
  baseId: string;
  effort?: string | null;
};

type ThinkingBudgetLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const EFFORT_ORDER: ThinkingBudgetLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const EFFORT_LABELS: Record<ThinkingBudgetLevel, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
};

const flattenConfigChoices = (choices: any[]): any[] => {
  const flat: any[] = [];
  for (const choice of choices) {
    if (choice && Array.isArray(choice.options)) {
      flat.push(...choice.options);
    } else {
      flat.push(choice);
    }
  }
  return flat;
};

const normalizeConfigChoice = (choice: any): ConfigChoice | null => {
  if (choice === null || choice === undefined) return null;
  if (typeof choice === 'string' || typeof choice === 'number' || typeof choice === 'boolean') {
    return { value: choice, label: String(choice) };
  }
  if (typeof choice === 'object') {
    const value =
      choice.value ??
      choice.id ??
      choice.key ??
      choice.name ??
      choice.label ??
      choice.option;
    return {
      value,
      label: choice.label ?? choice.name ?? (value !== undefined ? String(value) : undefined),
      name: choice.name,
      description: choice.description,
    };
  }
  return null;
};

const extractConfigChoices = (option?: AcpConfigOption | null): ConfigChoice[] => {
  if (!option) return [];
  const raw =
    (Array.isArray(option.options) && option.options) ||
    (Array.isArray(option.possibleValues) && option.possibleValues) ||
    (Array.isArray(option.values) && option.values) ||
    (Array.isArray(option.allowedValues) && option.allowedValues) ||
    [];
  const flat = flattenConfigChoices(raw);
  return flat.map(normalizeConfigChoice).filter(Boolean) as ConfigChoice[];
};

const getConfigOptionId = (option?: AcpConfigOption | null): string | null => {
  if (!option) return null;
  const id =
    option.id ??
    (option as any).configId ??
    (option as any).config_id ??
    (option as any).key ??
    option.name;
  return id ? String(id) : null;
};

const getConfigOptionValue = (option?: AcpConfigOption | null): unknown => {
  if (!option) return null;
  return (
    option.currentValue ??
    option.current_value ??
    option.value ??
    option.selectedValue ??
    (option as any).selected ??
    null
  );
};

const normalizeBudgetText = (value: unknown) => String(value ?? '').toLowerCase();

const normalizeEffort = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).toLowerCase().replace(/\s+/g, '').replace(/[_-]/g, '');
  if (!cleaned) return null;
  if (['xhigh', 'extrahigh', 'xtra', 'xtrahigh'].includes(cleaned)) return 'xhigh';
  if (['high'].includes(cleaned)) return 'high';
  if (['medium', 'med'].includes(cleaned)) return 'medium';
  if (['low'].includes(cleaned)) return 'low';
  if (['minimal', 'min', 'none', 'off', 'disabled'].includes(cleaned)) return 'minimal';
  return null;
};

const parseEffortFromLabel = (label?: string | null): string | null => {
  if (!label) return null;
  const match = label.match(/\(([^)]+)\)\s*$/);
  if (!match) return null;
  return normalizeEffort(match[1]);
};

const stripEffortSuffix = (label?: string | null): string | null => {
  if (!label) return null;
  const effort = parseEffortFromLabel(label);
  if (!effort) return label;
  return label.replace(/\s*\([^)]+\)\s*$/, '').trim();
};

const formatModelLabel = (label: string): string => {
  const parts = label.split(/[-\s]+/).filter(Boolean);
  if (!parts.length) return label;
  const formatted = parts.map((part) => {
    const lower = part.toLowerCase();
    if (lower === 'gpt') return 'GPT';
    if (lower === 'codex') return 'Codex';
    if (lower === 'mini') return 'Mini';
    if (lower === 'max') return 'Max';
    if (/^\d+(\.\d+)?$/.test(part)) return part;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  return formatted.join('-');
};

const splitModelId = (modelId?: string | null, label?: string | null) => {
  if (!modelId) {
    return {
      baseId: '',
      effort: parseEffortFromLabel(label),
    };
  }
  if (modelId.includes('/')) {
    const parts = modelId.split('/');
    const tail = parts[parts.length - 1];
    const effort = normalizeEffort(tail);
    if (effort) {
      return {
        baseId: parts.slice(0, -1).join('/'),
        effort,
      };
    }
  }
  return {
    baseId: modelId,
    effort: parseEffortFromLabel(label),
  };
};

const detectBudgetLevel = (text: string): ThinkingBudgetLevel | null => {
  if (/\bminimal\b/.test(text) || /\b(none|off|disabled|disable|zero)\b/.test(text)) return 'minimal';
  if (/\blow\b/.test(text) || text === '1') return 'low';
  if (/\bmedium\b/.test(text) || text === '2') return 'medium';
  if (/\bhigh\b/.test(text) || text === '3') return 'high';
  if (/\b(xhigh|extra\s*high)\b/.test(text) || text === '4') return 'xhigh';
  return null;
};

const budgetFromEffort = (effort?: string | null): ThinkingBudgetLevel | null => {
  const normalized = normalizeEffort(effort);
  if (!normalized) return null;
  if (
    normalized === 'minimal' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'xhigh'
  ) {
    return normalized;
  }
  return null;
};

const chooseEffortForBudget = (
  budget: ThinkingBudgetLevel,
  available: Set<string>
): ThinkingBudgetLevel | null => {
  const normalizedAvailable = new Set(
    Array.from(available)
      .map((entry) => normalizeEffort(entry))
      .filter(Boolean) as ThinkingBudgetLevel[]
  );
  if (normalizedAvailable.has(budget)) return budget;
  const idx = EFFORT_ORDER.indexOf(budget);
  for (let i = idx; i >= 0; i -= 1) {
    const level = EFFORT_ORDER[i];
    if (normalizedAvailable.has(level)) return level;
  }
  for (let i = idx + 1; i < EFFORT_ORDER.length; i += 1) {
    const level = EFFORT_ORDER[i];
    if (normalizedAvailable.has(level)) return level;
  }
  return null;
};

const buildBudgetMapping = (option?: AcpConfigOption | null) => {
  const choices = extractConfigChoices(option);
  const budgetToChoice = new Map<ThinkingBudgetLevel, ConfigChoice>();
  const valueToBudget = new Map<string, ThinkingBudgetLevel>();
  const availableLevels = new Set<ThinkingBudgetLevel>();
  for (const choice of choices) {
    const label = normalizeBudgetText(
      [choice.label, choice.name, choice.value, choice.description].filter(Boolean).join(' ')
    );
    const level = detectBudgetLevel(label);
    if (level && !budgetToChoice.has(level)) {
      budgetToChoice.set(level, choice);
    }
    if (level && choice.value !== undefined) {
      valueToBudget.set(String(choice.value), level);
    }
    if (level) {
      availableLevels.add(level);
    }
  }
  return { choices, budgetToChoice, valueToBudget, availableLevels };
};

const getBudgetFromConfig = (option?: AcpConfigOption | null): ThinkingBudgetLevel | null => {
  if (!option) return null;
  const currentValue = getConfigOptionValue(option);
  if (currentValue === null || currentValue === undefined) return null;
  const { valueToBudget } = buildBudgetMapping(option);
  const direct = valueToBudget.get(String(currentValue));
  if (direct) return direct;
  const inferred = detectBudgetLevel(normalizeBudgetText(currentValue));
  return inferred;
};

const findThinkingConfigOption = (options: AcpConfigOption[]): AcpConfigOption | null => {
  let best: { option: AcpConfigOption; score: number } | null = null;
  for (const option of options) {
    const haystack = normalizeBudgetText(
      [option.id, option.name, option.label, option.description].filter(Boolean).join(' ')
    );
    if (!/(reason|thinking|effort|budget)/.test(haystack)) continue;
    const { choices } = buildBudgetMapping(option);
    const hasChoices = choices.length > 0;
    const hasKnownLevels = choices.some((choice) =>
      Boolean(detectBudgetLevel(normalizeBudgetText(choice.label ?? choice.name ?? choice.value)))
    );
    let score = 0;
    if (option.type === 'select' || option.type === 'enum') score += 2;
    if (hasChoices) score += 2;
    if (hasKnownLevels) score += 2;
    if (/(reason|thinking)/.test(haystack)) score += 1;
    if (!best || score > best.score) best = { option, score };
  }
  return best?.option ?? null;
};

const findModelConfigOption = (options: AcpConfigOption[]): AcpConfigOption | null => {
  let best: { option: AcpConfigOption; score: number } | null = null;
  for (const option of options) {
    const haystack = normalizeBudgetText(
      [option.id, option.name, option.label, option.description].filter(Boolean).join(' ')
    );
    if (!/model/.test(haystack)) continue;
    if (/(reason|thinking|effort|budget)/.test(haystack)) continue;
    const choices = extractConfigChoices(option);
    const hasChoices = choices.length > 0;
    let score = 0;
    if (option.type === 'select' || option.type === 'enum') score += 2;
    if (hasChoices) score += 2;
    if (/(model)/.test(haystack)) score += 1;
    if (!best || score > best.score) best = { option, score };
  }
  return best?.option ?? null;
};

const normalizeModelOption = (model: any): ModelOption | null => {
  if (!model) return null;
  if (typeof model === 'string') {
    return { id: model, label: model };
  }
  if (typeof model === 'object') {
    const id =
      model.id ??
      model.modelId ??
      model.model_id ??
      model.model ??
      model.name ??
      model.value ??
      model.slug ??
      model.key;
    if (!id) return null;
    const label =
      model.displayName ??
      model.label ??
      model.title ??
      model.name ??
      model.modelId ??
      String(id);
    return {
      id: String(id),
      label: String(label),
      description: model.description ? String(model.description) : undefined,
    };
  }
  return null;
};

const nextBudgetLevel = (
  current: ThinkingBudgetLevel,
  levels: ThinkingBudgetLevel[]
): ThinkingBudgetLevel => {
  if (!levels.length) return current;
  const idx = levels.indexOf(current);
  const next = levels[(idx + 1) % levels.length];
  return next ?? levels[0] ?? current;
};

const AcpChatInterface: React.FC<Props> = ({
  task,
  projectName: _projectName,
  className,
  provider,
  isProviderInstalled,
  runInstallCommand,
}) => {
  const uiLog = useCallback((...args: any[]) => {
    // eslint-disable-next-line no-console
    console.log('[acp-ui]', ...args);
  }, []);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCall>>({});
  const [permissions, setPermissions] = useState<Record<number, PermissionRequest>>({});
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, string>>({});
  const [commands, setCommands] = useState<
    Array<{ name: string; description?: string; hint?: string }>
  >([]);

  const [plan, setPlan] = useState<Array<{
    content?: string;
    status?: string;
    priority?: string;
  }> | null>(null);
  const [input, setInput] = useState('');
  const [showPlan, setShowPlan] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [agentId, setAgentId] = useState<string>(String(provider || 'codex'));
  const [promptCaps, setPromptCaps] = useState<{
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  }>({});
  const [modelId, setModelId] = useState<string>('gpt-5.2-codex');
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [thinkingBudget, setThinkingBudget] = useState<ThinkingBudgetLevel>('medium');
  const [configOptions, setConfigOptions] = useState<AcpConfigOption[]>([]);
  const [models, setModels] = useState<AcpModel[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [runElapsedMs, setRunElapsedMs] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const runStartedAtRef = useRef<number | null>(null);
  const lastAssistantMessageIdRef = useRef<string | null>(null);
  const copyResetRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleConfigAndModelUpdates = useCallback((payload: any) => {
    if (!payload) return;
    if (Array.isArray(payload.configOptions)) {
      setConfigOptions(payload.configOptions);
    } else if (Array.isArray(payload.config_options)) {
      setConfigOptions(payload.config_options);
    }
    const nextModels = extractModelsFromPayload(payload);
    if (nextModels.length) {
      setModels(nextModels);
    }
    const nextCurrentModelId = extractCurrentModelId(payload);
    if (nextCurrentModelId) {
      setCurrentModelId(nextCurrentModelId);
    }
  }, []);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = 200;
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [input]);

  useEffect(() => {
    scrollToBottom('auto');
  }, [feed.length, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isRunning || runStartedAtRef.current === null) return;
    setRunElapsedMs(Date.now() - runStartedAtRef.current);
    const interval = window.setInterval(() => {
      if (runStartedAtRef.current === null) return;
      setRunElapsedMs(Date.now() - runStartedAtRef.current);
    }, 250);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    setAgentId(String(provider || 'codex'));
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionError(null);
      setConfigOptions([]);
      setModels([]);
      setCurrentModelId(null);
      uiLog('startSession', { taskId: task.id, provider, cwd: task.path });
      const res = await window.electronAPI.acpStartSession({
        taskId: task.id,
        providerId: provider,
        cwd: task.path,
      });
      uiLog('startSession:response', res);
      if (cancelled) return;
      if (!res?.success || !res.sessionId) {
        uiLog('startSession:failed', res);
        setSessionError(res?.error || 'Failed to start ACP session.');
        return;
      }
      setSessionId(res.sessionId);
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id, task.path, provider, uiLog]);

  useEffect(() => {
    if (!sessionId) return;
    return () => {
      try {
        uiLog('disposeSession', { sessionId });
        window.electronAPI.acpDispose({ sessionId });
      } catch {}
    };
  }, [sessionId, uiLog]);

  // Scan for custom slash commands when project or provider changes
  useEffect(() => {
    const loadCustomCommands = async () => {
      if (!task.path || !provider) {
        return;
      }
      uiLog('scanCustomCommands', { projectPath: task.path, provider });
      const result = await window.electronAPI.scanCustomCommands({
        projectPath: task.path,
        providerId: provider,
      });
      uiLog('scanCustomCommands:response', result);
      if (result.success && result.commands && result.commands.length > 0) {
        const mappedCommands = result.commands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          hint: undefined,
        }));
        setCommands(mappedCommands);
      } else {
        // Clear commands when scan fails or returns no results to prevent stale commands
        setCommands([]);
      }
    };
    loadCustomCommands();
  }, [task.path, provider, uiLog]);

  useEffect(() => {
    const off = window.electronAPI.onAcpEvent((payload: any) => {
      if (!payload || payload.taskId !== task.id) return;
      uiLog('event', payload);
      if (payload.type === 'session_started') {
        if (payload.sessionId) {
          setSessionId(payload.sessionId);
        }
        const caps =
          payload.agentCapabilities?.promptCapabilities ??
          payload.agentCapabilities?.prompt ??
          payload.agentCapabilities?.prompt_caps;
        if (caps) {
          setPromptCaps(normalizePromptCaps(caps));
        }
        handleConfigAndModelUpdates(payload);
        uiLog('session_started:config', {
          configOptions: Array.isArray(payload.configOptions)
            ? payload.configOptions.length
            : Array.isArray(payload.config_options)
              ? payload.config_options.length
              : 0,
          models: extractModelsFromPayload(payload).length,
          currentModelId: extractCurrentModelId(payload),
        });
        return;
      }
      if (payload.type === 'session_error') {
        uiLog('session_error', payload.error);
        setSessionError(payload.error || 'ACP session error');
        setIsRunning(false);
        runStartedAtRef.current = null;
        return;
      }
      if (payload.type === 'session_exit') {
        uiLog('session_exit', payload);
        setIsRunning(false);
        runStartedAtRef.current = null;
        if (!sessionError) {
          setSessionError('ACP session ended.');
        }
        return;
      }
      if (payload.type === 'prompt_end') {
        uiLog('prompt_end', payload);
        const durationMs =
          runStartedAtRef.current !== null ? Date.now() - runStartedAtRef.current : runElapsedMs;
        setIsRunning(false);
        runStartedAtRef.current = null;
        setRunElapsedMs(durationMs);
        setFeed((prev) => {
          const lastAssistantId = lastAssistantMessageIdRef.current;
          const next = prev.map((item) => {
            return item.type === 'message' && item.streaming
              ? { ...item, streaming: false }
              : item;
          });
          if (lastAssistantId && Number.isFinite(durationMs)) {
            const targetIndex = next.findIndex(
              (item) => item.type === 'message' && item.id === lastAssistantId
            );
            if (targetIndex >= 0) {
              const target = next[targetIndex];
              if (target.type === 'message') {
                next[targetIndex] = { ...target, runDurationMs: durationMs };
              }
            }
          }
          return next;
        });
        lastAssistantMessageIdRef.current = null;
        if (payload.stopReason) {
          const stopReason = String(payload.stopReason).trim();
          if (stopReason && stopReason !== 'end_turn') {
            setFeed((prev) => [
              ...prev,
              {
                id: `stop-${Date.now()}`,
                type: 'message',
                role: 'system',
                blocks: [
                  {
                    type: 'text',
                    text: `Stopped: ${stopReason}`,
                  },
                ],
              },
            ]);
          }
        }
        return;
      }
      if (payload.type === 'terminal_output') {
        uiLog('terminal_output', {
          terminalId: payload.terminalId,
          chunkSize: String(payload.chunk ?? '').length,
        });
        const terminalId = payload.terminalId as string;
        if (!terminalId) return;
        const chunk = String(payload.chunk ?? '');
        if (!chunk) return;
        setTerminalOutputs((prev) => ({
          ...prev,
          [terminalId]: truncateToTailLines((prev[terminalId] || '') + chunk, 60),
        }));
        return;
      }
      if (payload.type === 'session_update') {
        const update = payload.update;
        if (!update) return;
        const updateType =
          (update.sessionUpdate as string) || (update.type as string) || (update.kind as string);
        if (!updateType) return;
        uiLog('session_update', { updateType, update });
        handleConfigAndModelUpdates(update);
        if (updateType === 'config_option_update' || updateType === 'config_options_update' || updateType === 'model_update') {
          return;
        }
        if (
          updateType === 'agent_message_chunk' ||
          updateType === 'user_message_chunk' ||
          updateType === 'agent_message' ||
          updateType === 'user_message' ||
          updateType === 'thought_message' ||
          updateType === 'thought_message_chunk'
        ) {
          const isThought = updateType.startsWith('thought');
          const role =
            updateType === 'agent_message_chunk' || updateType === 'agent_message'
              ? 'assistant'
              : isThought
                ? 'system'
                : 'user';
          const blocks = Array.isArray(update.content)
            ? (update.content as ContentBlock[])
            : update.content
              ? [update.content as ContentBlock]
              : [];
          appendMessage(role, blocks, {
            streaming: updateType.endsWith('_chunk'),
            messageKind: isThought ? 'thought' : role === 'system' ? 'system' : undefined,
          });
          return;
        }
        if (updateType === 'plan') {
          const entries = Array.isArray(update.entries) ? update.entries : [];
          setPlan(entries);
          setFeed((prev) => {
            const existing = prev.find((item) => item.type === 'plan');
            if (existing) {
              return prev.map((item) => (item.type === 'plan' ? { ...item, entries } : item));
            }
            return [...prev, { id: `plan-${Date.now()}`, type: 'plan', entries }];
          });
          return;
        }
        if (updateType === 'tool_call' || updateType === 'tool_call_update') {
          const payloadUpdate = update.toolCall ?? update;
          const toolCallId = payloadUpdate.toolCallId as string;
          if (!toolCallId) return;
          setToolCalls((prev) => {
            const existing = prev[toolCallId] || { toolCallId };
            let content = existing.content || [];
            if (Array.isArray(payloadUpdate.content)) {
              content = [...content, ...payloadUpdate.content];
            } else if (payloadUpdate.content) {
              content = [...content, payloadUpdate.content];
            }
            const rawInput = payloadUpdate.rawInput ?? payloadUpdate.input ?? undefined;
            const rawOutput = payloadUpdate.rawOutput ?? payloadUpdate.output ?? undefined;
            const next: ToolCall = {
              ...existing,
              ...payloadUpdate,
              toolCallId,
              content,
              rawInput: rawInput === undefined ? existing.rawInput : normalizeRawValue(rawInput),
              rawOutput:
                rawOutput === undefined ? existing.rawOutput : normalizeRawValue(rawOutput),
            };
            return { ...prev, [toolCallId]: next };
          });
          setFeed((prev) => {
            const already = prev.some(
              (item) => item.type === 'tool' && item.toolCallId === toolCallId
            );
            if (already) return prev;
            return [...prev, { id: `tool-${toolCallId}`, type: 'tool', toolCallId }];
          });
          return;
        }
        // We use our own custom command scanner instead of available_commands_update
        // This ensures we only show user-created commands from .codex/prompts, etc.
        if (updateType === 'available_commands_update') {
          // Ignore agent-provided commands - we use our scanner as the source of truth
          return;
        }
      }
      if (payload.type === 'permission_request') {
        const requestId = payload.requestId as number;
        if (!requestId) return;
        uiLog('permission_request', payload);
        const toolCall = payload.params?.toolCall as ToolCall | undefined;
        const options = Array.isArray(payload.params?.options)
          ? payload.params.options.map((opt: any) => ({
              id: String(opt.optionId ?? opt.id ?? ''),
              label: String(opt.name ?? opt.label ?? opt.title ?? opt.optionId ?? 'Allow'),
              kind: opt.kind,
            }))
          : [];
        setPermissions((prev) => ({
          ...prev,
          [requestId]: { requestId, toolCall, options },
        }));
        setFeed((prev) => [...prev, { id: `perm-${requestId}`, type: 'permission', requestId }]);
      }
    });
    return () => {
      off?.();
    };
  }, [task.id, uiLog]);

  const mergeBlocks = (base: ContentBlock[], incoming: ContentBlock[]) => {
    const next = [...base];
    for (const block of incoming) {
      if (block.type === 'text') {
        const last = next[next.length - 1];
        if (last && last.type === 'text') {
          last.text = (last.text || '') + (block.text || '');
        } else {
          next.push({ ...block });
        }
      } else {
        next.push({ ...block });
      }
    }
    return next;
  };

  const normalizeRawValue = (value: any): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const normalizePromptCaps = (caps: any) => ({
    image: Boolean(caps?.image ?? caps?.images ?? caps?.supportsImage ?? caps?.supportsImages),
    audio: Boolean(caps?.audio ?? caps?.supportsAudio ?? caps?.supportsAudioInput),
    embeddedContext: Boolean(
      caps?.embeddedContext ?? caps?.embedded_context ?? caps?.supportsEmbeddedContext
    ),
  });

  const normalizePath = (value: string) => value.replace(/\\/g, '/');

  const formatPath = (value?: string) => {
    if (!value) return value;
    const normalized = normalizePath(value);
    const root = normalizePath(task.path || '');
    if (root && normalized.startsWith(root)) {
      let rel = normalized.slice(root.length);
      if (rel.startsWith('/')) rel = rel.slice(1);
      return rel || normalized.split('/').pop() || normalized;
    }
    return normalized.split('/').pop() || normalized;
  };

  const toFileUri = (filePath: string) => `file://${encodeURI(filePath)}`;

  const fromFileUri = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

  const safeJsonParse = (value?: string) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };

  const extractPrimaryText = (blocks: ContentBlock[]) => {
    const textBlock = blocks.find((block) => block.type === 'text' && block.text);
    if (textBlock?.text) return textBlock.text;
    const resourceBlock = blocks.find((block) => block.type === 'resource' && block.resource?.text);
    return resourceBlock?.resource?.text || '';
  };

  const buildCopyText = (blocks: ContentBlock[]) => {
    const parts: string[] = [];
    blocks.forEach((block) => {
      if (block.type === 'text' && block.text) {
        parts.push(block.text);
        return;
      }
      if (block.type === 'resource' && block.resource?.text) {
        parts.push(block.resource.text);
      }
    });
    return parts.join('\n\n').trim();
  };

  const appendMessage = (
    role: 'user' | 'assistant' | 'system',
    blocks: ContentBlock[],
    options?: { streaming?: boolean; messageKind?: 'thought' | 'system' }
  ) => {
    if (!blocks.length) return;
    const streaming = options?.streaming ?? role === 'assistant';
    const messageKind = options?.messageKind;
    setFeed((prev) => {
      const last = prev[prev.length - 1];
      if (
        last &&
        last.type === 'message' &&
        last.role === role &&
        last.streaming &&
        last.messageKind === messageKind
      ) {
        const merged = mergeBlocks(last.blocks, blocks);
        const next = [...prev];
        next[next.length - 1] = { ...last, blocks: merged };
        if (role === 'assistant' && messageKind !== 'thought') {
          lastAssistantMessageIdRef.current = last.id;
        }
        return next;
      }
      const newItem = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'message' as const,
        role,
        blocks,
        streaming,
        messageKind,
      };
      if (role === 'assistant' && messageKind !== 'thought') {
        lastAssistantMessageIdRef.current = newItem.id;
      }
      return [
        ...prev,
        newItem,
      ];
    });
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!sessionId) return;
    if (!trimmed && attachments.length === 0) return;
    setInput('');
    const promptBlocks = buildPromptBlocks(trimmed);
    appendMessage('user', promptBlocks);
    setAttachments([]);
    runStartedAtRef.current = Date.now();
    lastAssistantMessageIdRef.current = null;
    setRunElapsedMs(0);
    setIsRunning(true);
    uiLog('sendPrompt', { sessionId, blocks: promptBlocks });
    const res = await window.electronAPI.acpSendPrompt({
      sessionId,
      prompt: promptBlocks,
    });
    uiLog('sendPrompt:response', res);
    if (!res?.success) {
      setSessionError(res?.error || 'Failed to send prompt.');
      setIsRunning(false);
      runStartedAtRef.current = null;
      setRunElapsedMs(0);
    }
  };

  const handleCancel = async () => {
    if (!sessionId) return;
    uiLog('cancelSession', { sessionId });
    await window.electronAPI.acpCancel({ sessionId });
    setIsRunning(false);
    runStartedAtRef.current = null;
    setToolCalls((prev) => {
      const next: Record<string, ToolCall> = {};
      for (const [id, call] of Object.entries(prev)) {
        if (call.status && ['completed', 'failed', 'cancelled'].includes(call.status)) {
          next[id] = call;
        } else {
          next[id] = { ...call, status: 'cancelled' };
        }
      }
      return next;
    });
    const pending = Object.keys(permissions).map((id) => Number(id));
    if (pending.length) {
      await Promise.all(
        pending.map((requestId) =>
          window.electronAPI.acpRespondPermission({
            sessionId,
            requestId,
            outcome: { outcome: 'cancelled' },
          })
        )
      );
      uiLog('permission:auto-cancelled', { sessionId, pending });
      setPermissions({});
      setFeed((prev) => prev.filter((item) => item.type !== 'permission'));
    }
  };

  const handlePermissionChoice = async (requestId: number, optionId: string | null) => {
    if (!sessionId) return;
    const outcome = optionId
      ? ({ outcome: 'selected', optionId } as const)
      : ({ outcome: 'cancelled' } as const);
    uiLog('permission:choice', { sessionId, requestId, outcome });
    await window.electronAPI.acpRespondPermission({ sessionId, requestId, outcome });
    setPermissions((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    setFeed((prev) =>
      prev.filter((item) => !(item.type === 'permission' && item.requestId === requestId))
    );
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFiles = async (files: FileList | File[]) => {
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      const name = file.name || 'attachment';
      const mimeType = file.type || 'application/octet-stream';
      const path = (file as any).path;
      const size = file.size;
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const isImage = mimeType.startsWith('image/');
      const isAudio = mimeType.startsWith('audio/');
      const isText =
        mimeType.startsWith('text/') || /\.(md|txt|ts|tsx|js|jsx|json|yml|yaml)$/i.test(name);
      const supportsImage = Boolean(promptCaps.image);
      const supportsAudio = Boolean(promptCaps.audio);
      const supportsEmbedded = Boolean(promptCaps.embeddedContext);
      const kind: Attachment['kind'] = isImage ? 'image' : isAudio ? 'audio' : 'file';
      const attachment: Attachment = {
        id,
        name,
        path,
        mimeType,
        size,
        kind,
      };
      if (isImage && supportsImage && size <= 4 * 1024 * 1024) {
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrl) {
          const base64 = dataUrl.split(',')[1] || '';
          attachment.data = base64;
        }
      } else if (isAudio && supportsAudio && size <= 8 * 1024 * 1024) {
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrl) {
          const base64 = dataUrl.split(',')[1] || '';
          attachment.data = base64;
        }
      } else if (isText && supportsEmbedded && size <= 200 * 1024) {
        const text = await readFileAsText(file);
        if (text) {
          attachment.textContent = text;
        }
      }
      next.push(attachment);
    }
    if (next.length) {
      setAttachments((prev) => [...prev, ...next]);
    }
  };

  const buildPromptBlocks = (text: string): ContentBlock[] => {
    const blocks: ContentBlock[] = [];
    const supportsImage = Boolean(promptCaps.image);
    const supportsAudio = Boolean(promptCaps.audio);
    const supportsEmbedded = Boolean(promptCaps.embeddedContext);
    attachments.forEach((att) => {
      if (att.kind === 'image' && att.data && supportsImage) {
        blocks.push({ type: 'image', mimeType: att.mimeType, data: att.data });
        return;
      }
      if (att.kind === 'audio' && att.data && supportsAudio) {
        blocks.push({ type: 'audio', mimeType: att.mimeType, data: att.data });
        return;
      }
      if (att.textContent && supportsEmbedded && att.path) {
        blocks.push({
          type: 'resource',
          resource: {
            uri: toFileUri(att.path),
            mimeType: att.mimeType,
            text: att.textContent,
          },
        });
        return;
      }
      if (att.path) {
        blocks.push({
          type: 'resource_link',
          uri: toFileUri(att.path),
          name: att.name,
          title: att.name,
          mimeType: att.mimeType,
          size: att.size,
        });
      }
    });
    if (text) {
      blocks.push({ type: 'text', text });
    }
    return blocks;
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const commandSuggestions = useMemo(() => {
    if (!input.startsWith('/')) {
      return [];
    }
    const query = input.slice(1).toLowerCase();
    return commands.filter((cmd) => cmd.name && cmd.name.toLowerCase().includes(query)).slice(0, 6);
  }, [commands, input]);

  const commandHint = useMemo(() => {
    if (!input.startsWith('/')) return null;
    const trimmed = input.trim();
    const name = trimmed.slice(1).split(/\s+/)[0];
    if (!name) return null;
    const hasArgs = trimmed.split(/\s+/).length > 1;
    if (hasArgs) return null;
    const match = commands.find((cmd) => cmd.name.toLowerCase() === name.toLowerCase());
    return match?.hint || null;
  }, [commands, input]);

  const runTimerLabel = useMemo(() => formatDuration(runElapsedMs), [runElapsedMs]);

  const latestToolCallId = useMemo(() => {
    for (let i = feed.length - 1; i >= 0; i -= 1) {
      const item = feed[i];
      if (item.type === 'tool') return item.toolCallId;
    }
    return null;
  }, [feed]);

  const showInlineToolLoading = isRunning && Boolean(latestToolCallId);
  const showBottomLoading = isRunning && !latestToolCallId;

  const canSend = input.trim().length > 0 || attachments.length > 0;
  const modelConfigOption = useMemo(
    () => findModelConfigOption(configOptions),
    [configOptions]
  );
  const modelConfigId = useMemo(
    () => getConfigOptionId(modelConfigOption),
    [modelConfigOption]
  );
  const modelConfigChoices = useMemo(
    () => extractConfigChoices(modelConfigOption),
    [modelConfigOption]
  );
  const configModelValue = useMemo(
    () => getConfigOptionValue(modelConfigOption),
    [modelConfigOption]
  );
  const configModelId =
    configModelValue !== null && configModelValue !== undefined
      ? String(configModelValue)
      : null;
  const rawModelVariants = useMemo<ModelOption[]>(() => {
    if (modelConfigChoices.length) {
      return modelConfigChoices
        .map((choice) => {
          if (choice.value === undefined || choice.value === null) return null;
          return {
            id: String(choice.value),
            label: choice.label ?? choice.name ?? String(choice.value),
            description: choice.description,
          };
        })
        .filter(Boolean) as ModelOption[];
    }
    return models.map(normalizeModelOption).filter(Boolean) as ModelOption[];
  }, [modelConfigChoices, models]);

  const modelCatalog = useMemo(() => {
    const map = new Map<
      string,
      { baseId: string; label: string; description?: string; variants: ModelVariant[]; efforts: Set<string> }
    >();
    for (const variant of rawModelVariants) {
      const parts = splitModelId(variant.id, variant.label);
      const baseId = parts.baseId || variant.id;
      const baseLabel = stripEffortSuffix(variant.label) ?? baseId;
      const formattedLabel = formatModelLabel(baseLabel);
      const entry =
        map.get(baseId) ?? {
          baseId,
          label: formattedLabel,
          description: variant.description,
          variants: [],
          efforts: new Set<string>(),
        };
      entry.variants.push({ ...variant, baseId, effort: parts.effort });
      if (parts.effort) entry.efforts.add(parts.effort);
      if (!entry.label && formattedLabel) entry.label = formattedLabel;
      map.set(baseId, entry);
    }
    return map;
  }, [rawModelVariants]);

  const modelOptions = useMemo<ModelOption[]>(() => {
    return Array.from(modelCatalog.values()).map((entry) => ({
      id: entry.baseId,
      label: entry.label,
      description: entry.description,
    }));
  }, [modelCatalog]);

  const rawSelectedModelId =
    configModelId ?? currentModelId ?? (modelId ? String(modelId) : null);
  const selectedModelParts = splitModelId(rawSelectedModelId, null);
  const selectedBaseId =
    (selectedModelParts.baseId && modelCatalog.has(selectedModelParts.baseId)
      ? selectedModelParts.baseId
      : modelOptions[0]?.id) ?? '';
  const selectedModelEntry = selectedBaseId ? modelCatalog.get(selectedBaseId) : undefined;
  const currentEffort = selectedModelParts.effort;
  const fallbackModelId = selectedBaseId || modelId;
  const resolvedModelValue = modelOptions.some((option) => option.id === fallbackModelId)
    ? fallbackModelId
    : undefined;
  const canSetModel = Boolean(sessionId) && (Boolean(modelConfigId) || modelOptions.length > 0);
  const thinkingConfigOption = useMemo(
    () => findThinkingConfigOption(configOptions),
    [configOptions]
  );
  const thinkingConfigId = useMemo(
    () => getConfigOptionId(thinkingConfigOption),
    [thinkingConfigOption]
  );
  const thinkingConfigMapping = useMemo(
    () => buildBudgetMapping(thinkingConfigOption),
    [thinkingConfigOption]
  );
  const configDrivenBudget = useMemo(
    () => getBudgetFromConfig(thinkingConfigOption),
    [thinkingConfigOption]
  );
  const modelDrivenBudget = useMemo(
    () => budgetFromEffort(currentEffort),
    [currentEffort]
  );
  const fallbackThinkingConfigId = provider === 'codex' ? 'model_reasoning_effort' : null;
  const availableBudgetLevels = useMemo(() => {
    if (thinkingConfigMapping.availableLevels.size) {
      return EFFORT_ORDER.filter((level) => thinkingConfigMapping.availableLevels.has(level));
    }
    if (selectedModelEntry?.efforts?.size) {
      const normalized = new Set(
        Array.from(selectedModelEntry.efforts)
          .map((entry) => normalizeEffort(entry))
          .filter(Boolean) as ThinkingBudgetLevel[]
      );
      return EFFORT_ORDER.filter((level) => normalized.has(level));
    }
    return ['low', 'medium', 'high'] as ThinkingBudgetLevel[];
  }, [selectedModelEntry?.efforts, thinkingConfigMapping.availableLevels]);
  const resolvedBudget: ThinkingBudgetLevel =
    configDrivenBudget ?? modelDrivenBudget ?? thinkingBudget ?? availableBudgetLevels[0] ?? 'medium';
  const activeBudgetLevel = availableBudgetLevels.includes(resolvedBudget)
    ? resolvedBudget
    : availableBudgetLevels[0] ?? 'medium';
  const activeBudgetLabel = EFFORT_LABELS[activeBudgetLevel];
  const activeBudgetIndex = Math.max(0, availableBudgetLevels.indexOf(activeBudgetLevel));
  const dotCount = Math.max(1, availableBudgetLevels.length);
  const dotSize = dotCount >= 4 ? 3 : 4;
  const dotGap = dotCount >= 4 ? 2 : 3;
  const canSetThinkingBudget =
    Boolean(sessionId) &&
    (Boolean(thinkingConfigId) || Boolean(selectedModelEntry?.variants.length) || Boolean(fallbackThinkingConfigId));

  const handleModelChange = useCallback(
    (value: string) => {
      setModelId(value);
      if (!sessionId || !canSetModel) return;

      const entry = modelCatalog.get(value);
      const availableEfforts = entry?.efforts ?? new Set<string>();
      const preferredEffort =
        (activeBudgetLevel && chooseEffortForBudget(activeBudgetLevel, availableEfforts)) ||
        currentEffort;
      const targetVariant =
        entry?.variants.find((variant) => variant.effort === preferredEffort) ??
        entry?.variants[0];
      const targetModelId = targetVariant?.id ?? value;

      if (modelConfigId) {
        const choice = modelConfigChoices.find((item) => String(item.value) === targetModelId);
        const targetValue = choice?.value ?? targetModelId;
        setConfigOptions((prev) =>
          prev.map((option) =>
            getConfigOptionId(option) === modelConfigId
              ? { ...option, value: targetValue, currentValue: targetValue }
              : option
          )
        );
        void window.electronAPI.acpSetConfigOption?.({
          sessionId,
          configId: modelConfigId,
          value: targetValue,
        }).then((res) => {
          if (!res?.success) {
            uiLog('model:setFailed', { modelId: targetModelId, error: res?.error });
          }
        });
        return;
      }

      setCurrentModelId(targetModelId);
      void window.electronAPI.acpSetModel?.({
        sessionId,
        modelId: targetModelId,
      }).then((res) => {
        if (!res?.success) {
          uiLog('model:setFailed', { modelId: targetModelId, error: res?.error });
        }
      });
    },
    [
      activeBudgetLevel,
      canSetModel,
      currentEffort,
      modelCatalog,
      modelConfigChoices,
      modelConfigId,
      sessionId,
      uiLog,
    ]
  );

  const handleThinkingBudgetClick = useCallback(() => {
    const next = nextBudgetLevel(activeBudgetLevel, availableBudgetLevels);
    setThinkingBudget(next);

    if (!canSetThinkingBudget) return;
    if (thinkingConfigId) {
      const targetChoice = thinkingConfigMapping.budgetToChoice.get(next);
      const targetValue = targetChoice?.value ?? next;
      if (targetValue === undefined) {
        uiLog('thinkingBudget:missingOption', { next, configId: thinkingConfigId });
        return;
      }
      if (targetChoice) {
        setConfigOptions((prev) =>
          prev.map((option) =>
            getConfigOptionId(option) === thinkingConfigId
              ? { ...option, value: targetChoice.value, currentValue: targetChoice.value }
              : option
          )
        );
      }
      void window.electronAPI.acpSetConfigOption?.({
        sessionId,
        configId: thinkingConfigId,
        value: targetValue,
      }).then((res) => {
        if (!res?.success) {
          uiLog('thinkingBudget:setFailed', { configId: thinkingConfigId, error: res?.error });
        }
      });
      return;
    }

    if (selectedModelEntry && selectedModelEntry.variants.length) {
      const desiredEffort = chooseEffortForBudget(next, selectedModelEntry.efforts);
      const targetVariant =
        selectedModelEntry.variants.find((variant) => variant.effort === desiredEffort) ??
        selectedModelEntry.variants[0];
      if (!targetVariant) return;
      setCurrentModelId(targetVariant.id);
      void window.electronAPI.acpSetModel?.({
        sessionId,
        modelId: targetVariant.id,
      }).then((res) => {
        if (!res?.success) {
          uiLog('thinkingBudget:setFailed', { modelId: targetVariant.id, error: res?.error });
        }
      });
      return;
    }

    const configId = fallbackThinkingConfigId;
    if (!configId) return;
    const targetValue = next;
    void window.electronAPI.acpSetConfigOption?.({
      sessionId,
      configId,
      value: targetValue,
    }).then((res) => {
      if (!res?.success) {
        uiLog('thinkingBudget:setFailed', { configId, error: res?.error });
      }
    });
  }, [
    activeBudgetLevel,
    canSetThinkingBudget,
    fallbackThinkingConfigId,
    availableBudgetLevels,
    sessionId,
    thinkingConfigId,
    thinkingConfigMapping.budgetToChoice,
    selectedModelEntry,
    uiLog,
  ]);

  const handleCopyMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!text) return;
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        console.error('Clipboard API not available in this environment');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setCopiedMessageId(messageId);
        if (copyResetRef.current !== null) {
          window.clearTimeout(copyResetRef.current);
        }
        copyResetRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
          copyResetRef.current = null;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy message', error);
        setCopiedMessageId(null);
      }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps -- Intentionally empty to avoid recreating callback; uses latest state via setState
  );

  const renderContentBlocks = (
    blocks: ContentBlock[],
    options?: { compact?: boolean; maxPreviewChars?: number }
  ) => {
    const isCompact = Boolean(options?.compact);
    const previewLimit = options?.maxPreviewChars ?? 200;
    return blocks.map((block, index) => {
      if (block.type === 'text') {
        const text = block.text || '';
        const clipped = isCompact ? truncateText(text, previewLimit) : text;
        return (
          <p
            key={index}
            className={
              isCompact
                ? 'whitespace-pre-wrap text-xs text-muted-foreground'
                : 'whitespace-pre-wrap text-sm leading-relaxed'
            }
          >
            {clipped}
          </p>
        );
      }
      if (block.type === 'image' && block.data && block.mimeType) {
        return (
          <img
            key={index}
            src={`data:${block.mimeType};base64,${block.data}`}
            alt={block.title || 'image'}
            className="max-h-64 rounded-md border"
          />
        );
      }
      if (block.type === 'audio' && block.data && block.mimeType) {
        return (
          <audio key={index} controls className="w-full">
            <source src={`data:${block.mimeType};base64,${block.data}`} />
          </audio>
        );
      }
      if (block.type === 'resource' || block.type === 'resource_link') {
        const resource = block.resource || {};
        const uri = (resource.uri as string | undefined) || block.uri || '';
        const label =
          resource.title || resource.name || block.title || block.name || uri || 'resource';
        const previewText = (resource.text as string | undefined) || block.text;
        const isFile = uri.startsWith('file://');
        const filePath = isFile ? fromFileUri(uri) : '';
        const displayLabel = isFile && filePath ? formatPath(filePath) || label : label;
        const displayLabelText = truncateText(displayLabel, 160);
        return (
          <div
            key={index}
            className={`flex items-center justify-between gap-2 text-xs ${
              isCompact ? 'text-muted-foreground/90' : 'text-muted-foreground'
            }`}
          >
            <div className="min-w-0">
              <div className="overflow-hidden whitespace-nowrap">{displayLabelText}</div>
              {block.type === 'resource' && previewText ? (
                <div className="mt-1 text-[11px] text-muted-foreground/80">
                  {truncateText(previewText, previewLimit)}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {uri ? (
                <button
                  type="button"
                  onClick={() => {
                    if (uri.startsWith('http')) {
                      window.electronAPI.openExternal(uri);
                      return;
                    }
                    if (isFile) {
                      const filePath = decodeURIComponent(uri.replace('file://', ''));
                      window.electronAPI.openIn({ app: 'finder', path: filePath });
                    }
                  }}
                  className="text-xs text-foreground underline"
                >
                  Open
                </button>
              ) : null}
            </div>
          </div>
        );
      }
      return (
        <pre key={index} className="whitespace-pre-wrap text-xs text-muted-foreground">
          {JSON.stringify(block, null, 2)}
        </pre>
      );
    });
  };

  const ActionRow: React.FC<{
    id: string;
    icon: React.ReactNode;
    label: string;
    target?: string;
    leftMeta?: React.ReactNode;
    meta?: React.ReactNode;
    status?: string;
    expanded?: boolean;
    onToggle?: () => void;
    children?: React.ReactNode;
  }> = ({ id, icon, label, target, leftMeta, meta, status, expanded, onToggle, children }) => {
    const showStatus = status !== undefined && ['failed', 'cancelled', 'error'].includes(status);
    const statusClass =
      status && statusStyles[status]
        ? statusStyles[status]
        : 'text-muted-foreground bg-muted/40 border-border';
    return (
      <div data-action-id={id} className="rounded-md">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="group flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/30"
        >
          <span className="relative flex h-4 w-4 items-center justify-center text-muted-foreground">
            <span className="transition-opacity group-hover:opacity-0">{icon}</span>
            <Plus className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="min-w-0 flex-1 overflow-hidden text-sm">
            <span className="font-medium text-foreground">{label}</span>
            {target || leftMeta ? (
              <span className="ml-2 inline-flex min-w-0 items-center gap-2 overflow-hidden text-muted-foreground">
                {target ? (
                  <span className="overflow-hidden whitespace-nowrap">{target}</span>
                ) : null}
                {leftMeta ? <span className="flex items-center gap-2">{leftMeta}</span> : null}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {meta}
            {showStatus ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass}`}
              >
                {status.replace('_', ' ')}
              </span>
            ) : null}
          </span>
        </button>
        {expanded && children ? (
          <div className="px-3 pb-2 pt-1">
            <div className="inline-block max-w-full rounded-md border border-border/40 bg-muted/10 px-2.5 py-1.5">
              {children}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderDiffPreview = (diff: DiffPreview) => {
    if (!diff.lines.length) return null;
    const pathLabel = diff.path ? truncateText(diff.path, 160) : null;
    return (
      <div className="rounded-md px-1">
        {pathLabel ? (
          <div className="mb-1 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground">
            {pathLabel}
          </div>
        ) : null}
        <div className="space-y-0.5 font-mono text-xs">
          {diff.lines.map((line, idx) => {
            const style =
              line.type === 'add'
                ? 'text-emerald-700 bg-emerald-50/70 dark:text-emerald-300 dark:bg-emerald-900/30'
                : line.type === 'del'
                  ? 'text-red-700 bg-red-50/70 dark:text-red-300 dark:bg-red-900/30'
                  : 'text-muted-foreground';
            const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
            return (
              <div key={idx} className={`flex gap-2 rounded px-1 ${style}`}>
                <span className="w-3 select-none">{prefix}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {line.text || ' '}
                </span>
              </div>
            );
          })}
        </div>
        {diff.truncated ? (
          <div className="mt-1 text-[11px] text-muted-foreground">Diff truncated</div>
        ) : null}
      </div>
    );
  };

  // Memoize diff previews to avoid re-computing Myers diff on every render
  const diffPreviewsByToolCall = useMemo(() => {
    const result: Record<string, DiffPreview[]> = {};
    for (const [toolCallId, toolCall] of Object.entries(toolCalls)) {
      const diffItems = (toolCall.content?.filter((item) => item.type === 'diff') || []) as Array<{
        type: 'diff';
        path?: string;
        oldText?: string;
        newText?: string;
        original?: string;
        updated?: string;
      }>;
      if (diffItems.length > 0) {
        result[toolCallId] = diffItems.map((item) => {
          const before = (item as any).oldText ?? (item as any).original ?? '';
          const after = (item as any).newText ?? (item as any).updated ?? '';
          const preview = buildDiffPreview(String(before ?? ''), String(after ?? ''));
          return { ...preview, path: formatPath(item.path) } as DiffPreview;
        });
      }
    }
    return result;
  }, [toolCalls]);

  const renderToolCall = (toolCallId: string) => {
    const toolCall = toolCalls[toolCallId];
    if (!toolCall) return null;
    const status = toolCall.status || 'pending';
    const expandedKey = `tool-${toolCallId}`;
    const expanded = Boolean(expandedItems[expandedKey]);
    const kindLabel = `${toolCall.title || ''} ${toolCall.kind || ''}`.toLowerCase();
    const diffItems = (toolCall.content?.filter((item) => item.type === 'diff') || []) as Array<{
      type: 'diff';
      path?: string;
      oldText?: string;
      newText?: string;
      original?: string;
      updated?: string;
    }>;
    const terminalItems =
      (toolCall.content?.filter((item) => item.type === 'terminal') as
        | Array<{ type: 'terminal'; terminalId: string }>
        | undefined) || [];
    const contentBlocks =
      (toolCall.content?.filter((item) => item.type === 'content') as
        | Array<{ type: 'content'; content: ContentBlock }>
        | undefined) || [];

    // Use memoized diff previews to avoid re-computing Myers diff on every render
    const diffPreviews: DiffPreview[] = diffPreviewsByToolCall[toolCallId] || [];

    const diffTotals = diffPreviews.reduce(
      (acc, diff) => ({
        additions: acc.additions + diff.additions,
        deletions: acc.deletions + diff.deletions,
      }),
      { additions: 0, deletions: 0 }
    );

    const parsedInput = safeJsonParse(toolCall.rawInput);
    const command = parsedInput?.command
      ? [parsedInput.command, ...(Array.isArray(parsedInput.args) ? parsedInput.args : [])].join(
          ' '
        )
      : null;
    const query =
      parsedInput?.query || parsedInput?.search || parsedInput?.input || parsedInput?.prompt;

    const contentPaths = contentBlocks
      .map((item) => {
        const block = item.content;
        const resource = block.resource || {};
        const uri = (resource.uri as string | undefined) || block.uri;
        if (uri?.startsWith('file://')) return formatPath(fromFileUri(uri));
        return null;
      })
      .filter(Boolean) as string[];
    const locationPath = formatPath(toolCall.locations?.[0]?.path);
    const diffPath = formatPath(diffItems.find((item) => item.path)?.path);
    const rawPath = formatPath(parsedInput?.path || parsedInput?.filePath || parsedInput?.filepath);
    const primaryPath = diffPath || locationPath || contentPaths[0] || rawPath;

    const hasTerminal = terminalItems.length > 0 || Boolean(command);
    const hasDiff = diffItems.length > 0;
    const hasHttpResources = contentBlocks.some((item) => {
      const block = item.content;
      const resource = block.resource || {};
      const uri = (resource.uri as string | undefined) || block.uri || '';
      return uri.startsWith('http://') || uri.startsWith('https://');
    });

    let action = 'tool';
    if (hasDiff || /write|edit|modify|update|patch|diff/.test(kindLabel)) {
      action = 'edit';
    } else if (hasTerminal || /terminal|run|exec|command/.test(kindLabel)) {
      action = 'run';
    } else if (/read|view|open/.test(kindLabel) || primaryPath) {
      action = 'view';
    } else if (/search|browse|research|web/.test(kindLabel) || hasHttpResources) {
      action = 'research';
    }

    const icon =
      action === 'edit' ? (
        <Pencil className="h-4 w-4" />
      ) : action === 'run' ? (
        <Terminal className="h-4 w-4" />
      ) : action === 'view' ? (
        <FileText className="h-4 w-4" />
      ) : action === 'research' ? (
        <Search className="h-4 w-4" />
      ) : (
        <Sparkles className="h-4 w-4" />
      );

    const label = action === 'tool' ? toolCall.title || toolCall.kind || 'Tool' : action;
    const target =
      action === 'run'
        ? command || primaryPath
        : action === 'research'
          ? query || toolCall.title || primaryPath
          : action === 'tool'
            ? primaryPath || query
            : primaryPath || toolCall.title || toolCall.kind;
    const displayTarget = target
      ? truncateText(collapseWhitespace(String(target)), 160)
      : undefined;
    const leftMeta = hasDiff ? (
      <>
        <span className="text-emerald-600">+{diffTotals.additions}</span>
        <span className="text-red-600">-{diffTotals.deletions}</span>
      </>
    ) : null;

    let meta: React.ReactNode = null;
    if (action === 'view') {
      const text = extractPrimaryText(contentBlocks.map((item) => item.content));
      if (text) {
        const count = splitLines(text).length;
        meta = <span>{count} lines</span>;
      }
    } else if (action === 'research') {
      const sources = contentBlocks.filter((item) => {
        const block = item.content;
        const resource = block.resource || {};
        const uri = (resource.uri as string | undefined) || block.uri || '';
        return uri.startsWith('http://') || uri.startsWith('https://');
      }).length;
      if (sources) meta = <span>{sources} sources</span>;
    }

    const showLoading = Boolean(options?.showLoading);

    return (
      <ActionRow
        key={expandedKey}
        id={expandedKey}
        icon={icon}
        label={label}
        target={displayTarget}
        leftMeta={leftMeta}
        meta={meta}
        status={status}
        expanded={expanded}
        onToggle={() => toggleExpanded(expandedKey)}
      >
        <div className="space-y-2 text-sm text-foreground">
          {diffPreviews.length ? (
            <div className="space-y-2">
              {diffPreviews.map((diff, idx) => (
                <div key={`${diff.path || 'diff'}-${idx}`}>{renderDiffPreview(diff)}</div>
              ))}
            </div>
          ) : null}
          {contentBlocks.length ? (
            <div className="space-y-2">
              {contentBlocks.map((item, idx) => (
                <div key={idx}>
                  {renderContentBlocks([item.content], { compact: true, maxPreviewChars: 280 })}
                </div>
              ))}
            </div>
          ) : null}
          {terminalItems.length ? (
            <div className="space-y-2">
              {terminalItems.map((item, idx) => {
                const output = terminalOutputs[item.terminalId] || '';
                const tail = getTailLines(output, 60);
                return (
                  <div
                    key={`${item.terminalId}-${idx}`}
                    className="rounded-md bg-black/90 px-3 py-2 text-xs text-white"
                  >
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-white/60">
                      Terminal output
                    </div>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">
                      {tail.lines.join('\n')}
                    </pre>
                    {tail.truncated ? (
                      <div className="mt-1 text-[11px] text-white/60">Output truncated</div>
                    ) : null}
                  </div>
                );
              })}
              </div>
            ) : null}
          </div>
        {showLoading ? <LoadingTimer label={runTimerLabel} /> : null}
      </ActionRow>
    );
  };

  const renderPermission = (request: PermissionRequest) => {
    const toolTitle =
      request.toolCall?.title ||
      request.toolCall?.kind ||
      (request as any).title ||
      'Permission required';
    return (
      <div
        key={request.requestId}
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <div className="space-y-1">
            <div className="font-semibold">{toolTitle}</div>
            <div className="text-xs text-destructive/90">
              This tool call requires explicit approval.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {request.options?.length ? (
                request.options.map((option) => (
                  <Button
                    key={option.id}
                    size="sm"
                    variant="secondary"
                    className="h-7"
                    onClick={() => handlePermissionChoice(request.requestId, option.id)}
                  >
                    {option.label}
                    {option.kind ? ` (${option.kind})` : ''}
                  </Button>
                ))
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  onClick={() => handlePermissionChoice(request.requestId, 'approve')}
                >
                  Allow
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => handlePermissionChoice(request.requestId, null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderToolThoughtGroup = (
    groupId: string,
    buffer: FeedItem[],
    expanded: boolean,
    showLoading: boolean
  ) => {
    const toolCount = buffer.filter((item) => item.type === 'tool').length;
    const thoughtCount = buffer.filter(
      (item) => item.type === 'message' && item.messageKind === 'thought'
    ).length;
    if (!toolCount && !thoughtCount) return null;
    const parts: string[] = [];
    if (toolCount) parts.push(pluralize(toolCount, 'tool call'));
    if (thoughtCount) parts.push(pluralize(thoughtCount, 'thought'));
    return (
      <div key={groupId} className="rounded-md">
        <button
          type="button"
          onClick={() => toggleExpanded(groupId)}
          aria-expanded={expanded}
          className="group flex items-center gap-2 rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <span>{parts.join(', ')}</span>
        </button>
        {expanded ? (
          <div className="mt-1 space-y-2">
            {buffer.map((item) => {
              if (item.type === 'tool') {
                return renderToolCall(item.toolCallId, {
                  showLoading: showLoading && item.toolCallId === latestToolCallId,
                });
              }
              if (item.type === 'message' && item.messageKind === 'thought') {
                return renderThoughtMessage(item);
              }
              return null;
            })}
          </div>
        ) : null}
        {showLoading && !expanded ? (
          <div className="mt-1">
            <LoadingTimer label={runTimerLabel} />
          </div>
        ) : null}
      </div>
    );
  };

  const renderThoughtMessage = (item: Extract<FeedItem, { type: 'message' }>) => {
    const expandedKey = `thought-${item.id}`;
    const expanded = Boolean(expandedItems[expandedKey]);
    const text = extractPrimaryText(item.blocks).trim();
    const summary = text ? truncateText(text.split('\n')[0], 120) : 'Thinking...';
    return (
      <ActionRow
        key={expandedKey}
        id={expandedKey}
        icon={<Brain className="h-4 w-4" />}
        label="thinking"
        target={summary}
        expanded={expanded}
        onToggle={() => toggleExpanded(expandedKey)}
      >
        <div className={item.streaming ? 'shimmer-text' : ''}>
          {renderContentBlocks(item.blocks, { compact: true, maxPreviewChars: 800 })}
        </div>
      </ActionRow>
    );
  };

  const renderMessage = (item: Extract<FeedItem, { type: 'message' }>) => {
    if (item.messageKind === 'thought') {
      return renderThoughtMessage(item);
    }
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';
    const wrapperClass = isSystem
      ? 'flex justify-center'
      : isUser
        ? 'flex justify-end'
        : 'flex justify-start';
    const base = isSystem
      ? 'max-w-[80%] rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground'
      : isUser
        ? 'max-w-[75%] rounded-2xl border border-sky-500/40 bg-sky-600 px-4 py-3 text-white shadow-sm dark:bg-sky-500/80'
        : 'max-w-[80%] text-sm text-foreground';
    const showFooter =
      item.role === 'assistant' &&
      !item.messageKind &&
      typeof item.runDurationMs === 'number';
    const messageText = showFooter ? buildCopyText(item.blocks) : '';
    const CopyIcon = copiedMessageId === item.id ? Check : Copy;
    return (
      <div key={item.id} className={wrapperClass}>
        <div className={base}>
          <div className={item.streaming && !isUser ? 'shimmer-text' : ''}>
            {renderContentBlocks(item.blocks)}
          </div>
          {showFooter ? (
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="tabular-nums">{formatDuration(item.runDurationMs ?? 0)}</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-foreground hover:bg-background"
                onClick={() => handleCopyMessage(item.id, messageText)}
                disabled={!messageText}
              >
                <CopyIcon className="h-3 w-3" />
                <span>{copiedMessageId === item.id ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex h-full flex-col bg-white dark:bg-gray-900 ${className || ''}`}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-6">
          <div className="mx-auto max-w-4xl space-y-2">
            {isProviderInstalled === false ? (
              <InstallBanner
                provider={provider as any}
                installCommand={getInstallCommandForProvider(provider as any)}
                onRunInstall={runInstallCommand}
                onOpenExternal={(url) => window.electronAPI.openExternal(url)}
              />
            ) : null}
          </div>
        </div>

        {plan && plan.length ? (
          <div className="px-6 pt-3">
            <div className="mx-auto max-w-4xl rounded-md border border-border bg-muted/20 p-3 text-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                onClick={() => setShowPlan((v) => !v)}
              >
                Plan
                <ChevronDown className={`h-3.5 w-3.5 transition ${showPlan ? 'rotate-180' : ''}`} />
              </button>
              {showPlan ? (
                <div className="mt-2 space-y-2">
                  {plan.map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm text-foreground">
                      <Circle className="mt-0.5 h-3 w-3 text-muted-foreground" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{entry.content || ''}</span>
                          {entry.priority ? (
                            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {entry.priority}
                            </span>
                          ) : null}
                        </div>
                        {entry.status ? (
                          <div className="text-xs text-muted-foreground">{entry.status}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 pb-8">
            {(() => {
              const rendered: React.ReactNode[] = [];
              let buffer: FeedItem[] = [];

              const flushInline = () => {
                if (!buffer.length) return;
                buffer.forEach((item) => {
                  if (item.type === 'tool') {
                    rendered.push(
                      renderToolCall(item.toolCallId, {
                        showLoading: showInlineToolLoading && item.toolCallId === latestToolCallId,
                      })
                    );
                  }
                  if (item.type === 'message' && item.messageKind === 'thought') {
                    rendered.push(renderThoughtMessage(item));
                  }
                });
                buffer = [];
              };

              const canCollapseBuffer = (assistantItem: Extract<FeedItem, { type: 'message' }>) => {
                if (!buffer.length) return false;
                if (assistantItem.streaming) return false;
                for (const item of buffer) {
                  if (item.type === 'tool') {
                    const status = toolCalls[item.toolCallId]?.status;
                    if (!status || !['completed', 'failed', 'cancelled'].includes(status)) {
                      return false;
                    }
                  }
                  if (item.type === 'message' && item.messageKind === 'thought') {
                    if (item.streaming) return false;
                  }
                }
                return true;
              };

              feed.forEach((item) => {
                if (
                  item.type === 'tool' ||
                  (item.type === 'message' && item.messageKind === 'thought')
                ) {
                  buffer.push(item);
                  return;
                }

                if (item.type === 'message' && item.role === 'assistant') {
                  const shouldCollapse = canCollapseBuffer(item);
                  if (!shouldCollapse) {
                    flushInline();
                  } else {
                    const groupId = `tools-${item.id}`;
                    const expanded = Boolean(expandedItems[groupId]);
                    const hasLatest =
                      showInlineToolLoading &&
                      Boolean(
                        latestToolCallId &&
                          buffer.some(
                            (buffered) =>
                              buffered.type === 'tool' &&
                              buffered.toolCallId === latestToolCallId
                          )
                      );
                    rendered.push(renderToolThoughtGroup(groupId, buffer, expanded, hasLatest));
                    buffer = [];
                  }
                  rendered.push(renderMessage(item));
                  return;
                }

                flushInline();

                if (item.type === 'message') {
                  rendered.push(renderMessage(item));
                  return;
                }
                if (item.type === 'permission') {
                  const request = permissions[item.requestId];
                  rendered.push(request ? renderPermission(request) : null);
                  return;
                }
              });

              flushInline();
              return rendered;
            })()}
            {showBottomLoading ? <LoadingTimer label={runTimerLabel} /> : null}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="bg-transparent px-6 py-4">
          <div className="mx-auto max-w-4xl space-y-3">
            {commandSuggestions.length ? (
              <div className="rounded-lg border border-border bg-background p-2 text-xs shadow-lg">
                {commandSuggestions.map((cmd) => (
                  <button
                    key={cmd.name}
                    type="button"
                    className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-muted/40"
                    onClick={() => setInput(`/${cmd.name} `)}
                  >
                    <span className="font-medium text-foreground">/{cmd.name}</span>
                    {cmd.description ? (
                      <span className="text-muted-foreground">{cmd.description}</span>
                    ) : null}
                    {cmd.hint ? (
                      <span className="text-muted-foreground/70">- {cmd.hint}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="relative rounded-xl border border-border/60 bg-background/90 shadow-sm backdrop-blur-sm">
              {sessionError ? (
                <div className="absolute -top-16 left-4 right-4 z-10 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/95 px-3 py-2 text-xs text-destructive-foreground shadow-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <div>
                    <div className="font-semibold">ACP session failed</div>
                    <div>{sessionError}</div>
                  </div>
                </div>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                onChange={(event) => {
                  if (!event.target.files) return;
                  void handleFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <div className="px-4 pt-4">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask to make changes..."
                  rows={1}
                  className="w-full resize-none overflow-y-auto bg-transparent text-sm leading-relaxed text-foreground selection:bg-primary/20 placeholder:text-muted-foreground focus:outline-none"
                  style={{ minHeight: '40px', maxHeight: '200px' }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (event.dataTransfer?.files?.length) {
                      void handleFiles(event.dataTransfer.files);
                    }
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  spellCheck={false}
                />
              </div>
              {attachments.length ? (
                <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs"
                    >
                      <span className="truncate">{att.name}</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => removeAttachment(att.id)}
                        aria-label="Remove attachment"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-sm"
                  >
                    <OpenAIIcon className="h-3.5 w-3.5" />
                    <span>Codex</span>
                  </button>
                  <Select value={resolvedModelValue} onValueChange={handleModelChange}>
                    <SelectTrigger
                      disabled={!canSetModel || modelOptions.length === 0}
                      className="h-8 w-auto rounded-md border border-border/60 bg-background/90 px-2.5 text-xs text-foreground shadow-sm"
                    >
                      <SelectValue
                        placeholder={modelOptions.length ? 'Model' : 'Model (not supported)'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.length ? (
                        modelOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__empty" disabled>
                          No models available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setPlanModeEnabled((prev) => !prev)}
                    aria-pressed={planModeEnabled}
                    title={planModeEnabled ? 'Plan mode: read-only' : 'Full access'}
                    className={`flex h-8 items-center justify-center rounded-md px-2 text-muted-foreground transition ${
                      planModeEnabled
                        ? 'bg-sky-100/70 text-sky-700 hover:bg-sky-100/90 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:bg-sky-500/15'
                        : 'bg-transparent hover:bg-muted/40 hover:text-foreground'
                    }`}
                  >
                    <Clipboard className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleThinkingBudgetClick}
                    title={
                      canSetThinkingBudget
                        ? `Thinking budget: ${activeBudgetLabel}`
                        : `Thinking budget: ${activeBudgetLabel} (not supported)`
                    }
                    aria-label={`Thinking budget: ${activeBudgetLabel}`}
                    disabled={!canSetThinkingBudget}
                    className="flex h-8 items-center gap-2 rounded-md bg-violet-100/70 px-2 text-xs font-medium text-violet-700 transition hover:bg-violet-100/90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/15"
                  >
                    <Brain className="h-4 w-4" />
                    <span
                      className="flex flex-col-reverse items-center justify-center"
                      style={{ gap: `${dotGap}px` }}
                      aria-hidden="true"
                    >
                      {Array.from({ length: dotCount }).map((_, idx) => (
                        <span
                          key={`thinking-dot-${idx}`}
                          style={{ width: `${dotSize}px`, height: `${dotSize}px` }}
                          className={`rounded-full ${
                            idx <= activeBudgetIndex ? 'bg-current' : 'bg-muted-foreground/30'
                          }`}
                        />
                      ))}
                    </span>
                    <span className="text-xs font-medium">{activeBudgetLabel}</span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-md bg-background/90 text-muted-foreground hover:bg-background hover:text-foreground"
                    onClick={handleAttachClick}
                    disabled={!sessionId}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    onClick={isRunning ? handleCancel : handleSend}
                    className="h-8 w-8 rounded-md"
                    disabled={!sessionId || (isRunning ? false : !canSend)}
                    variant={isRunning ? 'secondary' : 'default'}
                  >
                    {isRunning ? <Square className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            {commandHint ? (
              <div className="text-xs text-muted-foreground">Hint: {commandHint}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcpChatInterface;

async function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function readFileAsText(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
