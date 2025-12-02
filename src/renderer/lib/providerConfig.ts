import type { Provider } from '../types';
import openaiLogo from '../../assets/images/openai.png';
import kiroLogo from '../../assets/images/kiro.png';
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
import gooseLogo from '../../assets/images/goose.png';
import kimiLogo from '../../assets/images/kimi.png';
import atlassianLogo from '../../assets/images/atlassian.png';
import clineLogo from '../../assets/images/cline.png';
import codebuffLogo from '../../assets/images/codebuff.png';

export type ProviderInfo = {
  name: string;
  logo: string;
  alt: string;
  invertInDark?: boolean;
};

export const providerConfig: Record<Provider, ProviderInfo> = {
  codex: { name: 'Codex', logo: openaiLogo, alt: 'Codex', invertInDark: true },
  claude: { name: 'Claude Code', logo: claudeLogo, alt: 'Claude Code' },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code' },
  cursor: { name: 'Cursor', logo: cursorLogo, alt: 'Cursor CLI', invertInDark: true },
  amp: { name: 'Amp', logo: ampLogo, alt: 'Amp Code' },
  droid: { name: 'Droid', logo: factoryLogo, alt: 'Factory Droid', invertInDark: true },
  cline: { name: 'Cline', logo: clineLogo, alt: 'Cline CLI' },
  gemini: { name: 'Gemini', logo: geminiLogo, alt: 'Gemini CLI' },
  copilot: { name: 'Copilot', logo: copilotLogo, alt: 'GitHub Copilot CLI', invertInDark: true },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode', invertInDark: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm' },
  auggie: { name: 'Auggie', logo: augmentLogo, alt: 'Auggie CLI', invertInDark: true },
  goose: { name: 'Goose', logo: gooseLogo, alt: 'Goose CLI' },
  kimi: { name: 'Kimi', logo: kimiLogo, alt: 'Kimi CLI' },
  kiro: { name: 'Kiro', logo: kiroLogo, alt: 'Kiro CLI' },
  rovo: { name: 'Rovo Dev', logo: atlassianLogo, alt: 'Rovo Dev CLI' },
  codebuff: { name: 'Codebuff', logo: codebuffLogo, alt: 'Codebuff CLI' },
};
