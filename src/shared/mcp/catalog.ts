import type { RawServerEntry } from './types';

export interface CredentialKeyDef {
  key: string;
  required: boolean;
}

export interface CatalogEntryDef {
  config: RawServerEntry;
  name: string;
  description: string;
  docsUrl: string;
  credentialKeys: CredentialKeyDef[];
}

export const catalogData: Record<string, CatalogEntryDef> = {
  playwright: {
    config: {
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    },
    name: 'Playwright',
    description: 'Browser automation with Playwright',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    credentialKeys: [],
  },
  context7: {
    config: {
      type: 'http',
      url: 'https://mcp.context7.com/mcp',
      headers: {
        CONTEXT7_API_KEY: 'YOUR_API_KEY',
      },
    },
    name: 'Context7',
    description: 'Fetch up-to-date documentation and code examples',
    docsUrl: 'https://github.com/upstash/context7',
    credentialKeys: [{ key: 'CONTEXT7_API_KEY', required: false }],
  },
  supabase: {
    config: {
      type: 'http',
      url: 'https://mcp.supabase.com/mcp',
    },
    name: 'Supabase',
    description: 'Manage databases, authentication, and storage',
    docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp',
    credentialKeys: [],
  },
  vercel: {
    config: {
      type: 'http',
      url: 'https://mcp.vercel.com',
    },
    name: 'Vercel',
    description: 'Analyze, debug, and manage projects and deployments',
    docsUrl: 'https://vercel.com/docs/mcp/vercel-mcp',
    credentialKeys: [],
  },
  sentry: {
    config: {
      type: 'http',
      url: 'https://mcp.sentry.dev/mcp',
      headers: {
        SENTRY_ACCESS_TOKEN: 'YOUR_ACCESS_TOKEN',
      },
    },
    name: 'Sentry',
    description: 'Search, query, and debug errors intelligently',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
    credentialKeys: [{ key: 'SENTRY_ACCESS_TOKEN', required: true }],
  },
  stripe: {
    config: {
      type: 'http',
      url: 'https://mcp.stripe.com',
      headers: {
        STRIPE_SECRET_KEY: 'YOUR_SECRET_KEY',
      },
    },
    name: 'Stripe',
    description: 'Payment processing and financial infrastructure tools',
    docsUrl: 'https://docs.stripe.com/mcp',
    credentialKeys: [{ key: 'STRIPE_SECRET_KEY', required: true }],
  },
  figma: {
    config: {
      type: 'http',
      url: 'https://mcp.figma.com/mcp',
    },
    name: 'Figma',
    description: 'Generate diagrams and better code from Figma context',
    docsUrl: 'https://help.figma.com/hc/en-us/articles/32132100833559',
    credentialKeys: [],
  },
  linear: {
    config: {
      type: 'http',
      url: 'https://mcp.linear.app/mcp',
    },
    name: 'Linear',
    description: 'Manage issues, projects & team workflows in Linear',
    docsUrl: 'https://linear.app/docs/mcp',
    credentialKeys: [],
  },
  slack: {
    config: {
      type: 'http',
      url: 'https://mcp.slack.com/mcp',
    },
    name: 'Slack',
    description: 'Send messages, create canvases, and fetch Slack data',
    docsUrl: 'https://docs.slack.dev/ai/mcp-server',
    credentialKeys: [],
  },
  cloudflare: {
    config: {
      type: 'http',
      url: 'https://bindings.mcp.cloudflare.com/mcp',
    },
    name: 'Cloudflare Developer Platform',
    description: 'Build applications with compute, storage, and AI',
    docsUrl: 'https://www.support.cloudflare.com/',
    credentialKeys: [],
  },
  netlify: {
    config: {
      type: 'http',
      url: 'https://netlify-mcp.netlify.app/mcp',
    },
    name: 'Netlify',
    description: 'Create, deploy, manage, and secure websites on Netlify',
    docsUrl: 'https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/',
    credentialKeys: [],
  },
  chrome_devtools: {
    config: {
      command: 'npx',
      args: ['chrome-devtools-mcp@latest'],
    },
    name: 'Chrome DevTools',
    description: 'Browser automation, debugging and performance analysis with Chrome DevTools',
    docsUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    credentialKeys: [],
  },
  atlassian: {
    config: {
      type: 'http',
      url: 'https://mcp.atlassian.com/v1/mcp',
    },
    name: 'Atlassian',
    description: 'Access Jira & Confluence from Claude',
    docsUrl:
      'https://community.atlassian.com/forums/Atlassian-Platform-articles/Using-the-Atlassian-Remote-MCP-Server-beta/ba-p/3005104',
    credentialKeys: [],
  },
  notion: {
    config: {
      type: 'http',
      url: 'https://mcp.notion.com/mcp',
    },
    name: 'Notion',
    description:
      'Connect your Notion workspace to search, update, and power workflows across tools',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    credentialKeys: [],
  },
  clerk: {
    config: {
      type: 'http',
      url: 'https://mcp.clerk.com/mcp',
    },
    name: 'Clerk',
    description: 'Add authentication, organizations, and billing',
    docsUrl: 'https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server',
    credentialKeys: [],
  },
  planetscale: {
    config: {
      type: 'http',
      url: 'https://mcp.pscale.dev/mcp/planetscale',
    },
    name: 'PlanetScale',
    description: 'Authenticated access to your Postgres and MySQL DBs',
    docsUrl: 'https://planetscale.com/docs/connect/mcp',
    credentialKeys: [],
  },
  bigquery: {
    config: {
      type: 'http',
      url: 'https://bigquery.googleapis.com/mcp',
    },
    name: 'Google Cloud BigQuery',
    description: 'BigQuery: Advanced analytical insights for agents',
    docsUrl: 'https://cloud.google.com/bigquery/docs/use-bigquery-mcp',
    credentialKeys: [],
  },
  hugging_face: {
    config: {
      type: 'http',
      url: 'https://huggingface.co/mcp',
    },
    name: 'Hugging Face',
    description: 'Access the Hugging Face Hub and thousands of Gradio Apps',
    docsUrl: 'https://huggingface.co/settings/mcp',
    credentialKeys: [],
  },
  exa: {
    config: {
      command: 'npx',
      args: ['-y', 'exa-mcp-server', 'tools=web_search_exa,get_code_context_exa'],
      env: {
        EXA_API_KEY: 'YOUR_API_KEY',
      },
    },
    name: 'Exa',
    description: 'Web search and code context retrieval powered by Exa AI',
    docsUrl: 'https://docs.exa.ai/reference/exa-mcp',
    credentialKeys: [{ key: 'EXA_API_KEY', required: true }],
  },
  posthog: {
    config: {
      type: 'http',
      url: 'https://mcp.posthog.com/mcp',
    },
    name: 'PostHog',
    description: 'Query, analyze, and manage your PostHog insights',
    docsUrl: 'https://posthog.com/docs/model-context-protocol',
    credentialKeys: [],
  },
  honeycomb: {
    config: {
      type: 'http',
      url: 'https://mcp.honeycomb.io/mcp',
    },
    name: 'Honeycomb',
    description: 'Query and explore observability data and SLOs',
    docsUrl: 'https://docs.honeycomb.io/troubleshoot/product-lifecycle/beta/mcp/',
    credentialKeys: [],
  },
  graphos: {
    config: {
      type: 'http',
      url: 'https://mcp.apollographql.com',
    },
    name: 'GraphOS MCP Tools',
    description: 'Search Apollo docs, specs, and best practices',
    docsUrl: 'https://www.apollographql.com/docs/graphos/platform/graphos-mcp-tools',
    credentialKeys: [],
  },
  dev_manager: {
    config: {
      command: 'npx',
      args: ['dev-manager-mcp', 'stdio'],
    },
    name: 'Dev Manager',
    description:
      'Launch and manage multiple dev servers in parallel with automatic port allocation',
    docsUrl: 'https://github.com/BloopAI/dev-manager-mcp',
    credentialKeys: [],
  },
  sanity: {
    config: {
      type: 'http',
      url: 'https://mcp.sanity.io',
    },
    name: 'Sanity',
    description: 'Create, query, and manage structured content in Sanity',
    docsUrl: 'https://www.sanity.io/docs/ai/mcp-server',
    credentialKeys: [],
  },
  amplitude: {
    config: {
      type: 'http',
      url: 'https://mcp.amplitude.com/mcp',
    },
    name: 'Amplitude',
    description: 'Search, access, and get insights on your Amplitude data',
    docsUrl: 'https://amplitude.com/docs/analytics/amplitude-mcp',
    credentialKeys: [],
  },
  asana: {
    config: {
      type: 'http',
      url: 'https://mcp.asana.com/v2/mcp',
    },
    name: 'Asana',
    description: 'Connect to Asana to coordinate tasks, projects, and goals',
    docsUrl: 'https://developers.asana.com/docs/mcp-server',
    credentialKeys: [],
  },
  clickup: {
    config: {
      type: 'http',
      url: 'https://mcp.clickup.com/mcp',
    },
    name: 'ClickUp',
    description: 'Project management & collaboration for teams & agents',
    docsUrl: 'https://help.clickup.com/hc/en-us/articles/33335772678423-What-is-ClickUp-MCP',
    credentialKeys: [],
  },
  microsoft_learn: {
    config: {
      type: 'http',
      url: 'https://learn.microsoft.com/api/mcp',
    },
    name: 'Microsoft Learn',
    description: 'Search trusted Microsoft docs to power your development',
    docsUrl: 'https://learn.microsoft.com/en-us/training/support/mcp',
    credentialKeys: [],
  },
  jam: {
    config: {
      type: 'http',
      url: 'https://mcp.jam.dev/mcp',
    },
    name: 'Jam',
    description: 'Record screen and collect automatic context for issues',
    docsUrl: 'https://jam.dev/docs/debug-a-jam/mcp',
    credentialKeys: [],
  },
  webflow: {
    config: {
      type: 'http',
      url: 'https://mcp.webflow.com/mcp',
    },
    name: 'Webflow',
    description: 'Manage Webflow CMS, pages, assets and sites',
    docsUrl: 'https://developers.webflow.com/mcp/v1.0.0/reference/overview',
    credentialKeys: [],
  },
  cloudinary: {
    config: {
      type: 'http',
      url: 'https://asset-management.mcp.cloudinary.com/sse',
    },
    name: 'Cloudinary',
    description: 'Manage, transform and deliver your images & videos',
    docsUrl: 'https://cloudinary.com/documentation/cloudinary_llm_mcp',
    credentialKeys: [],
  },
  wordpress: {
    config: {
      type: 'http',
      url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
    },
    name: 'WordPress',
    description: 'Secure AI access to manage your WordPress.com sites',
    docsUrl: 'https://developer.wordpress.com/docs/mcp/',
    credentialKeys: [],
  },
  canva: {
    config: {
      type: 'http',
      url: 'https://mcp.canva.com/mcp',
    },
    name: 'Canva',
    description: 'Search, create, autofill, and export Canva designs',
    docsUrl: 'https://www.canva.dev/docs/connect/canva-mcp-server-setup/',
    credentialKeys: [],
  },
  miro: {
    config: {
      type: 'http',
      url: 'https://mcp.miro.com/',
    },
    name: 'Miro',
    description: 'Access and create new content on Miro boards',
    docsUrl: 'https://developers.miro.com/docs/miro-mcp',
    credentialKeys: [],
  },
  intercom: {
    config: {
      type: 'http',
      url: 'https://mcp.intercom.com/mcp',
    },
    name: 'Intercom',
    description: 'Access to Intercom data for better customer insights',
    docsUrl: 'https://developers.intercom.com/docs/guides/mcp',
    credentialKeys: [],
  },
  make: {
    config: {
      type: 'http',
      url: 'https://mcp.make.com',
    },
    name: 'Make',
    description: 'Run Make scenarios and manage your Make account',
    docsUrl: 'https://developers.make.com/mcp-server/',
    credentialKeys: [],
  },
  aws_marketplace: {
    config: {
      type: 'http',
      url: 'https://marketplace-mcp.us-east-1.api.aws/mcp',
    },
    name: 'AWS Marketplace',
    description: 'Discover, evaluate, and buy solutions for the cloud',
    docsUrl:
      'https://docs.aws.amazon.com/marketplace/latest/APIReference/marketplace-mcp-server.html',
    credentialKeys: [],
  },
  motherduck: {
    config: {
      type: 'http',
      url: 'https://api.motherduck.com/mcp',
    },
    name: 'MotherDuck',
    description: 'Analyze your data with natural language',
    docsUrl: 'https://motherduck.com/docs/sql-reference/mcp/',
    credentialKeys: [],
  },
  magic_patterns: {
    config: {
      type: 'http',
      url: 'https://mcp.magicpatterns.com/mcp',
    },
    name: 'Magic Patterns',
    description: 'Discuss and iterate on Magic Patterns designs',
    docsUrl: 'https://www.magicpatterns.com/docs/documentation/features/mcp-server/overview',
    credentialKeys: [],
  },
  wix: {
    config: {
      type: 'http',
      url: 'https://mcp.wix.com/mcp',
    },
    name: 'Wix',
    description: 'Manage and build sites and apps on Wix',
    docsUrl: 'https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp',
    credentialKeys: [],
  },
  devrev: {
    config: {
      type: 'http',
      url: 'https://api.devrev.ai/mcp/v1',
    },
    name: 'DevRev',
    description: "Search and update your company's knowledge graph",
    docsUrl: 'https://support.devrev.ai/en-US/devrev/article/ART-21859-remote-mcp-server',
    credentialKeys: [],
  },
};
