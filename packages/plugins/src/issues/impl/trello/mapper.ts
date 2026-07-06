import type { TrelloCard } from '../../../integrations/impl/trello/types';
import type { IssueData } from '../../types';

export function toIssueData(card: TrelloCard, boardName = card.board?.name): IssueData {
  return {
    identifier: card.shortLink ?? card.id,
    title: card.name ?? '',
    url: card.url,
    description: card.desc || undefined,
    project: boardName,
    updatedAt: formatTrelloDate(card.dateLastActivity),
  };
}

export function formatTrelloDate(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}
