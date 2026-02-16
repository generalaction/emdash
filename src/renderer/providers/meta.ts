import { PROVIDERS, type ProviderId } from '@shared/providers/registry';

import augmentcodeIcon from '../../assets/images/Auggie.svg?raw';
import qwenIcon from '../../assets/images/qwen.png';
import charmIcon from '../../assets/images/charm.png';
import opencodeIcon from '../../assets/images/opencode.png';
import ampcodeIcon from '../../assets/images/ampcode.png';
import openaiIcon from '../../assets/images/openai.svg?raw';
import claudeIcon from '../../assets/images/claude.png';
import factorydroidIcon from '../../assets/images/droid.svg?raw';
import geminiIcon from '../../assets/images/gemini.png';
import cursorlogoIcon from '../../assets/images/cursor.svg?raw';
import ghcopilotIcon from '../../assets/images/gh-copilot.svg?raw';
import gooseIcon from '../../assets/images/goose.png';
import kimiIcon from '../../assets/images/kimi.png';
import kilocodeIcon from '../../assets/images/kilocode.png';
import kiroIcon from '../../assets/images/kiro.png';
import atlassianIcon from '../../assets/images/atlassian.png';
import clineIcon from '../../assets/images/cline.png';
import continueIcon from '../../assets/images/continue.png';
import codebuffIcon from '../../assets/images/codebuff.png';
import mistralIcon from '../../assets/images/mistral.png';
import piIcon from '../../assets/images/pi.png';

export type UiAgent = ProviderId;

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
  'kimi.png': kimiIcon,
  'kilocode.png': kilocodeIcon,
  'kiro.png': kiroIcon,
  'atlassian.png': atlassianIcon,
  'cline.png': clineIcon,
  'continue.png': continueIcon,
  'codebuff.png': codebuffIcon,
  'mistral.png': mistralIcon,
  'pi.png': piIcon,
};

export type AgentMeta = {
  label: string;
  icon?: string;
  terminalOnly: boolean;
  cli?: string;
  planActivate?: string;
  autoStartCommand?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  useKeystrokeInjection?: boolean;
};

export const agentMeta: Record<UiAgent, AgentMeta> = Object.fromEntries(
  PROVIDERS.map((p) => [
    p.id,
    {
      label: p.name,
      icon: p.icon ? ICONS[p.icon] : undefined,
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
