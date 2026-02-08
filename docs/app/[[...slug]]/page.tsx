import { source } from '@/lib/source';
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import { CopyMarkdownButton } from '@/components/CopyMarkdownButton';
import { LastUpdated } from '@/components/LastUpdated';
import { getGithubLastEdit } from 'fumadocs-core/content/github';

async function getLastModifiedFromGitHub(filePath: string): Promise<Date | null> {
  if (process.env.NODE_ENV === 'development') {
    return null;
  }

  try {
    const time = await getGithubLastEdit({
      owner: 'generalaction',
      repo: 'emdash',
      path: `docs/content/docs/${filePath}.mdx`,
      token: process.env.GIT_TOKEN ? `Bearer ${process.env.GIT_TOKEN}` : undefined,
    });
    return time ? new Date(time) : null;
  } catch {
    return null;
  }
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;

  // Prefer plugin-derived lastModified, fallback to GitHub API
  let lastModified: Date | undefined = page.data.lastModified;
  if (!lastModified) {
    const filePath = slug?.join('/') || 'index';
    lastModified = (await getLastModifiedFromGitHub(filePath)) ?? undefined;
  }

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      breadcrumb={{
        enabled: true,
        includeRoot: { url: '/' },
        includePage: true,
      }}
      tableOfContent={{
        style: 'clerk',
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="border-fd-border flex items-center gap-2 border-b pb-4 pt-2">
        <CopyMarkdownButton markdownUrl={page.url === '/' ? '/index.md' : `${page.url}.md`} />
      </div>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
      {lastModified && <LastUpdated date={lastModified} />}
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
