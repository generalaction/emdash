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
import type { UiAgent } from './meta';

export type AgentAsset = {
  logo: string;
  alt: string;
  invertInDark?: boolean;
  name: string;
  isSvg?: boolean;
};

export const agentAssets: Record<UiAgent, AgentAsset> = {
  codex: { name: 'OpenAI', logo: openaiLogoSvg, alt: 'Codex', isSvg: true },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code CLI' },
  claude: { name: 'Anthropic', logo: claudeLogo, alt: 'Claude Code' },
  droid: { name: 'Factory AI', logo: factoryLogoSvg, alt: 'Factory Droid', isSvg: true },
  gemini: { name: 'Google', logo: geminiLogo, alt: 'Gemini CLI' },
  cursor: { name: 'Cursor', logo: cursorLogoSvg, alt: 'Cursor CLI', isSvg: true },
  copilot: { name: 'GitHub', logo: copilotLogoSvg, alt: 'GitHub Copilot CLI', isSvg: true },
  amp: { name: 'Sourcegraph', logo: ampLogo, alt: 'Amp CLI' },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode CLI', invertInDark: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm CLI' },
  auggie: { name: 'Augment Code', logo: augmentLogoSvg, alt: 'Auggie CLI', isSvg: true },
  goose: { name: 'Goose', logo: gooseLogo, alt: 'Goose CLI' },
  kimi: { name: 'Moonshot AI', logo: kimiLogo, alt: 'Kimi CLI' },
  kilocode: { name: 'Kilo AI', logo: kilocodeLogo, alt: 'Kilocode CLI' },
  kiro: { name: 'Amazon Web Services', logo: kiroLogo, alt: 'Kiro CLI' },
  rovo: { name: 'Atlassian', logo: atlassianLogo, alt: 'Rovo Dev CLI' },
  cline: { name: 'Cline', logo: clineLogo, alt: 'Cline CLI' },
  continue: { name: 'Continue', logo: continueLogo, alt: 'Continue CLI' },
  codebuff: { name: 'Codebuff', logo: codebuffLogo, alt: 'Codebuff CLI' },
  mistral: { name: 'Mistral AI', logo: mistralLogo, alt: 'Mistral Vibe CLI' },
  pi: { name: 'Pi', logo: piLogo, alt: 'Pi CLI' },
};
