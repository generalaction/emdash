import { createFileRoute } from '@tanstack/react-router';
import type { SharedAutomation } from '../../../../src/shared/share';
import { AgentBadge } from '../components/AgentBadge';
import { shareMeta } from '../components/share-meta';
import { ContentPane, SharePage } from '../components/SharePage';
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
      <section className="share-pane">
        <div className="pane-content">
          <div className="facts">
            <div>
              <h2>Schedule</h2>
              <p>
                <code>{automation.trigger.expr}</code> · {automation.trigger.tz}
              </p>
            </div>
            {automation.agentProviderId ? (
              <div>
                <h2>Agent</h2>
                <p>
                  <AgentBadge providerId={automation.agentProviderId} />
                </p>
              </div>
            ) : null}
            <div>
              <h2>Category</h2>
              <p>{automation.category}</p>
            </div>
            <div>
              <h2>Deadline</h2>
              <p>{deadlineLabel(automation)}</p>
            </div>
          </div>
        </div>
      </section>
      {automation.actions.map((action, index) => (
        <ContentPane
          key={index}
          label={automation.actions.length > 1 ? `Task prompt ${index + 1}` : 'Task prompt'}
          copyText={action.prompt}
        >
          <pre className="prompt-text">
            <code>{action.prompt}</code>
          </pre>
        </ContentPane>
      ))}
    </SharePage>
  );
}

function deadlineLabel(automation: SharedAutomation): string {
  if (automation.deadlinePolicy === 'none') return 'None';
  if (automation.deadlinePolicy === 'fixed' && automation.deadlineMs) {
    return `${Math.round(automation.deadlineMs / 60_000)} min`;
  }
  return 'Until next run';
}
