import React from 'react';

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

async function getGithubReleases(): Promise<GitHubRelease[]> {
  try {
    const response = await fetch('https://api.github.com/repos/generalaction/emdash/releases', {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        ...(process.env.GITHUB_TOKEN && {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
        }),
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!response.ok) {
      console.error('GitHub API error:', response.status);
      return [];
    }

    const releases = await response.json();
    return releases.filter((r: GitHubRelease) => !r.draft);
  } catch (error) {
    console.error('Failed to fetch releases:', error);
    return [];
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatVersion(tagName: string): string {
  return tagName.startsWith('v') ? tagName.substring(1) : tagName;
}

export async function Changelog() {
  const releases = await getGithubReleases();

  if (releases.length === 0) {
    return (
      <div className="text-muted-foreground">
        <p>
          No releases found. Check the{' '}
          <a
            href="https://github.com/generalaction/emdash/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            GitHub Releases
          </a>{' '}
          page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {releases.slice(0, 20).map((release) => (
        <div key={release.id} className="border-b border-border pb-8 last:border-0">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-bold">
              <a
                href={release.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                v{formatVersion(release.tag_name)}
              </a>
            </h2>
            <time className="text-sm text-muted-foreground">
              {formatDate(release.published_at)}
            </time>
          </div>

          {release.body ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReleaseNotes content={release.body} />
            </div>
          ) : (
            <p className="italic text-muted-foreground">No release notes available.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function ReleaseNotes({ content }: { content: string }) {
  // Process content line by line, handling both markdown and HTML
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle HTML img tags
    if (line.includes('<img')) {
      const imgMatch = line.match(/<img[^>]+>/);
      if (imgMatch) {
        const srcMatch = imgMatch[0].match(/src="([^"]+)"/);
        const altMatch = imgMatch[0].match(/alt="([^"]+)"/);
        const widthMatch = imgMatch[0].match(/width="([^"]+)"/);
        const heightMatch = imgMatch[0].match(/height="([^"]+)"/);

        if (srcMatch) {
          elements.push(
            <div key={i} className="my-4">
              <img
                src={srcMatch[1]}
                alt={altMatch ? altMatch[1] : 'Release image'}
                width={widthMatch ? widthMatch[1] : undefined}
                height={heightMatch ? heightMatch[1] : undefined}
                className="h-auto max-w-full rounded-lg border border-border"
              />
            </div>
          );
          continue;
        }
      }
    }

    // Headers
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="mb-2 mt-4 text-lg font-semibold">
          {line.substring(3)}
        </h3>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={i} className="mb-1 mt-3 font-semibold">
          {line.substring(4)}
        </h4>
      );
      continue;
    }

    // List items (with PR links)
    if (line.startsWith('* ')) {
      const item = line.substring(2);
      // Convert PR links and @mentions to actual links
      const withLinks = item
        .replace(
          /https:\/\/github\.com\/[^\s]+/g,
          (url) =>
            `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline">${url}</a>`
        )
        .replace(
          /@(\w+)/g,
          (match, username) =>
            `<a href="https://github.com/${username}" target="_blank" rel="noopener noreferrer" class="font-medium">@${username}</a>`
        );
      elements.push(
        <li key={i} className="ml-4 list-disc" dangerouslySetInnerHTML={{ __html: withLinks }} />
      );
      continue;
    }

    // Bold text (like **New Contributors**)
    if (line.includes('**')) {
      const formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      elements.push(
        <p key={i} className="mt-4 font-semibold" dangerouslySetInnerHTML={{ __html: formatted }} />
      );
      continue;
    }

    // Full Changelog link
    if (line.includes('Full Changelog:')) {
      const match = line.match(/https:\/\/github\.com\/[^\s]+/);
      if (match) {
        elements.push(
          <p key={i} className="mt-4">
            <strong>Full Changelog:</strong>{' '}
            <a href={match[0]} target="_blank" rel="noopener noreferrer" className="underline">
              View diff
            </a>
          </p>
        );
        continue;
      }
    }

    // Empty lines
    if (line.trim() === '') {
      continue;
    }

    // Regular text
    elements.push(
      <p key={i} className="my-2">
        {line}
      </p>
    );
  }

  return <>{elements}</>;
}
