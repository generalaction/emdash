import { metadataRegistry } from 'cli-agent-plugins/metadata';
import ampcodeIcon from '@/assets/images/ampcode.svg?raw';
import antigravityIcon from '@/assets/images/antigravity.svg?raw';
import atlassianIcon from '@/assets/images/atlassian.png';
import augmentcodeIcon from '@/assets/images/Auggie.svg?raw';
import autohandIcon from '@/assets/images/autohand.svg?raw';
import charmIcon from '@/assets/images/charm.png';
import claudeIcon from '@/assets/images/claude.svg?raw';
import clineIcon from '@/assets/images/cline.png';
import codebuffIcon from '@/assets/images/codebuff.png';
import commandcodeIcon from '@/assets/images/commandcode.svg?raw';
import continueIcon from '@/assets/images/continue.png';
import cursorIcon from '@/assets/images/cursor.svg?raw';
import devinIcon from '@/assets/images/devin.png';
import factorydroidIcon from '@/assets/images/droid.svg?raw';
import geminiIcon from '@/assets/images/gemini.svg?raw';
import ghcopilotIcon from '@/assets/images/gh-copilot.svg?raw';
import gooseIcon from '@/assets/images/goose.png';
import hermesIcon from '@/assets/images/hermesagent.jpg';
import julesIcon from '@/assets/images/jules.svg?raw';
import junieIcon from '@/assets/images/junie-color.png';
import kilocodeIcon from '@/assets/images/kilocode.png';
import kimiIcon from '@/assets/images/kimi.svg?raw';
import kiroIcon from '@/assets/images/kiro.png';
import lettaIcon from '@/assets/images/letta.svg?raw';
import mistralIcon from '@/assets/images/mistral.svg?raw';
import openaiIcon from '@/assets/images/openai.svg?raw';
import opencodeDarkIcon from '@/assets/images/opencode-dark.svg?raw';
import opencodeIcon from '@/assets/images/opencode.svg?raw';
import piIcon from '@/assets/images/pi.png';
import qwenIcon from '@/assets/images/qwen.svg?raw';
import xaiIcon from '@/assets/images/xai.svg?raw';
import { AGENT_PROVIDERS, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';

export type UiAgent = AgentProviderId;

const ICONS: Record<string, string> = {
  'Auggie.svg': augmentcodeIcon,
  'qwen.svg': qwenIcon,
  'charm.png': charmIcon,
  'opencode.svg': opencodeIcon,
  'opencode-dark.svg': opencodeDarkIcon,
  'ampcode.svg': ampcodeIcon,
  'openai.svg': openaiIcon,
  'antigravity.svg': antigravityIcon,
  'claude.svg': claudeIcon,
  'droid.svg': factorydroidIcon,
  'gemini.svg': geminiIcon,
  'cursor.svg': cursorIcon,
  'devin.png': devinIcon,
  'gh-copilot.svg': ghcopilotIcon,
  'goose.png': gooseIcon,
  'hermesagent.jpg': hermesIcon,
  'jules.svg': julesIcon,
  'junie-color.png': junieIcon,
  'kimi.svg': kimiIcon,
  'kilocode.png': kilocodeIcon,
  'kiro.png': kiroIcon,
  'letta.svg': lettaIcon,
  'atlassian.png': atlassianIcon,
  'cline.png': clineIcon,
  'continue.png': continueIcon,
  'codebuff.png': codebuffIcon,
  'commandcode.svg': commandcodeIcon,
  'mistral.svg': mistralIcon,
  'pi.png': piIcon,
  'autohand.svg': autohandIcon,
  'xai.svg': xaiIcon,
};

export type AgentMeta = {
  label: string;
  icon?: string;
  iconDark?: string;
  /** True when the icon is a raw SVG string rather than an image URL. */
  isSvg?: boolean;
  /** When true, the icon should be colour-inverted in dark mode. */
  invertInDark?: boolean;
  /** Accessible alt text for the provider logo. */
  alt?: string;
  terminalOnly: boolean;
  cli?: string;
  planActivate?: string;
  autoStartCommand?: string;
  /** True when the initial prompt is delivered via keystroke injection into the TUI. */
  useKeystrokeInjection?: boolean;
  /** True when the initial prompt is piped via stdin. */
  initialPromptViaStdinPipe?: boolean;
};

export const agentMeta: Record<UiAgent, AgentMeta> = Object.fromEntries(
  AGENT_PROVIDERS.map((p) => {
    const pluginMeta = metadataRegistry.get(p.id);
    const promptDeliveryKind = pluginMeta?.capabilities.promptDelivery.kind;
    return [
      p.id,
      {
        label: pluginMeta?.name ?? p.name,
        icon: p.icon ? ICONS[p.icon] : undefined,
        iconDark: p.iconDark ? ICONS[p.iconDark] : undefined,
        isSvg: p.icon ? p.icon.endsWith('.svg') : undefined,
        invertInDark: p.invertInDark,
        alt: p.alt,
        terminalOnly: p.terminalOnly ?? true,
        cli: pluginMeta?.capabilities.install.binaryNames[0] ?? p.cli,
        planActivate: p.planActivateCommand,
        autoStartCommand: p.autoStartCommand,
        useKeystrokeInjection: promptDeliveryKind === 'keystroke',
        initialPromptViaStdinPipe: promptDeliveryKind === 'stdin-pipe',
      },
    ];
  })
) as Record<UiAgent, AgentMeta>;
