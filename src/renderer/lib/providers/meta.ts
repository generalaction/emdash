import ampcodeIcon from '@/assets/images/ampcode.png';
import atlassianIcon from '@/assets/images/atlassian.png';
import augmentcodeIcon from '@/assets/images/Auggie.svg?raw';
import autohandIcon from '@/assets/images/autohand.svg?raw';
import charmIcon from '@/assets/images/charm.png';
import claudeIcon from '@/assets/images/claude.png';
import clineIcon from '@/assets/images/cline.png';
import codebuffIcon from '@/assets/images/codebuff.png';
import continueIcon from '@/assets/images/continue.png';
import cursorlogoIcon from '@/assets/images/cursor.svg?raw';
import factorydroidIcon from '@/assets/images/droid.svg?raw';
import geminiIcon from '@/assets/images/gemini.png';
import ghcopilotIcon from '@/assets/images/gh-copilot.svg?raw';
import gooseIcon from '@/assets/images/goose.png';
import junieIcon from '@/assets/images/junie-color.png';
import kilocodeIcon from '@/assets/images/kilocode.png';
import kimiIcon from '@/assets/images/kimi.png';
import kiroIcon from '@/assets/images/kiro.png';
import mistralIcon from '@/assets/images/mistral.png';
import openaiIcon from '@/assets/images/openai.svg?raw';
import opencodeIcon from '@/assets/images/opencode.png';
import piIcon from '@/assets/images/pi.png';
import qwenIcon from '@/assets/images/qwen.png';
import { AGENT_PROVIDERS, type AgentProviderId } from '@shared/agent-provider-registry';

export type UiAgent = AgentProviderId;

const ICONS: Record<string, string> = {
  'Auggie.svg': augmentcodeIcon,
  'qwen.png': qwenIcon,
  'charm.png': charmIcon,
  'opencode.png': opencodeIcon,
  'ampcode.png': ampcodeIcon,
  'openai.svg': openaiIcon,
  'claude.png': claudeIcon,
  'droid.svg': factorydroidIcon,
  'gemini.png': geminiIcon,
  'cursor.svg': cursorlogoIcon,
  'gh-copilot.svg': ghcopilotIcon,
  'goose.png': gooseIcon,
  'junie-color.png': junieIcon,
  'kimi.png': kimiIcon,
  'kilocode.png': kilocodeIcon,
  'kiro.png': kiroIcon,
  'atlassian.png': atlassianIcon,
  'cline.png': clineIcon,
  'continue.png': continueIcon,
  'codebuff.png': codebuffIcon,
  'mistral.png': mistralIcon,
  'pi.png': piIcon,
  'autohand.svg': autohandIcon,
};

export type AgentMeta = {
  label: string;
  icon?: string;
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
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  useKeystrokeInjection?: boolean;
};

export const agentMeta: Record<UiAgent, AgentMeta> = Object.fromEntries(
  AGENT_PROVIDERS.map((p) => [
    p.id,
    {
      label: p.name,
      icon: p.icon ? ICONS[p.icon] : undefined,
      isSvg: p.icon ? p.icon.endsWith('.svg') : undefined,
      invertInDark: p.invertInDark,
      alt: p.alt,
      terminalOnly: p.terminalOnly ?? true,
      cli: p.cli,
      planActivate: p.planActivateCommand,
      autoStartCommand: p.autoStartCommand,
      autoApproveFlag: p.autoApproveFlag,
      initialPromptFlag: p.initialPromptFlag,
      useKeystrokeInjection: p.useKeystrokeInjection,
    },
  ])
) as Record<UiAgent, AgentMeta>;
