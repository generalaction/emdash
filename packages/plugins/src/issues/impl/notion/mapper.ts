import type { PageObjectResponse, RichTextItemResponse } from '@notionhq/client';
import type { IssueData } from '../../types';

type NotionPageProperty = PageObjectResponse['properties'][string];
const UNTITLED_NOTION_PAGE = 'Untitled Notion page';

export function toIssueData(page: PageObjectResponse): IssueData {
  return {
    identifier: page.id,
    displayIdentifier: null,
    title: pageTitle(page),
    url: page.url,
    description: firstRichTextProperty(page),
    status: firstStatusProperty(page),
    assignees: peopleProperty(page),
    project: pageParentLabel(page),
    updatedAt: page.last_edited_time,
  };
}

export function hasMeaningfulTitle(page: PageObjectResponse): boolean {
  return pageTitle(page) !== UNTITLED_NOTION_PAGE;
}

export function isDatabasePage(page: PageObjectResponse): boolean {
  return page.parent.type === 'database_id' || page.parent.type === 'data_source_id';
}

function pageTitle(page: PageObjectResponse): string {
  const title = Object.values(page.properties).find((property) => property.type === 'title');
  if (!title || title.type !== 'title') return UNTITLED_NOTION_PAGE;
  return richTextPlainText(title.title) || UNTITLED_NOTION_PAGE;
}

function firstRichTextProperty(page: PageObjectResponse): string | undefined {
  for (const property of Object.values(page.properties)) {
    if (property.type !== 'rich_text') continue;
    const value = richTextPlainText(property.rich_text);
    if (value) return value;
  }
  return undefined;
}

function firstStatusProperty(page: PageObjectResponse): string | undefined {
  const preferredNames = ['status', 'state', 'stage'];
  for (const name of preferredNames) {
    const property = findProperty(page.properties, name);
    const value = statusPropertyLabel(property);
    if (value) return value;
  }

  for (const property of Object.values(page.properties)) {
    const value = statusPropertyLabel(property);
    if (value) return value;
  }
  return undefined;
}

function statusPropertyLabel(property: NotionPageProperty | undefined): string | undefined {
  if (!property) return undefined;
  if (property.type === 'status') return property.status?.name;
  if (property.type === 'select') return property.select?.name;
  return undefined;
}

function peopleProperty(page: PageObjectResponse): string[] | undefined {
  const people = Object.values(page.properties)
    .filter((property) => property.type === 'people')
    .flatMap((property) => (property.type === 'people' ? property.people : []))
    .map((person) => ('name' in person ? person.name : undefined))
    .filter((name): name is string => !!name);

  return people.length ? people : undefined;
}

function pageParentLabel(page: PageObjectResponse): string | undefined {
  if (page.parent.type === 'database_id') return 'Database';
  if (page.parent.type === 'data_source_id') return 'Data source';
  if (page.parent.type === 'page_id') return 'Page';
  if (page.parent.type === 'workspace') return 'Workspace';
  return undefined;
}

function findProperty(
  properties: PageObjectResponse['properties'],
  name: string
): NotionPageProperty | undefined {
  const lowerName = name.toLowerCase();
  return Object.entries(properties).find(([key]) => key.toLowerCase() === lowerName)?.[1];
}

export function richTextPlainText(richText: RichTextItemResponse[] | undefined): string {
  return (richText ?? [])
    .map((item) => item.plain_text)
    .join('')
    .trim();
}

export function toIssueListItems(pages: PageObjectResponse[]) {
  return pages.filter(hasMeaningfulTitle).map(toIssueData);
}
