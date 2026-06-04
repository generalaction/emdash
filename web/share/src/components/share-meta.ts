type ShareMetaInput = {
  title: string;
  description: string;
  url: string;
};

export function shareMeta({ title, description, url }: ShareMetaInput) {
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: url },
  ];
}
