import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@main/core/issues/issue-provider';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueContextResult,
  type IssueListResult,
} from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { trelloConnectionService, type TrelloAuth } from './trello-connection-service';

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

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>
) {
  const results: TOutput[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }
  return results;
}

function toIssue(card: TrelloCard, boardName?: string, context?: string): Issue {
  return {
    provider: 'trello',
    identifier: card.shortLink,
    title: card.name,
    url: card.url,
    description: card.desc || undefined,
    project: boardName,
    updatedAt: card.dateLastActivity,
    fetchedAt: new Date().toISOString(),
    context,
  };
}

function sortByUpdatedAtDesc(issues: Issue[]): Issue[] {
  return issues.sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

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

async function resolveBoards(
  auth: TrelloAuth,
  boardIds: string[]
): Promise<Pick<TrelloBoard, 'id' | 'name'>[]> {
  if (boardIds.length) {
    return mapWithConcurrency(boardIds, TRELLO_REQUEST_CONCURRENCY, (boardId) =>
      trelloConnectionService.request<TrelloBoard>(auth, `/boards/${boardId}`, { fields: 'name' })
    );
  }

  const boards = await trelloConnectionService.request<TrelloBoard[]>(auth, '/members/me/boards', {
    fields: 'name,closed',
    filter: 'open',
  });
  return boards.filter((board) => !board.closed).slice(0, DEFAULT_BOARD_LIMIT);
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const credentials = await trelloConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Trello is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 50, 200);

  try {
    const boards = await resolveBoards(credentials, credentials.boardIds);
    const cardsPerBoard = await mapWithConcurrency(
      boards,
      TRELLO_REQUEST_CONCURRENCY,
      async (board) => {
        const cards = await trelloConnectionService.request<TrelloCard[]>(
          credentials,
          `/boards/${board.id}/cards/open`,
          { fields: CARD_FIELDS }
        );
        return cards.map((card) => toIssue(card, board.name));
      }
    );

    const issues = sortByUpdatedAtDesc(cardsPerBoard.flat());
    return { success: true, issues: issues.slice(0, sanitizedLimit) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Trello cards.',
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const credentials = await trelloConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Trello is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 20, 200);

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
    if (credentials.boardIds.length) {
      params.idBoards = credentials.boardIds.join(',');
    }

    const data = await trelloConnectionService.request<{
      cards: (TrelloCard & { board?: { name: string } })[];
    }>(credentials, '/search', params);

    const issues = sortByUpdatedAtDesc(data.cards.map((card) => toIssue(card, card.board?.name)));
    return { success: true, issues };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search Trello cards.',
    };
  }
}

async function getIssueContext(opts: IssueContextOpts): Promise<IssueContextResult> {
  const credentials = await trelloConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Trello is not connected.' };
  }

  try {
    const card = await trelloConnectionService.request<TrelloCardWithContext>(
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

    const context = formatContext(card);
    const issue = toIssue(card, card.board?.name, context);
    return { success: true, issue };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Trello card context.',
    };
  }
}

export const trelloIssueProvider: IssueProvider = {
  type: 'trello',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.trello,
  checkConnection: () => trelloConnectionService.checkConnection(),
  listIssues: async (opts: IssueQueryOpts) => listIssues(opts.limit ?? 50),
  searchIssues: async (opts: IssueSearchOpts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
  getIssueContext,
};
