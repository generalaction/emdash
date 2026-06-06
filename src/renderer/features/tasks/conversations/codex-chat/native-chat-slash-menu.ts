import type { NativeChatProviderId } from '@shared/conversation-ui';
import {
  CLAUDE_CHAT_MODEL_OPTIONS,
  CLAUDE_EFFORT_OPTIONS,
  CODEX_CHAT_MODEL_OPTIONS,
  CODEX_EFFORT_OPTIONS,
  PI_CHAT_MODEL_OPTIONS,
  type CodexChatOptions,
} from '@shared/native-chat';
import type { CatalogSkill } from '@shared/skills/types';

export type NativeChatSlashGroup = 'command' | 'model' | 'reasoning' | 'skill';

export type NativeChatSlashEntry =
  | {
      id: string;
      group: NativeChatSlashGroup;
      label: string;
      detail?: string;
      keywords?: string[];
      action: { type: 'set-options'; options: CodexChatOptions };
    }
  | {
      id: string;
      group: NativeChatSlashGroup;
      label: string;
      detail?: string;
      keywords?: string[];
      action: { type: 'insert'; text: string };
    }
  | {
      id: string;
      group: NativeChatSlashGroup;
      label: string;
      detail?: string;
      keywords?: string[];
      action: { type: 'switch-terminal' };
    };

export type NativeChatSlashTrigger = {
  query: string;
  start: number;
  end: number;
};

export function getNativeChatSlashTrigger(
  draft: string,
  selectionStart: number
): NativeChatSlashTrigger | null {
  const caret = Math.max(0, Math.min(selectionStart, draft.length));
  const prefix = draft.slice(0, caret);
  const match = /(^|\s)\/([^\s/]*)$/.exec(prefix);
  if (!match) return null;
  return {
    query: match[2].toLowerCase(),
    start: caret - match[2].length - 1,
    end: caret,
  };
}

export function replaceSlashTrigger(
  draft: string,
  trigger: NativeChatSlashTrigger,
  replacement: string
): string {
  const suffix = draft.slice(trigger.end);
  const prefix = draft.slice(0, trigger.start);
  const spacer = replacement && suffix && !/^\s/.test(suffix) ? ' ' : '';
  return `${prefix}${replacement}${spacer}${suffix}`;
}

export function filterNativeChatSlashEntries(
  entries: NativeChatSlashEntry[],
  query: string
): NativeChatSlashEntry[] {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return entries;

  return entries.filter((entry) => {
    const haystack = [entry.label, entry.detail, entry.group, ...(entry.keywords ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

function skillPrompt(skill: CatalogSkill, providerId: NativeChatProviderId): string {
  const defaultPrompt = skill.defaultPrompt?.trim();
  if (defaultPrompt) return defaultPrompt;

  const name = skill.displayName || skill.installId || skill.id;
  if (providerId === 'claude') return `Use the ${name} skill for this Claude Code task.`;
  if (providerId === 'pi') return `Use the ${name} skill for this Pi run.`;
  return `Use the ${name} skill for this Codex task.`;
}

function modelEntries(
  providerId: NativeChatProviderId,
  currentModel: string | undefined
): NativeChatSlashEntry[] {
  const options =
    providerId === 'claude'
      ? CLAUDE_CHAT_MODEL_OPTIONS
      : providerId === 'pi'
        ? PI_CHAT_MODEL_OPTIONS
        : CODEX_CHAT_MODEL_OPTIONS;

  return [
    {
      id: `${providerId}:model:default`,
      group: 'model',
      label: 'Default model',
      detail: currentModel ? `Clear ${currentModel}` : 'Use the configured default',
      keywords: ['model'],
      action: { type: 'set-options', options: { model: null } },
    },
    ...options.map<NativeChatSlashEntry>((option) => ({
      id: `${providerId}:model:${option.id}`,
      group: 'model',
      label: option.label,
      detail: option.description,
      keywords: ['model', option.id],
      action: { type: 'set-options', options: { model: option.id } },
    })),
  ];
}

function reasoningEntries(providerId: NativeChatProviderId): NativeChatSlashEntry[] {
  const options = providerId === 'claude' ? CLAUDE_EFFORT_OPTIONS : CODEX_EFFORT_OPTIONS;
  const label = providerId === 'pi' ? 'thinking' : 'reasoning';
  return [
    {
      id: `${providerId}:reasoning:default`,
      group: 'reasoning',
      label: `Default ${label}`,
      detail: 'Use the provider default',
      keywords: [label, 'effort'],
      action: { type: 'set-options', options: { reasoningEffort: null } },
    },
    ...options.map<NativeChatSlashEntry>((option) => ({
      id: `${providerId}:reasoning:${option.id}`,
      group: 'reasoning',
      label: `${option.label} ${label}`,
      detail: option.description,
      keywords: [label, 'effort', option.id],
      action: { type: 'set-options', options: { reasoningEffort: option.id } },
    })),
  ];
}

function codexSpeedEntries(): NativeChatSlashEntry[] {
  return [
    {
      id: 'codex:speed:standard',
      group: 'command',
      label: 'Standard speed',
      detail: 'Use the normal Codex service tier',
      keywords: ['speed', 'service tier'],
      action: { type: 'set-options', options: { serviceTier: null } },
    },
    {
      id: 'codex:speed:fast',
      group: 'command',
      label: 'Fast speed',
      detail: 'Use Codex priority service tier',
      keywords: ['speed', 'priority', 'service tier'],
      action: { type: 'set-options', options: { serviceTier: 'priority' } },
    },
  ];
}

export function buildNativeChatSlashEntries({
  providerId,
  currentModel,
  installedSkills,
}: {
  providerId: NativeChatProviderId;
  currentModel?: string;
  installedSkills: CatalogSkill[];
}): NativeChatSlashEntry[] {
  const skillEntries = installedSkills.map<NativeChatSlashEntry>((skill) => ({
    id: `${providerId}:skill:${skill.installId ?? skill.id}`,
    group: 'skill',
    label: skill.displayName,
    detail: skill.description,
    keywords: ['skill', skill.id, skill.installId ?? ''],
    action: { type: 'insert', text: skillPrompt(skill, providerId) },
  }));

  return [
    {
      id: `${providerId}:terminal`,
      group: 'command',
      label: 'Switch to CLI terminal',
      detail: 'Continue this conversation in the provider terminal',
      keywords: ['terminal', 'cli'],
      action: { type: 'switch-terminal' },
    },
    {
      id: `${providerId}:access:sandboxed`,
      group: 'command',
      label: providerId === 'claude' ? 'Accept edits' : 'Standard access',
      detail: 'Use the safer default permission mode',
      keywords: ['access', 'permissions'],
      action: { type: 'set-options', options: { autoApprove: false } },
    },
    {
      id: `${providerId}:access:full`,
      group: 'command',
      label: 'Full access',
      detail: 'Skip provider permission checks',
      keywords: ['access', 'permissions', 'approve'],
      action: { type: 'set-options', options: { autoApprove: true } },
    },
    ...(providerId === 'codex' ? codexSpeedEntries() : []),
    ...modelEntries(providerId, currentModel),
    ...reasoningEntries(providerId),
    ...skillEntries,
  ];
}
