// SVG icons for skills (imported as raw strings for inline rendering)
// Brand icons reused from MCP assets
import cloudflareSvg from '../../assets/images/mcp/cloudflare.svg?raw';
import figmaSvg from '../../assets/images/mcp/figma.svg?raw';
import linearSvg from '../../assets/images/mcp/linear.svg?raw';
import netlifySvg from '../../assets/images/mcp/netlify.svg?raw';
import notionSvg from '../../assets/images/mcp/notion.svg?raw';
import playwrightSvg from '../../assets/images/mcp/playwright.svg?raw';
import sentrySvg from '../../assets/images/mcp/sentry.svg?raw';
import vercelSvg from '../../assets/images/mcp/vercel.svg?raw';

// Source provider icons
import openaiSvg from '../../assets/images/skills/openai.svg?raw';
import anthropicSvg from '../../assets/images/skills/anthropic.svg?raw';

// Specific skill icons
import githubSvg from '../../assets/images/skills/github.svg?raw';
import jupyterSvg from '../../assets/images/skills/jupyter.svg?raw';
import renderSvg from '../../assets/images/skills/render.svg?raw';

export interface SkillIconDef {
  type: 'svg';
  data: string;
  /** Brand hex color (without #) for monochrome SVGs */
  color: string;
  /** If true, render the SVG as-is without recoloring (for multi-color logos) */
  preserveColors?: boolean;
}

/**
 * Maps skill catalog IDs to their brand icons.
 * When a skill ID isn't found here, we fall back to source-level icons
 * (openai / anthropic) or the first-letter fallback.
 */
export const skillIconMap: Record<string, SkillIconDef> = {
  // ── OpenAI curated skills with brand icons ─────────────────────────
  'cloudflare-deploy': { type: 'svg', data: cloudflareSvg, color: 'F38020' },
  figma: { type: 'svg', data: figmaSvg, color: 'F24E1E' },
  'figma-implement-design': { type: 'svg', data: figmaSvg, color: 'F24E1E' },
  'gh-address-comments': { type: 'svg', data: githubSvg, color: '181717' },
  'gh-fix-ci': { type: 'svg', data: githubSvg, color: '181717' },
  'jupyter-notebook': { type: 'svg', data: jupyterSvg, color: 'F37626' },
  linear: { type: 'svg', data: linearSvg, color: '5E6AD2' },
  'netlify-deploy': { type: 'svg', data: netlifySvg, color: '00C7B7' },
  'notion-knowledge-capture': { type: 'svg', data: notionSvg, color: '000000' },
  'notion-meeting-intelligence': { type: 'svg', data: notionSvg, color: '000000' },
  'notion-research-documentation': { type: 'svg', data: notionSvg, color: '000000' },
  'notion-spec-to-implementation': { type: 'svg', data: notionSvg, color: '000000' },
  playwright: { type: 'svg', data: playwrightSvg, color: '2EAD33' },
  'render-deploy': { type: 'svg', data: renderSvg, color: '46E3B7' },
  sentry: { type: 'svg', data: sentrySvg, color: '362D59' },
  'vercel-deploy': { type: 'svg', data: vercelSvg, color: '000000' },
  yeet: { type: 'svg', data: githubSvg, color: '181717' },

  // ── OpenAI generic skills (use OpenAI logo) ────────────────────────
  'openai-docs': { type: 'svg', data: openaiSvg, color: '412991' },
  sora: { type: 'svg', data: openaiSvg, color: '412991' },
  imagegen: { type: 'svg', data: openaiSvg, color: '412991' },
  'skill-creator': { type: 'svg', data: openaiSvg, color: '412991' },
  'skill-installer': { type: 'svg', data: openaiSvg, color: '412991' },
};

/**
 * Source-level fallback icons (used when skill ID isn't in skillIconMap).
 */
export const skillSourceIcons: Record<string, SkillIconDef> = {
  openai: { type: 'svg', data: openaiSvg, color: '412991' },
  anthropic: { type: 'svg', data: anthropicSvg, color: 'D4A574' },
};
