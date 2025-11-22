import { getDocUrlForProvider, getProvider, type ProviderId } from '@shared/providers/registry';

export type UiProvider = ProviderId;

export type ProviderMeta = {
  label: string;
  icon?: string;
  terminalOnly: boolean;
  cli?: string;
  planActivate?: string; // optional provider-specific activation for plan mode
  // Optional command to auto-run in the provider's terminal session
  // once the PTY is ready (used when the provider is launched via a
  // general-purpose shell rather than a dedicated CLI binary).
  autoStartCommand?: string;
  // Optional flag to bypass permission prompts when auto-approve is enabled
  autoApproveFlag?: string;
};

const FALLBACK_LABEL = 'Provider';
const reg = (id: UiProvider) => getProvider(id);

export const providerMeta: Record<UiProvider, ProviderMeta> = {
  auggie: {
    label: reg('auggie')?.name ?? 'Auggie',
    icon: '../../assets/images/augmentcode.png',
    terminalOnly: true,
    cli: 'auggie',
  },
  qwen: {
    label: reg('qwen')?.name ?? 'Qwen Code',
    icon: '../../assets/images/qwen.png',
    terminalOnly: true,
    cli: 'qwen',
    autoApproveFlag: '--yolo',
  },
  charm: {
    label: reg('charm')?.name ?? 'Charm',
    icon: '../../assets/images/charm.png',
    terminalOnly: true,
    cli: 'crush',
  },
  opencode: {
    label: reg('opencode')?.name ?? 'OpenCode',
    icon: '../../assets/images/opencode.png',
    terminalOnly: true,
    cli: 'opencode',
    autoApproveFlag: '-p',
  },
  amp: {
    label: reg('amp')?.name ?? 'Amp',
    icon: '../../assets/images/ampcode.png',
    terminalOnly: true,
    cli: 'amp',
  },
  codex: {
    label: reg('codex')?.name ?? 'Codex',
    icon: '../../assets/images/openai.png',
    terminalOnly: true,
    cli: 'codex',
    autoApproveFlag: '--full-auto',
  },
  claude: {
    label: reg('claude')?.name ?? 'Claude Code',
    icon: '../../assets/images/claude.png',
    terminalOnly: true,
    cli: 'claude',
    planActivate: '/plan',
    autoApproveFlag: '--dangerously-skip-permissions',
  },
  droid: {
    label: reg('droid')?.name ?? 'Droid',
    icon: '../../assets/images/factorydroid.png',
    terminalOnly: true,
    cli: 'droid',
  },
  gemini: {
    label: reg('gemini')?.name ?? 'Gemini',
    icon: '../../assets/images/gemini.png',
    terminalOnly: true,
    cli: 'gemini',
    autoApproveFlag: '--yolomode',
  },
  cursor: {
    label: reg('cursor')?.name ?? 'Cursor',
    icon: '../../assets/images/cursorlogo.png',
    terminalOnly: true,
    cli: 'cursor-agent',
    autoApproveFlag: '-p',
  },
  copilot: {
    label: reg('copilot')?.name ?? 'Copilot',
    icon: '../../assets/images/ghcopilot.png',
    terminalOnly: true,
    cli: 'copilot',
  },
  goose: {
    label: reg('goose')?.name ?? 'Goose',
    icon: '../../assets/images/goose.png',
    terminalOnly: true,
    cli: 'goose',
  },
  kimi: {
    label: reg('kimi')?.name ?? 'Kimi',
    icon: '../../assets/images/kimi.png',
    terminalOnly: true,
    cli: 'kimi',
    planActivate: undefined,
  },
  kiro: {
    label: reg('kiro')?.name ?? 'Kiro (AWS)',
    icon: '../../assets/images/kiro.png',
    terminalOnly: true,
    cli: 'kiro-cli',
  },
  rovo: {
    label: reg('rovo')?.name ?? 'Rovo Dev',
    icon: '../../assets/images/atlassian.png',
    terminalOnly: true,
    autoStartCommand: 'acli rovodev run',
    autoApproveFlag: '--yolo',
  },
};
