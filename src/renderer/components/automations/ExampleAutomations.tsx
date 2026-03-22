import React from 'react';
import { Search, GitPullRequest, Shield, Gauge, FileText, Bug } from 'lucide-react';

interface ExampleAutomation {
  icon: React.ReactNode;
  name: string;
  prompt: string;
  description: string;
}

const EXAMPLES: ExampleAutomation[] = [
  {
    icon: <GitPullRequest className="h-4 w-4" />,
    name: 'Daily code review',
    prompt:
      'Review all uncommitted changes and open PRs. Leave comments on code quality issues, potential bugs, and suggest improvements.',
    description: 'Review changes & PRs daily',
  },
  {
    icon: <Bug className="h-4 w-4" />,
    name: 'Bug scan',
    prompt:
      'Scan the codebase for common bugs, anti-patterns, and potential runtime errors. Report findings with file paths and suggested fixes.',
    description: 'Find bugs & anti-patterns',
  },
  {
    icon: <Shield className="h-4 w-4" />,
    name: 'Security audit',
    prompt:
      'Check for security vulnerabilities including exposed secrets, SQL injection risks, XSS vulnerabilities, and outdated dependencies with known CVEs.',
    description: 'Check for vulnerabilities',
  },
  {
    icon: <Gauge className="h-4 w-4" />,
    name: 'Performance scan',
    prompt:
      'Analyze the codebase for performance bottlenecks, memory leaks, unnecessary re-renders, and slow database queries. Suggest optimizations.',
    description: 'Find performance issues',
  },
  {
    icon: <FileText className="h-4 w-4" />,
    name: 'Doc coverage check',
    prompt:
      'Check for undocumented public APIs, missing README sections, and outdated documentation. Generate missing docs where appropriate.',
    description: 'Ensure docs are up to date',
  },
  {
    icon: <Search className="h-4 w-4" />,
    name: 'Dependency updates',
    prompt:
      'Check for outdated dependencies and create a summary of available updates. Highlight breaking changes and security patches.',
    description: 'Track outdated packages',
  },
];

interface ExampleAutomationsProps {
  onSelect: (name: string, prompt: string) => void;
}

const ExampleAutomations: React.FC<ExampleAutomationsProps> = ({ onSelect }) => {
  return (
    <div className="py-8">
      <div className="mb-6 text-center">
        <p className="text-xs text-muted-foreground/60">
          No automations yet. Start with a template or create your own.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.name}
            type="button"
            onClick={() => onSelect(example.name, example.prompt)}
            className="group flex items-start gap-3 rounded-lg border border-border/30 bg-muted/10 px-3.5 py-3 text-left transition-all hover:border-border/60 hover:bg-muted/30"
          >
            <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground">
              {example.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground/80 group-hover:text-foreground">
                {example.name}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/50">
                {example.description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ExampleAutomations;
