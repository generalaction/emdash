import { err, ok } from '@emdash/shared';
import { mapWithConcurrency } from '../../../integrations/helpers/map-with-concurrency';
import {
  readTrelloCredentials,
  trelloRequest,
  type TrelloAuth,
} from '../../../integrations/impl/trello/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueDetail } from '../../types';

type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  url: string;
  shortLink: string;
  dateLastActivity: string;
};

type TrelloBoard = {
  id: string;
  name: string;
  closed?: boolean;
};

type TrelloCommentAction = {
  id: string;
  date: string;
  data: { text?: string };
  memberCreator?: { fullName?: string; username?: string };
};

type TrelloChecklist = {
  id: string;
  name: string;
  checkItems: { name: string; state: string; pos: number }[];
};

type TrelloCardWithContext = TrelloCard & {
  board?: { name: string };
  actions?: TrelloCommentAction[];
  checklists?: TrelloChecklist[];
};

const CARD_FIELDS = 'name,desc,url,shortLink,dateLastActivity';
const DEFAULT_BOARD_LIMIT = 20;
const TRELLO_REQUEST_CONCURRENCY = 5;

function toIssue(card: TrelloCard, boardName?: string, context?: string): IssueData | IssueDetail {
  return {
    identifier: card.shortLink,
    title: card.name,
    url: card.url,
    description: card.desc || undefined,
    project: boardName,
    updatedAt: card.dateLastActivity,
    context,
  };
}

function sortByUpdatedAtDesc(issues: IssueData[]): IssueData[] {
  return [...issues].sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

async function resolveBoards(
  auth: TrelloAuth,
  boardIds: string[]
): Promise<Pick<TrelloBoard, 'id' | 'name'>[]> {
  if (boardIds.length) {
    return mapWithConcurrency(boardIds, TRELLO_REQUEST_CONCURRENCY, (boardId) =>
      trelloRequest<TrelloBoard>(auth, `/boards/${boardId}`, { fields: 'name' })
    );
  }

  const boards = await trelloRequest<TrelloBoard[]>(auth, '/members/me/boards', {
    fields: 'name,closed',
    filter: 'open',
  });
  return boards.filter((board) => !board.closed).slice(0, DEFAULT_BOARD_LIMIT);
}

const plugin = defineIssuesPlugin({ integrationId: 'trello' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      const credentials = readTrelloCredentials(host.credentials);
      const sanitizedLimit = clampIssueLimit(opts.limit, 50, 200);

      try {
        const boards = await resolveBoards(credentials, credentials.boardIds);
        const cardsPerBoard = await mapWithConcurrency(
          boards,
          TRELLO_REQUEST_CONCURRENCY,
          async (board) => {
            const cards = await trelloRequest<TrelloCard[]>(
              credentials,
              `/boards/${board.id}/cards/open`,
              {
                fields: CARD_FIELDS,
              }
            );
            return cards.map((card) => toIssue(card, board.name) as IssueData);
          }
        );

        const issues = sortByUpdatedAtDesc(cardsPerBoard.flat());
        return ok(issues.slice(0, sanitizedLimit));
      } catch (error) {
        return err(
          issueError(
            'generic',
            error instanceof Error ? error.message : 'Failed to fetch Trello cards.'
          )
        );
      }
    },

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      const credentials = readTrelloCredentials(host.credentials);
      const sanitizedLimit = clampIssueLimit(opts.limit, 20, 200);

      try {
        const params: Record<string, string> = {
          query: term,
          modelTypes: 'cards',
          card_fields: CARD_FIELDS,
          cards_limit: String(sanitizedLimit),
          card_board: 'true',
          board_fields: 'name',
          partial: 'true',
        };
        if (credentials.boardIds.length) params.idBoards = credentials.boardIds.join(',');

        const data = await trelloRequest<{
          cards: (TrelloCard & { board?: { name: string } })[];
        }>(credentials, '/search', params);

        const issues = sortByUpdatedAtDesc(
          data.cards.map((card) => toIssue(card, card.board?.name) as IssueData)
        );
        return ok(issues);
      } catch (error) {
        return err(
          issueError(
            'generic',
            error instanceof Error ? error.message : 'Failed to search Trello cards.'
          )
        );
      }
    },

    async getIssue(host, opts) {
      const credentials = readTrelloCredentials(host.credentials);
      try {
        const card = await trelloRequest<TrelloCardWithContext>(
          credentials,
          `/cards/${opts.identifier}`,
          {
            fields: CARD_FIELDS,
            board: 'true',
            board_fields: 'name',
            actions: 'commentCard',
            checklists: 'all',
          }
        );

        return ok(toIssue(card, card.board?.name, formatContext(card)) as IssueDetail);
      } catch (error) {
        return err(
          issueError(
            'generic',
            error instanceof Error ? error.message : 'Failed to fetch Trello card context.'
          )
        );
      }
    },
  },
});

function formatChecklists(checklists: TrelloChecklist[] | undefined): string | undefined {
  if (!checklists?.length) return undefined;

  return checklists
    .map((checklist) => {
      const items = [...checklist.checkItems]
        .sort((a, b) => a.pos - b.pos)
        .map((item) => `- [${item.state === 'complete' ? 'x' : ' '}] ${item.name}`);
      return [`Checklist: ${checklist.name}`, ...items].join('\n');
    })
    .join('\n\n');
}

function formatComments(actions: TrelloCommentAction[] | undefined): string | undefined {
  const comments = (actions ?? []).filter((action) => action.data.text?.trim());
  if (!comments.length) return undefined;

  return comments
    .map((action) => {
      const author = action.memberCreator?.fullName ?? action.memberCreator?.username ?? 'Unknown';
      return `**${author}** (${action.date}):\n${action.data.text}`;
    })
    .join('\n\n');
}

function formatContext(card: TrelloCardWithContext): string | undefined {
  const sections = [formatChecklists(card.checklists), formatComments(card.actions)].filter(
    Boolean
  );
  return sections.length ? sections.join('\n\n') : undefined;
}
