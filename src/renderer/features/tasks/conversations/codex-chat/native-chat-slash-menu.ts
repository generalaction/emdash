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

export type NativeChatSlashGroup =
  | 'command'
  | 'model'
  | 'reasoning'
  | 'skill-active'
  | 'skill-shared'
  | 'skill-other';

type NativeChatSkillSlashGroup = Extract<NativeChatSlashGroup, `skill-${string}`>;

export type NativeChatSkillAffinity = 'codex' | 'claude' | 'pi' | 'shared';

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

function skillCompatibilityText(skill: CatalogSkill): string {
  return [
    skill.frontmatter?.compatibility,
    skill.skillMdContent,
    skill.description,
    skill.sourceRef,
    skill.catalogSkillId,
    skill.id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function inferNativeChatSkillAffinities(skill: CatalogSkill): NativeChatSkillAffinity[] {
  const affinities = new Set<NativeChatSkillAffinity>();
  const text = skillCompatibilityText(skill);

  if (skill.source === 'openai') affinities.add('codex');
  if (skill.source === 'anthropic') affinities.add('claude');

  if (/\b(codex|openai|chatgpt|gpt)\b/.test(text)) affinities.add('codex');
  if (/\b(claude|anthropic|claude code|claude-code)\b/.test(text)) affinities.add('claude');
  if (/\b(pi|pi coding agent|mariozechner)\b/.test(text)) affinities.add('pi');

  if (
    /\b(any|all|cross-agent|multi-agent|agentskills|skill\.md)\b/.test(text) ||
    text.includes('ai coding assistant')
  ) {
    affinities.add('shared');
  }

  return [...affinities];
}

function skillGroupForProvider(
  skill: CatalogSkill,
  providerId: NativeChatProviderId
): NativeChatSkillSlashGroup {
  const affinities = inferNativeChatSkillAffinities(skill);
  const providerAffinity = providerId === 'claude' ? 'claude' : providerId;
  if (affinities.includes(providerAffinity)) return 'skill-active';
  if (affinities.includes('shared') || affinities.length === 0) return 'skill-shared';
  return 'skill-other';
}

function skillDetail(skill: CatalogSkill, group: NativeChatSlashGroup): string {
  if (group === 'skill-other') {
    return `May target another agent. ${skill.description}`.trim();
  }
  if (group === 'skill-shared') {
    return `Shared prompt skill. ${skill.description}`.trim();
  }
  return skill.description;
}

const SKILL_GROUP_ORDER: Record<NativeChatSkillSlashGroup, number> = {
  'skill-active': 0,
  'skill-shared': 1,
  'skill-other': 2,
};

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
  const skillEntries = installedSkills
    .map<NativeChatSlashEntry & { group: NativeChatSkillSlashGroup }>((skill) => {
      const affinities = inferNativeChatSkillAffinities(skill);
      const group = skillGroupForProvider(skill, providerId);
      return {
        id: `${providerId}:skill:${skill.installId ?? skill.id}`,
        group,
        label: skill.displayName,
        detail: skillDetail(skill, group),
        keywords: ['skill', skill.id, skill.installId ?? '', ...affinities],
        action: { type: 'insert', text: skillPrompt(skill, providerId) },
      };
    })
    .sort((a, b) => {
      const groupDelta = SKILL_GROUP_ORDER[a.group] - SKILL_GROUP_ORDER[b.group];
      return groupDelta || a.label.localeCompare(b.label);
    });

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
