import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { SharedAutomation } from '../../../../src/shared/share';
import { AgentBadge } from '../components/AgentBadge';
import { shareMeta } from '../components/share-meta';
import { ContentPane, PromptText, SharePage } from '../components/SharePage';
import { getAutomationSharePage } from '../server/share-fns';

export const Route = createFileRoute('/automations/$id')({
  loader: ({ params }) => getAutomationSharePage({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? shareMeta({
          title: `Emdash Automation: ${loaderData.automation.name}`,
          description:
            loaderData.automation.description ??
            (loaderData.automation.actions[0]?.prompt || 'Shared Emdash automation'),
          url: `${loaderData.origin}/automations/${loaderData.id}`,
        })
      : [],
  }),
  component: AutomationSharePage,
});

function AutomationSharePage() {
  const data = Route.useLoaderData();
  const automation = data.automation;

  return (
    <SharePage
      eyebrow="Automation"
      title={automation.name}
      description={automation.description ?? null}
      deepLink={`emdash://share/automations/${data.id}`}
    >
      <section className="border-t border-border bg-background">
        <div className="overflow-x-auto p-6 max-[560px]:p-4">
          <div className="grid [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))] gap-3">
            <Fact label="Schedule">
              <code className="font-mono text-code">{automation.trigger.expr}</code> ·{' '}
              {automation.trigger.tz}
            </Fact>
            {automation.agentProviderId ? (
              <Fact label="Agent">
                <AgentBadge providerId={automation.agentProviderId} />
              </Fact>
            ) : null}
            <Fact label="Category">{automation.category}</Fact>
            <Fact label="Deadline">{deadlineLabel(automation)}</Fact>
          </div>
        </div>
      </section>
      {automation.actions.map((action, index) => (
        <ContentPane
          key={index}
          label={automation.actions.length > 1 ? `Task prompt ${index + 1}` : 'Task prompt'}
          copyText={action.prompt}
        >
          <PromptText>{action.prompt}</PromptText>
        </ContentPane>
      ))}
    </SharePage>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background-1 px-4 py-3.5">
      <h2 className="mb-1.5 font-mono text-micro font-medium tracking-[0.1em] text-foreground-muted uppercase">
        {label}
      </h2>
      <p className="text-sm wrap-anywhere text-foreground">{children}</p>
    </div>
  );
}

function deadlineLabel(automation: SharedAutomation): string {
  if (automation.deadlinePolicy === 'none') return 'None';
  if (automation.deadlinePolicy === 'fixed' && automation.deadlineMs) {
    return `${Math.round(automation.deadlineMs / 60_000)} min`;
  }
  return 'Until next run';
}
