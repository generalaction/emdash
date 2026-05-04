import { type AgentProviderId } from '@shared/agent-provider-registry';
import ampLogo from '../../assets/images/ampcode.png';
import atlassianLogo from '../../assets/images/atlassian.png';
import augmentLogoSvg from '../../assets/images/Auggie.svg?raw';
import autohandLogoSvg from '../../assets/images/autohand.svg?raw';
import charmLogo from '../../assets/images/charm.png';
import claudeLogo from '../../assets/images/claude.png';
import clineLogo from '../../assets/images/cline.png';
import codebuffLogo from '../../assets/images/codebuff.png';
import continueLogo from '../../assets/images/continue.png';
import cursorLogoSvg from '../../assets/images/cursor.svg?raw';
import devinLogo from '../../assets/images/devin.png';
import factoryLogoSvg from '../../assets/images/droid.svg?raw';
import geminiLogo from '../../assets/images/gemini.png';
import copilotLogoSvg from '../../assets/images/gh-copilot.svg?raw';
import gooseLogo from '../../assets/images/goose.png';
import hermesLogo from '../../assets/images/hermesagent.jpg';
import junieLogo from '../../assets/images/junie-color.png';
import kilocodeLogo from '../../assets/images/kilocode.png';
import kimiLogo from '../../assets/images/kimi.png';
import kiroLogo from '../../assets/images/kiro.png';
import mistralLogo from '../../assets/images/mistral.png';
import openaiLogoSvg from '../../assets/images/openai.svg?raw';
import opencodeLogo from '../../assets/images/opencode.png';
import piLogo from '../../assets/images/pi.png';
import qwenLogo from '../../assets/images/qwen.png';

export type AgentInfo = {
  name: string;
  logo: string;
  alt: string;
  invertInDark?: boolean;
  isSvg?: boolean;
};

// Agents with initial prompt support first, then those without
export const agentConfig: Record<AgentProviderId, AgentInfo> = {
  claude: { name: 'Claude Code', logo: claudeLogo, alt: 'Claude Code' },
  codex: { name: 'Codex', logo: openaiLogoSvg, alt: 'Codex', isSvg: true },
  devin: { name: 'Devin', logo: devinLogo, alt: 'Devin' },
  cursor: { name: 'Cursor', logo: cursorLogoSvg, alt: 'Cursor CLI', isSvg: true },
  gemini: { name: 'Gemini', logo: geminiLogo, alt: 'Gemini CLI' },
  mistral: { name: 'Mistral Vibe', logo: mistralLogo, alt: 'Mistral Vibe CLI' },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code' },
  droid: { name: 'Droid', logo: factoryLogoSvg, alt: 'Factory Droid', isSvg: true },
  pi: { name: 'Pi', logo: piLogo, alt: 'Pi CLI' },
  autohand: { name: 'Autohand Code', logo: autohandLogoSvg, alt: 'Autohand Code CLI', isSvg: true },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode', invertInDark: true },
  hermes: { name: 'Hermes Agent', logo: hermesLogo, alt: 'Hermes Agent CLI' },
  auggie: { name: 'Auggie', logo: augmentLogoSvg, alt: 'Auggie CLI', isSvg: true },
  goose: { name: 'Goose', logo: gooseLogo, alt: 'Goose CLI' },
  kimi: { name: 'Kimi', logo: kimiLogo, alt: 'Kimi CLI' },
  kilocode: { name: 'Kilocode', logo: kilocodeLogo, alt: 'Kilocode CLI' },
  kiro: { name: 'Kiro', logo: kiroLogo, alt: 'Kiro CLI' },
  cline: { name: 'Cline', logo: clineLogo, alt: 'Cline CLI' },
  continue: { name: 'Continue', logo: continueLogo, alt: 'Continue CLI' },
  codebuff: { name: 'Codebuff', logo: codebuffLogo, alt: 'Codebuff CLI' },
  junie: {
    name: 'Junie CLI',
    logo: junieLogo,
    alt: 'Junie CLI',
  },
  amp: { name: 'Amp', logo: ampLogo, alt: 'Amp Code' },
  // Without initial prompt support
  copilot: { name: 'Copilot', logo: copilotLogoSvg, alt: 'GitHub Copilot CLI', isSvg: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm Crush', invertInDark: true },
  rovo: { name: 'Rovo Dev', logo: atlassianLogo, alt: 'Rovo Dev' },
};
