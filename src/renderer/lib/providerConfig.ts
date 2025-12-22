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
import kilocodeLogo from '../../assets/images/kilocode.png';
import atlassianLogo from '../../assets/images/atlassian.png';
import clineLogo from '../../assets/images/cline.png';
import codebuffLogo from '../../assets/images/codebuff.png';
import mistralLogo from '../../assets/images/mistral.png';

export type ProviderInfo = {
  name: string;
  logo: string;
  alt: string;
  invertInDark?: boolean;
};

// Providers with initial prompt support first, then those without
export const providerConfig: Record<Provider, ProviderInfo> = {
  claude: { name: 'Claude Code', logo: claudeLogo, alt: 'Claude Code' },
  codex: { name: 'Codex', logo: openaiLogo, alt: 'Codex', invertInDark: true },
  cursor: { name: 'Cursor', logo: cursorLogo, alt: 'Cursor CLI', invertInDark: true },
  gemini: { name: 'Gemini', logo: geminiLogo, alt: 'Gemini CLI' },
  mistral: { name: 'Mistral Vibe', logo: mistralLogo, alt: 'Mistral Vibe CLI' },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code' },
  droid: { name: 'Droid', logo: factoryLogo, alt: 'Factory Droid', invertInDark: true },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode', invertInDark: true },
  auggie: { name: 'Auggie', logo: augmentLogo, alt: 'Auggie CLI', invertInDark: true },
  goose: { name: 'Goose', logo: gooseLogo, alt: 'Goose CLI' },
  kimi: { name: 'Kimi', logo: kimiLogo, alt: 'Kimi CLI' },
  kilocode: { name: 'Kilocode', logo: kilocodeLogo, alt: 'Kilocode CLI' },
  kiro: { name: 'Kiro', logo: kiroLogo, alt: 'Kiro CLI' },
  cline: { name: 'Cline', logo: clineLogo, alt: 'Cline CLI' },
  codebuff: { name: 'Codebuff', logo: codebuffLogo, alt: 'Codebuff CLI' },
  // Without initial prompt support
  amp: { name: 'Amp', logo: ampLogo, alt: 'Amp Code' },
  copilot: { name: 'Copilot', logo: copilotLogo, alt: 'GitHub Copilot CLI', invertInDark: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm' },
  rovo: { name: 'Rovo Dev', logo: atlassianLogo, alt: 'Rovo Dev CLI' },
};
