import { createFileRoute } from '@tanstack/react-router';
import { shareMeta } from '../components/share-meta';
import { ContentPane, SharePage } from '../components/SharePage';
import { getSkillSharePage } from '../server/share-fns';

export const Route = createFileRoute('/skills/$id')({
  loader: ({ params }) => getSkillSharePage({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? shareMeta({
          title: `Emdash Skill: ${loaderData.skill.displayName}`,
          description: loaderData.skill.description,
          url: `${loaderData.origin}/skills/${loaderData.id}`,
        })
      : [],
  }),
  component: SkillSharePage,
});

function SkillSharePage() {
  const data = Route.useLoaderData();

  return (
    <SharePage
      eyebrow="Skill"
      title={data.skill.displayName}
      description={data.skill.description}
      meta={<span className="meta-line">1 file</span>}
      deepLink={`emdash://share/skills/${data.id}`}
    >
      <ContentPane label="SKILL.md" copyText={data.skill.skillMdContent}>
        {/* renderMarkdown escapes text, drops raw HTML, and rejects unsafe link protocols. */}
        <article className="markdown" dangerouslySetInnerHTML={{ __html: data.contentHtml }} />
      </ContentPane>
    </SharePage>
  );
}
