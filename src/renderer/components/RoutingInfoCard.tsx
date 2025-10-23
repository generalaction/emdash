import React from 'react';
import { Workflow, ArrowUpRight } from 'lucide-react';

export const RoutingInfoCard: React.FC = () => {
  return (
    <div className="w-80 max-w-[20rem] rounded-lg bg-background p-3 text-foreground shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Workflow className="h-5 w-5" aria-hidden="true" />
        <div className="flex items-baseline gap-1 text-sm leading-none">
          <span className="text-muted-foreground">Agent</span>
          <span className="text-muted-foreground">/</span>
          <strong className="font-semibold text-foreground">Routing</strong>
        </div>
        <span className="ml-auto rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Soon
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Smart routing between available CLIs to pick the best tool for your request.
      </p>
      <div>
        <a
          href="https://artificialanalysis.ai/insights/coding-agents-comparison"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-foreground hover:underline"
        >
          <span>Compare Coding Agents</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
};

export default RoutingInfoCard;
