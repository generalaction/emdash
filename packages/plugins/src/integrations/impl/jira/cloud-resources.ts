export async function resolveJiraCloudId(siteUrl: string, accessToken: string): Promise<string> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error('Unable to find Jira sites available to this bearer token.');
  }

  const resources: unknown = await response.json();
  if (!Array.isArray(resources)) {
    throw new Error('Atlassian returned an invalid list of accessible Jira sites.');
  }

  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const resource = resources.find(
    (candidate): candidate is { id: string; url: string } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof candidate.id === 'string' &&
      candidate.id.trim().length > 0 &&
      typeof candidate.url === 'string' &&
      normalizeSiteUrl(candidate.url) === normalizedSiteUrl
  );
  if (!resource) {
    throw new Error('This bearer token does not have access to the specified Jira site.');
  }
  return resource.id.trim();
}

function normalizeSiteUrl(siteUrl: string): string {
  return new URL(siteUrl).toString().replace(/\/$/, '');
}
