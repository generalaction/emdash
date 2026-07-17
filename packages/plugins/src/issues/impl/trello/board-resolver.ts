import { mapWithConcurrency } from '../../../integrations/helpers/map-with-concurrency';
import type { TrelloBoard, TrelloClient } from '../../../integrations/impl/trello/types';

const TRELLO_BOARD_FIELDS = 'name,closed,dateLastActivity';
const MAX_TRELLO_BOARDS = 20;

export const TRELLO_REQUEST_CONCURRENCY = 5;

export async function resolveTrelloBoards(
  client: TrelloClient
): Promise<Pick<TrelloBoard, 'id' | 'name'>[]> {
  const [memberBoards, organizations] = await Promise.all([
    client.members.getMemberBoards({
      id: 'me',
      fields: TRELLO_BOARD_FIELDS,
      filter: 'open',
    }),
    client.members.getMemberOrganizations({
      id: 'me',
      fields: ['id'],
      filter: 'members',
    }),
  ]);

  const organizationBoards = await mapWithConcurrency(
    organizations,
    TRELLO_REQUEST_CONCURRENCY,
    (organization) =>
      client.organizations.getOrganizationBoards({
        id: organization.id,
        fields: TRELLO_BOARD_FIELDS,
        filter: 'open',
      })
  );

  const boards = dedupeOpenBoards([...memberBoards, ...organizationBoards.flat()]);
  return sortByLastActivityDesc(boards)
    .slice(0, MAX_TRELLO_BOARDS)
    .map((board) => ({ id: board.id, name: board.name }));
}

function dedupeOpenBoards(boards: TrelloBoard[]): TrelloBoard[] {
  const byId = new Map<string, TrelloBoard>();
  for (const board of boards) {
    if (board.closed || byId.has(board.id)) continue;
    byId.set(board.id, board);
  }
  return [...byId.values()];
}

function sortByLastActivityDesc(boards: TrelloBoard[]): TrelloBoard[] {
  return [...boards].sort(
    (a, b) =>
      new Date(b.dateLastActivity ?? 0).getTime() - new Date(a.dateLastActivity ?? 0).getTime()
  );
}
