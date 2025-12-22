import { PROVIDERS, type ProviderId } from '@shared/providers/registry';

import augmentcodeIcon from '../../assets/images/augmentcode.png';
import qwenIcon from '../../assets/images/qwen.png';
import charmIcon from '../../assets/images/charm.png';
import opencodeIcon from '../../assets/images/opencode.png';
import ampcodeIcon from '../../assets/images/ampcode.png';
import openaiIcon from '../../assets/images/openai.png';
import claudeIcon from '../../assets/images/claude.png';
import factorydroidIcon from '../../assets/images/factorydroid.png';
import geminiIcon from '../../assets/images/gemini.png';
import cursorlogoIcon from '../../assets/images/cursorlogo.png';
import ghcopilotIcon from '../../assets/images/ghcopilot.png';
import gooseIcon from '../../assets/images/goose.png';
import kimiIcon from '../../assets/images/kimi.png';
import kilocodeIcon from '../../assets/images/kilocode.png';
import kiroIcon from '../../assets/images/kiro.png';
import atlassianIcon from '../../assets/images/atlassian.png';
import clineIcon from '../../assets/images/cline.png';
import codebuffIcon from '../../assets/images/codebuff.png';
import mistralIcon from '../../assets/images/mistral.png';

export type UiProvider = ProviderId;

const ICONS: Record<string, string> = {
  'augmentcode.png': augmentcodeIcon,
  'qwen.png': qwenIcon,
  'charm.png': charmIcon,
  'opencode.png': opencodeIcon,
  'ampcode.png': ampcodeIcon,
  'openai.png': openaiIcon,
  'claude.png': claudeIcon,
  'factorydroid.png': factorydroidIcon,
  'gemini.png': geminiIcon,
  'cursorlogo.png': cursorlogoIcon,
  'ghcopilot.png': ghcopilotIcon,
  'goose.png': gooseIcon,
  'kimi.png': kimiIcon,
  'kilocode.png': kilocodeIcon,
  'kiro.png': kiroIcon,
  'atlassian.png': atlassianIcon,
  'cline.png': clineIcon,
  'codebuff.png': codebuffIcon,
  'mistral.png': mistralIcon,
};

export type ProviderMeta = {
  label: string;
  icon?: string;
  terminalOnly: boolean;
  cli?: string;
  planActivate?: string;
  autoStartCommand?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
};

export const providerMeta: Record<UiProvider, ProviderMeta> = Object.fromEntries(
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
    },
  ])
) as Record<UiProvider, ProviderMeta>;
