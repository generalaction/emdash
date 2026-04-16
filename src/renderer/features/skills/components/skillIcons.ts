const skillSvgs = import.meta.glob<string>('../../assets/images/skills/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const mcpSvgs = import.meta.glob<string>('../../assets/images/mcp/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const svgByName: Record<string, string> = {};
for (const [path, raw] of [...Object.entries(skillSvgs), ...Object.entries(mcpSvgs)]) {
  svgByName[path.split('/').pop()!.replace('.svg', '')] = raw;
}

const skillToIcon: Record<string, string> = {
  // OpenAI curated skills
  'cloudflare-deploy': 'cloudflare',
  figma: 'figma',
  'figma-implement-design': 'figma',
  'gh-address-comments': 'github',
  'gh-fix-ci': 'github',
  'jupyter-notebook': 'jupyter',
  linear: 'linear',
  'netlify-deploy': 'netlify',
  'notion-knowledge-capture': 'notion',
  'notion-meeting-intelligence': 'notion',
  'notion-research-documentation': 'notion',
  'notion-spec-to-implementation': 'notion',
  playwright: 'playwright',
  'render-deploy': 'render',
  sentry: 'sentry',
  'vercel-deploy': 'vercel',
  yeet: 'github',

  // OpenAI generic skills
  'openai-docs': 'openai',
  sora: 'openai',
  imagegen: 'openai',
  'skill-creator': 'openai',
  'skill-installer': 'openai',

  // Commonly installed skills
  cloudflare: 'cloudflare',
  'durable-objects': 'cloudflare',
  wrangler: 'cloudflare',
  'ai-sdk': 'vercel',
  'vercel-react-best-practices': 'vercel',
  'gh-issue-fix-flow': 'github',
  shadcn: 'shadcn',
  mysql: 'mysql',
  postgres: 'postgresql',
  'react-doctor': 'react',
  'react-email': 'react',
  resend: 'resend',
  'resend-design-skills': 'resend',
  'resend-brand': 'resend',
  elysiajs: 'bun',
  'frontend-design': 'anthropic',
  'webapp-testing': 'anthropic',
  'web-artifacts-builder': 'anthropic',
  'mcp-builder': 'anthropic',
  'algorithmic-art': 'anthropic',
  'canvas-design': 'anthropic',
  'theme-factory': 'anthropic',
  'brand-guidelines': 'anthropic',
  'doc-coauthoring': 'anthropic',
  'internal-comms': 'anthropic',
  stripe: 'stripe',
  slack: 'slack',
  notion: 'notion',
  netlify: 'netlify',
};

const keywordRules: Array<{ test: (id: string) => boolean; icon: string }> = [
  { test: (id) => /^swiftui[-_]/.test(id) || id === 'swift-concurrency-expert', icon: 'swift' },
  { test: (id) => /\b(ios|xcode)\b/.test(id) || id.startsWith('ios-'), icon: 'xcode' },
  {
    test: (id) => /\b(macos|app-store|appstore)\b/.test(id) || id.startsWith('macos-'),
    icon: 'apple',
  },
  { test: (id) => id.startsWith('gh-') || id.includes('github'), icon: 'github' },
  { test: (id) => id.includes('cloudflare') || id.includes('worker'), icon: 'cloudflare' },
  {
    test: (id) => id.includes('vercel') || id.includes('nextjs') || id.includes('next-js'),
    icon: 'vercel',
  },
  { test: (id) => id.startsWith('react-') || id.startsWith('react:'), icon: 'react' },
  { test: (id) => id.includes('notion'), icon: 'notion' },
  { test: (id) => id.includes('figma'), icon: 'figma' },
  { test: (id) => id.includes('sentry'), icon: 'sentry' },
  { test: (id) => id.includes('linear'), icon: 'linear' },
  { test: (id) => id.includes('stripe'), icon: 'stripe' },
  { test: (id) => id.includes('resend'), icon: 'resend' },
  { test: (id) => id.includes('postgres') || id.includes('postgresql'), icon: 'postgresql' },
  { test: (id) => id.includes('mysql'), icon: 'mysql' },
  { test: (id) => id.includes('playwright'), icon: 'playwright' },
];

const sourceIcons: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
};

export function resolveSkillIcon(skillId: string, source: string): string | undefined {
  const name =
    skillToIcon[skillId] ?? keywordRules.find((r) => r.test(skillId))?.icon ?? sourceIcons[source];
  return name ? svgByName[name] : undefined;
}

/**
 * Remote Simple-Icons CDN fallback.
 * Maps a skill id to a simple-icons slug (https://simpleicons.org). Returns a
 * URL rendered in the given hex color (without `#`).
 *
 * This is a lighter-touch fallback used before the GitHub-owner avatar so that
 * known technologies (convex, supabase, tailwind, etc.) get a recognizable
 * brand mark even if we don't bundle the SVG locally.
 */
const remoteIconMap: Array<{ test: (id: string, owner?: string) => boolean; slug: string }> = [
  // owner-based
  { test: (_id, o) => o === 'get-convex' || _id.includes('convex'), slug: 'convex' },
  { test: (_id, o) => o === 'supabase' || _id.includes('supabase'), slug: 'supabase' },
  { test: (_id, o) => o === 'prisma' || _id.includes('prisma'), slug: 'prisma' },
  { test: (_id, o) => o === 'clerk' || _id.includes('clerk'), slug: 'clerk' },
  { test: (_id, o) => o === 'auth0' || _id.includes('auth0'), slug: 'auth0' },
  { test: (_id, o) => o === 'planetscale' || _id.includes('planetscale'), slug: 'planetscale' },
  { test: (_id, o) => o === 'sanity-io' || _id.includes('sanity'), slug: 'sanity' },
  { test: (_id, o) => o === 'posthog' || _id.includes('posthog'), slug: 'posthog' },
  { test: (_id, o) => o === 'discord' || _id.includes('discord'), slug: 'discord' },
  // tech keywords
  { test: (id) => id.includes('tailwind'), slug: 'tailwindcss' },
  { test: (id) => id.includes('drizzle'), slug: 'drizzle' },
  { test: (id) => id.includes('svelte'), slug: 'svelte' },
  { test: (id) => id.includes('vue'), slug: 'vuedotjs' },
  { test: (id) => id.includes('astro'), slug: 'astro' },
  { test: (id) => id.includes('remix'), slug: 'remix' },
  { test: (id) => id.includes('typescript') || id.includes('ts-'), slug: 'typescript' },
  {
    test: (id) => id.includes('python') || id.includes('django') || id.includes('flask'),
    slug: 'python',
  },
  { test: (id) => id.includes('rust'), slug: 'rust' },
  { test: (id) => /(^|[-_])go(lang)?([-_]|$)/.test(id), slug: 'go' },
  { test: (id) => id.includes('docker'), slug: 'docker' },
  { test: (id) => id.includes('kubernetes') || id.includes('k8s'), slug: 'kubernetes' },
  { test: (id) => id.includes('aws') || id.includes('amazon-web'), slug: 'amazonwebservices' },
  { test: (id) => id.includes('azure'), slug: 'microsoftazure' },
  { test: (id) => id.includes('gcp') || id.includes('google-cloud'), slug: 'googlecloud' },
  { test: (id) => id.includes('firebase'), slug: 'firebase' },
  { test: (id) => id.includes('mongo'), slug: 'mongodb' },
  { test: (id) => id.includes('redis'), slug: 'redis' },
  { test: (id) => id.includes('graphql'), slug: 'graphql' },
  { test: (id) => id.includes('prisma'), slug: 'prisma' },
  { test: (id) => id.includes('expo') || id.includes('react-native'), slug: 'expo' },
  { test: (id) => id.includes('nestjs') || id.includes('nest-'), slug: 'nestjs' },
  { test: (id) => id.includes('fastify'), slug: 'fastify' },
  { test: (id) => id.includes('hono'), slug: 'hono' },
  { test: (id) => id.includes('elysia') || id.includes('bun'), slug: 'bun' },
  { test: (id) => id.includes('gitlab'), slug: 'gitlab' },
  { test: (id) => id.includes('slack'), slug: 'slack' },
  { test: (id) => id.includes('discord'), slug: 'discord' },
  { test: (id) => id.includes('twilio'), slug: 'twilio' },
  { test: (id) => id.includes('better-auth'), slug: 'auth0' },
  {
    test: (id) => id.includes('nextjs') || id.includes('next-js') || id.includes('next-'),
    slug: 'nextdotjs',
  },
];

export function resolveRemoteSkillIcon(
  skillId: string,
  color: string,
  owner?: string
): string | undefined {
  const rule = remoteIconMap.find((r) => r.test(skillId, owner));
  if (!rule) return undefined;
  const hex = color.replace(/^#/, '');
  return `https://cdn.simpleicons.org/${rule.slug}/${hex}`;
}
