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
import stripeSvg from '../../assets/images/mcp/stripe.svg?raw';
import slackSvg from '../../assets/images/mcp/slack.svg?raw';

// Source provider icons
import openaiSvg from '../../assets/images/skills/openai.svg?raw';
import anthropicSvg from '../../assets/images/skills/anthropic.svg?raw';

// Specific skill icons
import githubSvg from '../../assets/images/skills/github.svg?raw';
import jupyterSvg from '../../assets/images/skills/jupyter.svg?raw';
import renderSvg from '../../assets/images/skills/render.svg?raw';
import swiftSvg from '../../assets/images/skills/swift.svg?raw';
import appleSvg from '../../assets/images/skills/apple.svg?raw';
import mysqlSvg from '../../assets/images/skills/mysql.svg?raw';
import postgresqlSvg from '../../assets/images/skills/postgresql.svg?raw';
import reactSvg from '../../assets/images/skills/react.svg?raw';
import shadcnSvg from '../../assets/images/skills/shadcn.svg?raw';
import resendSvg from '../../assets/images/skills/resend.svg?raw';
import bunSvg from '../../assets/images/skills/bun.svg?raw';
import xcodeSvg from '../../assets/images/skills/xcode.svg?raw';

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
 * When a skill ID isn't found here, we try keyword matching via
 * `resolveSkillIcon`, then fall back to source icons or letter.
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

  // ── Commonly installed local/skills.sh skills ──────────────────────
  cloudflare: { type: 'svg', data: cloudflareSvg, color: 'F38020' },
  'durable-objects': { type: 'svg', data: cloudflareSvg, color: 'F38020' },
  wrangler: { type: 'svg', data: cloudflareSvg, color: 'F38020' },
  'ai-sdk': { type: 'svg', data: vercelSvg, color: '000000' },
  'vercel-react-best-practices': { type: 'svg', data: vercelSvg, color: '000000' },
  'gh-issue-fix-flow': { type: 'svg', data: githubSvg, color: '181717' },
  shadcn: { type: 'svg', data: shadcnSvg, color: '000000' },
  mysql: { type: 'svg', data: mysqlSvg, color: '4479A1' },
  postgres: { type: 'svg', data: postgresqlSvg, color: '4169E1' },
  'react-doctor': { type: 'svg', data: reactSvg, color: '61DAFB' },
  'react-email': { type: 'svg', data: reactSvg, color: '61DAFB' },
  resend: { type: 'svg', data: resendSvg, color: '000000' },
  'resend-design-skills': { type: 'svg', data: resendSvg, color: '000000' },
  'resend-brand': { type: 'svg', data: resendSvg, color: '000000' },
  elysiajs: { type: 'svg', data: bunSvg, color: 'FBF0DF' },
  'frontend-design': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'webapp-testing': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'web-artifacts-builder': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'mcp-builder': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'algorithmic-art': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'canvas-design': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'theme-factory': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'brand-guidelines': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'doc-coauthoring': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  'internal-comms': { type: 'svg', data: anthropicSvg, color: 'D4A574' },
  stripe: { type: 'svg', data: stripeSvg, color: '635BFF' },
  slack: { type: 'svg', data: slackSvg, color: '4A154B' },
  notion: { type: 'svg', data: notionSvg, color: '000000' },
  netlify: { type: 'svg', data: netlifySvg, color: '00C7B7' },
};

/**
 * Source-level fallback icons (used when skill ID isn't in skillIconMap).
 */
export const skillSourceIcons: Record<string, SkillIconDef> = {
  openai: { type: 'svg', data: openaiSvg, color: '412991' },
  anthropic: { type: 'svg', data: anthropicSvg, color: 'D4A574' },
};

/**
 * Keyword-based icon matching for locally installed skills not in the map.
 * Checked in order — first match wins.
 */
const keywordRules: Array<{ test: (id: string) => boolean; icon: SkillIconDef }> = [
  // Apple / Swift / iOS / macOS ecosystem
  {
    test: (id) => /^swiftui[-_]/.test(id) || id === 'swift-concurrency-expert',
    icon: { type: 'svg', data: swiftSvg, color: 'F05138' },
  },
  {
    test: (id) => /\b(ios|xcode)\b/.test(id) || id.startsWith('ios-'),
    icon: { type: 'svg', data: xcodeSvg, color: '147EFB' },
  },
  {
    test: (id) => /\b(macos|app-store|appstore)\b/.test(id) || id.startsWith('macos-'),
    icon: { type: 'svg', data: appleSvg, color: '000000' },
  },
  // GitHub
  {
    test: (id) => id.startsWith('gh-') || id.includes('github'),
    icon: { type: 'svg', data: githubSvg, color: '181717' },
  },
  // Cloudflare ecosystem
  {
    test: (id) => id.includes('cloudflare') || id.includes('worker'),
    icon: { type: 'svg', data: cloudflareSvg, color: 'F38020' },
  },
  // Vercel / Next.js
  {
    test: (id) => id.includes('vercel') || id.includes('nextjs') || id.includes('next-js'),
    icon: { type: 'svg', data: vercelSvg, color: '000000' },
  },
  // React ecosystem
  {
    test: (id) => id.startsWith('react-') || id.startsWith('react:'),
    icon: { type: 'svg', data: reactSvg, color: '61DAFB' },
  },
  // Notion
  {
    test: (id) => id.includes('notion'),
    icon: { type: 'svg', data: notionSvg, color: '000000' },
  },
  // Figma
  {
    test: (id) => id.includes('figma'),
    icon: { type: 'svg', data: figmaSvg, color: 'F24E1E' },
  },
  // Sentry
  {
    test: (id) => id.includes('sentry'),
    icon: { type: 'svg', data: sentrySvg, color: '362D59' },
  },
  // Linear
  {
    test: (id) => id.includes('linear'),
    icon: { type: 'svg', data: linearSvg, color: '5E6AD2' },
  },
  // Stripe
  {
    test: (id) => id.includes('stripe'),
    icon: { type: 'svg', data: stripeSvg, color: '635BFF' },
  },
  // Resend
  {
    test: (id) => id.includes('resend'),
    icon: { type: 'svg', data: resendSvg, color: '000000' },
  },
  // PostgreSQL
  {
    test: (id) => id.includes('postgres') || id.includes('postgresql'),
    icon: { type: 'svg', data: postgresqlSvg, color: '4169E1' },
  },
  // MySQL
  {
    test: (id) => id.includes('mysql'),
    icon: { type: 'svg', data: mysqlSvg, color: '4479A1' },
  },
  // Playwright
  {
    test: (id) => id.includes('playwright'),
    icon: { type: 'svg', data: playwrightSvg, color: '2EAD33' },
  },
];

/**
 * Resolve a skill's bundled icon. Tries exact ID match first,
 * then keyword-based matching, then source-level fallback.
 */
export function resolveSkillIcon(skillId: string, source: string): SkillIconDef | undefined {
  return (
    skillIconMap[skillId] ??
    keywordRules.find((r) => r.test(skillId))?.icon ??
    skillSourceIcons[source]
  );
}
