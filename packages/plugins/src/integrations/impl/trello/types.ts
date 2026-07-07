import type { Action, Board, Card, CheckItem, Checklist, Member } from 'trello.js';
import type { createTrelloClient as createTrelloSdkClient } from 'trello.js';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';

export const trelloCredentialsSchema = z.object({
  apiKey: credentialString('Trello API key and token cannot be empty.'),
  apiToken: credentialString('Trello API key and token cannot be empty.'),
});

export type TrelloCredentials = z.infer<typeof trelloCredentialsSchema>;

export type TrelloClient = ReturnType<typeof createTrelloSdkClient>;

export type TrelloBoard = Pick<Board, 'id' | 'name' | 'closed' | 'dateLastActivity'>;

export type TrelloCard = Card & {
  board?: Pick<Board, 'name'>;
};

export type TrelloCommentAction = Omit<Action, 'data' | 'date' | 'memberCreator'> & {
  date?: string | Date;
  data: { text?: string };
  memberCreator?: Pick<Member, 'fullName' | 'username'>;
};

export type TrelloChecklist = Omit<Checklist, 'checkItems'> & {
  checkItems?: Array<Pick<CheckItem, 'name' | 'state' | 'pos'>>;
};

export type TrelloCardWithContext = TrelloCard & {
  actions?: TrelloCommentAction[];
  checklists?: TrelloChecklist[];
};

export type TrelloVerifiedConnection = {
  displayName?: string;
  displayDetail?: string;
  credentials: TrelloCredentials;
};
