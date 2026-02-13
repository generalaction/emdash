import type { Agent } from '../types';
import openaiLogoSvg from '../../assets/images/openai.svg?raw';
import kiroLogo from '../../assets/images/kiro.png';
import claudeLogo from '../../assets/images/claude.png';
import factoryLogoSvg from '../../assets/images/droid.svg?raw';
import geminiLogo from '../../assets/images/gemini.png';
import cursorLogoSvg from '../../assets/images/cursor.svg?raw';
import copilotLogoSvg from '../../assets/images/gh-copilot.svg?raw';
import ampLogo from '../../assets/images/ampcode.png';
import opencodeLogo from '../../assets/images/opencode.png';
import charmLogo from '../../assets/images/charm.png';
import qwenLogo from '../../assets/images/qwen.png';
import augmentLogoSvg from '../../assets/images/Auggie.svg?raw';
import gooseLogo from '../../assets/images/goose.png';
import kimiLogo from '../../assets/images/kimi.png';
import kilocodeLogo from '../../assets/images/kilocode.png';
import atlassianLogo from '../../assets/images/atlassian.png';
import clineLogo from '../../assets/images/cline.png';
import continueLogo from '../../assets/images/continue.png';
import codebuffLogo from '../../assets/images/codebuff.png';
import mistralLogo from '../../assets/images/mistral.png';
import piLogo from '../../assets/images/pi.png';

export type AgentInfo = {
  name: string;
  logo: string;
  alt: string;
  invertInDark?: boolean;
  isSvg?: boolean;
};

// Agents with initial prompt support first, then those without
export const agentConfig: Record<Agent, AgentInfo> = {
  claude: { name: 'Claude Code', logo: claudeLogo, alt: 'Claude Code' },
  codex: { name: 'Codex', logo: openaiLogoSvg, alt: 'Codex', isSvg: true },
  cursor: { name: 'Cursor', logo: cursorLogoSvg, alt: 'Cursor CLI', isSvg: true },
  gemini: { name: 'Gemini', logo: geminiLogo, alt: 'Gemini CLI' },
  mistral: { name: 'Mistral Vibe', logo: mistralLogo, alt: 'Mistral Vibe CLI' },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code' },
  droid: { name: 'Droid', logo: factoryLogoSvg, alt: 'Factory Droid', isSvg: true },
  pi: { name: 'Pi', logo: piLogo, alt: 'Pi CLI' },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode', invertInDark: true },
  auggie: { name: 'Auggie', logo: augmentLogoSvg, alt: 'Auggie CLI', isSvg: true },
  goose: { name: 'Goose', logo: gooseLogo, alt: 'Goose CLI' },
  kimi: { name: 'Kimi', logo: kimiLogo, alt: 'Kimi CLI' },
  kilocode: { name: 'Kilocode', logo: kilocodeLogo, alt: 'Kilocode CLI' },
  kiro: { name: 'Kiro', logo: kiroLogo, alt: 'Kiro CLI' },
  cline: { name: 'Cline', logo: clineLogo, alt: 'Cline CLI' },
  continue: { name: 'Continue', logo: continueLogo, alt: 'Continue CLI' },
  codebuff: { name: 'Codebuff', logo: codebuffLogo, alt: 'Codebuff CLI' },
  amp: { name: 'Amp', logo: ampLogo, alt: 'Amp Code' },
  // Without initial prompt support
  copilot: { name: 'Copilot', logo: copilotLogoSvg, alt: 'GitHub Copilot CLI', isSvg: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm Crush', invertInDark: true },
  rovo: { name: 'Rovo Dev', logo: atlassianLogo, alt: 'Rovo Dev' },
};
