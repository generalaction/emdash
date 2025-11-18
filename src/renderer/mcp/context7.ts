import type { Provider } from '../types';

export type Context7ProviderId = Provider;

export interface Context7SetupSnippet {
  label: string;
  language: 'json' | 'bash' | 'toml' | 'text';
  content: string;
}

export interface Context7ProviderConfig {
  invocation?: string;
  setup: Context7SetupSnippet[];
}

export interface Context7IntegrationMeta {
  id: 'context7';
  label: string;
  docsUrl: string;
  defaultInvocation: string;
  // Provider-specific installation snippets and optional invocation overrides
  byProvider: Partial<Record<Context7ProviderId, Context7ProviderConfig>>;
}

// Shared snippets
const SNIPPETS = {
  cursorRemote: {
    label: 'Cursor – Remote (HTTP)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "CONTEXT7_API_KEY": "YOUR_API_KEY" }
    }
  }
}`,
  },
  cursorLocal: {
    label: 'Cursor – Local (npx stdio)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}`,
  },
  claudeRemote: {
    label: 'Claude Code – Remote (HTTP)',
    language: 'bash' as const,
    content:
      'claude mcp add --transport http context7 https://mcp.context7.com/mcp \\\n+  --header "CONTEXT7_API_KEY: YOUR_API_KEY"',
  },
  claudeLocal: {
    label: 'Claude Code – Local (npx stdio)',
    language: 'bash' as const,
    content: 'claude mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY',
  },
  codexTomlLocal: {
    label: 'OpenAI Codex – Local (npx)',
    language: 'toml' as const,
    content: `[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]`,
  },
  codexTomlRemote: {
    label: 'OpenAI Codex – Remote (HTTP)',
    language: 'toml' as const,
    content: `[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
http_headers = { "CONTEXT7_API_KEY" = "YOUR_API_KEY" }`,
  },
  ampRemote: {
    label: 'Amp – Remote (HTTP)',
    language: 'bash' as const,
    content:
      'amp mcp add context7 --header "CONTEXT7_API_KEY=YOUR_API_KEY" https://mcp.context7.com/mcp',
  },
  ampNoKey: {
    label: 'Amp – Remote (No API key)',
    language: 'bash' as const,
    content: 'amp mcp add context7 https://mcp.context7.com/mcp',
  },
  copilotRemote: {
    label: 'Copilot CLI – Remote (HTTP)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "CONTEXT7_API_KEY": "YOUR_API_KEY" },
      "tools": ["get-library-docs", "resolve-library-id"]
    }
  }
}`,
  },
  copilotLocal: {
    label: 'Copilot CLI – Local (npx)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "type": "local",
      "command": "npx",
      "tools": ["get-library-docs", "resolve-library-id"],
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}`,
  },
  qwenRemote: {
    label: 'Qwen Coder – Remote (HTTP)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "httpUrl": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "YOUR_API_KEY",
        "Accept": "application/json, text/event-stream"
      }
    }
  }
}`,
  },
  qwenLocal: {
    label: 'Qwen Coder – Local (npx)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}`,
  },
  geminiRemote: {
    label: 'Gemini CLI – Remote (HTTP)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "httpUrl": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "YOUR_API_KEY",
        "Accept": "application/json, text/event-stream"
      }
    }
  }
}`,
  },
  geminiLocal: {
    label: 'Gemini CLI – Local (npx)',
    language: 'json' as const,
    content: `{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}`,
  },
  droidRemote: {
    label: 'Factory Droid – Remote (HTTP)',
    language: 'bash' as const,
    content:
      'droid mcp add context7 https://mcp.context7.com/mcp --type http --header "CONTEXT7_API_KEY: YOUR_API_KEY"',
  },
  droidLocal: {
    label: 'Factory Droid – Local (npx)',
    language: 'bash' as const,
    content:
      'droid mcp add context7 "npx -y @upstash/context7-mcp" --env CONTEXT7_API_KEY=YOUR_API_KEY',
  },
  zedLocal: {
    label: 'Zed – Local (npx)',
    language: 'json' as const,
    content: `{
  "context_servers": {
    "Context7": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}`,
  },
  opencodeRemote: {
    label: 'OpenCode – Remote (HTTP)',
    language: 'json' as const,
    content: `"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "headers": { "CONTEXT7_API_KEY": "YOUR_API_KEY" },
    "enabled": true
  }
}`,
  },
  opencodeLocal: {
    label: 'OpenCode – Local (npx)',
    language: 'json' as const,
    content: `{
  "mcp": {
    "context7": {
      "type": "local",
      "command": ["npx", "-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"],
      "enabled": true
    }
  }
}`,
  },
  genericRemote: {
    label: 'Generic – Remote (HTTP)',
    language: 'text' as const,
    content:
      'URL: https://mcp.context7.com/mcp (set CONTEXT7_API_KEY header if available) – see docs',
  },
};

export const CONTEXT7_INTEGRATION: Context7IntegrationMeta = {
  id: 'context7',
  label: 'Context7 MCP',
  docsUrl: 'https://github.com/upstash/context7',
  defaultInvocation: 'use context7 for looking up library docs',
  byProvider: {
    codex: {
      setup: [SNIPPETS.codexTomlRemote, SNIPPETS.codexTomlLocal],
    },
    claude: {
      setup: [SNIPPETS.claudeRemote, SNIPPETS.claudeLocal],
    },
    cursor: {
      setup: [SNIPPETS.cursorRemote, SNIPPETS.cursorLocal],
    },
    copilot: {
      setup: [SNIPPETS.copilotRemote, SNIPPETS.copilotLocal],
    },
    qwen: {
      setup: [SNIPPETS.qwenRemote, SNIPPETS.qwenLocal],
    },
    gemini: {
      setup: [SNIPPETS.geminiRemote, SNIPPETS.geminiLocal],
    },
    amp: {
      setup: [SNIPPETS.ampRemote, SNIPPETS.ampNoKey],
    },
    opencode: {
      setup: [SNIPPETS.opencodeRemote, SNIPPETS.opencodeLocal],
    },
    droid: {
      setup: [SNIPPETS.droidRemote, SNIPPETS.droidLocal],
    },
    charm: {
      setup: [SNIPPETS.genericRemote],
    },
    goose: {
      setup: [SNIPPETS.genericRemote],
    },
    kimi: {
      setup: [SNIPPETS.genericRemote],
    },
    kiro: {
      setup: [SNIPPETS.zedLocal],
    },
    auggie: {
      setup: [SNIPPETS.genericRemote],
    },
  },
};

export function getContext7InvocationForProvider(provider: Provider): string {
  const cfg = CONTEXT7_INTEGRATION.byProvider[provider];
  return (cfg?.invocation || CONTEXT7_INTEGRATION.defaultInvocation).trim();
}

export function getContext7SnippetsForProvider(provider: Provider): Context7SetupSnippet[] {
  const cfg = CONTEXT7_INTEGRATION.byProvider[provider];
  return cfg?.setup?.length ? cfg.setup : [SNIPPETS.genericRemote];
}
