import { getDocUrlForProvider, getProvider, type ProviderId } from '@shared/providers/registry';

export type UiProvider = ProviderId;

export type ProviderMeta = {
  label: string;
  icon?: string;
  terminalOnly: boolean;
  cli?: string;
  helpUrl?: string;
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
    helpUrl: getDocUrlForProvider('auggie') ?? 'https://docs.augmentcode.com/cli/overview',
  },
  qwen: {
    label: reg('qwen')?.name ?? 'Qwen Code',
    icon: '../../assets/images/qwen.png',
    terminalOnly: true,
    cli: 'qwen',
    helpUrl: getDocUrlForProvider('qwen') ?? 'https://github.com/QwenLM/qwen-code',
    autoApproveFlag: '--yolo',
  },
  charm: {
    label: reg('charm')?.name ?? 'Charm',
    icon: '../../assets/images/charm.png',
    terminalOnly: true,
    cli: 'crush',
    helpUrl: getDocUrlForProvider('charm') ?? 'https://github.com/charmbracelet/crush',
  },
  opencode: {
    label: reg('opencode')?.name ?? 'OpenCode',
    icon: '../../assets/images/opencode.png',
    terminalOnly: true,
    cli: 'opencode',
    helpUrl: getDocUrlForProvider('opencode') ?? 'https://opencode.ai/docs/cli/',
    autoApproveFlag: '-p',
  },
  amp: {
    label: reg('amp')?.name ?? 'Amp',
    icon: '../../assets/images/ampcode.png',
    terminalOnly: true,
    cli: 'amp',
    helpUrl: getDocUrlForProvider('amp') ?? 'https://ampcode.com/manual#install',
  },
  codex: {
    label: reg('codex')?.name ?? 'Codex',
    icon: '../../assets/images/openai.png',
    terminalOnly: true,
    cli: 'codex',
    helpUrl: getDocUrlForProvider('codex') ?? 'https://developers.openai.com/codex/quickstart',
    autoApproveFlag: '--full-auto',
  },
  claude: {
    label: reg('claude')?.name ?? 'Claude Code',
    icon: '../../assets/images/claude.png',
    terminalOnly: true,
    cli: 'claude',
    helpUrl:
      getDocUrlForProvider('claude') ?? 'https://docs.claude.com/en/docs/claude-code/quickstart',
    planActivate: '/plan',
    autoApproveFlag: '--dangerously-skip-permissions',
  },
  droid: {
    label: reg('droid')?.name ?? 'Droid',
    icon: '../../assets/images/factorydroid.png',
    terminalOnly: true,
    cli: 'droid',
    helpUrl:
      getDocUrlForProvider('droid') ?? 'https://docs.factory.ai/cli/getting-started/quickstart',
  },
  gemini: {
    label: reg('gemini')?.name ?? 'Gemini',
    icon: '../../assets/images/gemini.png',
    terminalOnly: true,
    cli: 'gemini',
    helpUrl: getDocUrlForProvider('gemini') ?? 'https://github.com/google-gemini/gemini-cli',
    autoApproveFlag: '--yolomode',
  },
  cursor: {
    label: reg('cursor')?.name ?? 'Cursor',
    icon: '../../assets/images/cursorlogo.png',
    terminalOnly: true,
    cli: 'cursor-agent',
    helpUrl: getDocUrlForProvider('cursor') ?? 'https://cursor.com/install',
    autoApproveFlag: '-p',
  },
  copilot: {
    label: reg('copilot')?.name ?? 'Copilot',
    icon: '../../assets/images/ghcopilot.png',
    terminalOnly: true,
    cli: 'copilot',
    helpUrl:
      getDocUrlForProvider('copilot') ??
      'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  },
  goose: {
    label: reg('goose')?.name ?? 'Goose',
    icon: '../../assets/images/goose.png',
    terminalOnly: true,
    cli: 'goose',
    helpUrl: getDocUrlForProvider('goose') ?? 'https://block.github.io/goose/docs/quickstart/',
  },
  kimi: {
    label: reg('kimi')?.name ?? 'Kimi',
    icon: '../../assets/images/kimi.png',
    terminalOnly: true,
    cli: 'kimi',
    helpUrl:
      getDocUrlForProvider('kimi') ?? 'https://www.kimi.com/coding/docs/en/kimi-cli.html',
    planActivate: undefined,
  },
  kiro: {
    label: reg('kiro')?.name ?? 'Kiro (AWS)',
    icon: '../../assets/images/kiro.png',
    terminalOnly: true,
    cli: 'kiro-cli',
    helpUrl: getDocUrlForProvider('kiro') ?? 'https://kiro.dev/docs/cli/',
  },
  rovo: {
    label: reg('rovo')?.name ?? 'Rovo Dev',
    icon: '../../assets/images/atlassian.png',
    terminalOnly: true,
    helpUrl:
      getDocUrlForProvider('rovo') ??
      'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
    autoStartCommand: 'acli rovodev run',
    autoApproveFlag: '--yolo',
  },
};
