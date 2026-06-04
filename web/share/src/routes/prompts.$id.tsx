import { createFileRoute } from '@tanstack/react-router';
import { shareMeta } from '../components/share-meta';
import { ContentPane, SharePage } from '../components/SharePage';
import { getPromptSharePage } from '../server/share-fns';

export const Route = createFileRoute('/prompts/$id')({
  loader: ({ params }) => getPromptSharePage({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? shareMeta({
          title: `Emdash Prompt: ${loaderData.prompt.title}`,
          description: loaderData.prompt.prompt,
          url: `${loaderData.origin}/prompts/${loaderData.id}`,
        })
      : [],
  }),
  component: PromptSharePage,
});

function PromptSharePage() {
  const data = Route.useLoaderData();

  return (
    <SharePage
      eyebrow="Prompt"
      title={data.prompt.title}
      description={null}
      deepLink={`emdash://share/prompts/${data.id}`}
    >
      <ContentPane label="Prompt" copyText={data.prompt.prompt}>
        <pre className="prompt-text">
          <code>{data.prompt.prompt}</code>
        </pre>
      </ContentPane>
    </SharePage>
  );
}
