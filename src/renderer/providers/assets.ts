import openaiLogo from '../../assets/images/openai.png';
import claudeLogo from '../../assets/images/claude.png';
import factoryLogo from '../../assets/images/factorydroid.png';
import geminiLogo from '../../assets/images/gemini.png';
import cursorLogo from '../../assets/images/cursorlogo.png';
import copilotLogo from '../../assets/images/ghcopilot.png';
import ampLogo from '../../assets/images/ampcode.png';
import opencodeLogo from '../../assets/images/opencode.png';
import charmLogo from '../../assets/images/charm.png';
import qwenLogo from '../../assets/images/qwen.png';
import augmentLogo from '../../assets/images/augmentcode.png';
import type { UiProvider } from './meta';

export type ProviderAsset = { logo: string; alt: string; invertInDark?: boolean; name: string };

export const providerAssets: Record<UiProvider, ProviderAsset> = {
  codex: { name: 'Codex', logo: openaiLogo, alt: 'Codex', invertInDark: true },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code CLI' },
  claude: { name: 'Claude Code', logo: claudeLogo, alt: 'Claude Code' },
  droid: { name: 'Droid', logo: factoryLogo, alt: 'Factory Droid', invertInDark: true },
  gemini: { name: 'Gemini', logo: geminiLogo, alt: 'Gemini CLI' },
  cursor: { name: 'Cursor', logo: cursorLogo, alt: 'Cursor CLI', invertInDark: true },
  copilot: { name: 'Copilot', logo: copilotLogo, alt: 'GitHub Copilot CLI', invertInDark: true },
  amp: { name: 'Amp', logo: ampLogo, alt: 'Amp CLI' },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode CLI', invertInDark: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm CLI' },
  auggie: { name: 'Auggie', logo: augmentLogo, alt: 'Auggie CLI' },
};
