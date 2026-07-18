import { ItemsOrderByDirection, ItemsQueryRuleOperator } from '@mondaydotcomorg/api';
import type { ColumnType, ItemsQuery } from '@mondaydotcomorg/api';
import type { MondayClient } from '../../../integrations/impl/monday/types';

export type MondayColumnValue = {
  id: string;
  type: ColumnType;
  text?: string | null;
  value?: unknown;
};

export type MondayItem = {
  id: string;
  name: string;
  updated_at?: string | null;
  group?: { title: string } | null;
  column_values: MondayColumnValue[];
};

export type MondayBoard = {
  id: string;
  name: string;
  url: string;
  items_page: { items: MondayItem[] };
};

export type MondayUpdate = {
  id: string;
  text_body?: string | null;
  created_at?: string | null;
  creator?: { name: string } | null;
};

export type MondayItemWithContext = MondayItem & {
  board: { id: string; name: string; url: string };
  updates: MondayUpdate[];
};

type MondayBoardsQuery = { boards: MondayBoard[] };

type MondayItemsQuery = { items: MondayItemWithContext[] };

type MondayDocExportQuery = {
  export_markdown_from_doc: { markdown?: string | null } | null;
};

const ITEMS_FIELDS = `
  id
  name
  updated_at
  group { title }
  column_values { id type text value }
`;

const ORDER_BY_UPDATED_AT_DESC = {
  column_id: '__last_updated__',
  direction: ItemsOrderByDirection.Desc,
};

export function updatedItemsQueryParams(): ItemsQuery {
  return { order_by: [ORDER_BY_UPDATED_AT_DESC] };
}

export function searchItemsQueryParams(term: string): ItemsQuery {
  return {
    rules: [
      {
        column_id: 'name',
        compare_value: [term],
        operator: ItemsQueryRuleOperator.ContainsText,
      },
    ],
    order_by: [ORDER_BY_UPDATED_AT_DESC],
  };
}

export async function queryMondayBoards(
  client: MondayClient,
  limit: number,
  queryParams: ItemsQuery
): Promise<MondayBoard[]> {
  const query = `query ($limit: Int!, $queryParams: ItemsQuery) {
    boards(limit: 20) { id name url items_page(limit: $limit, query_params: $queryParams) { items { ${ITEMS_FIELDS} } } }
  }`;

  const data = await client.request<MondayBoardsQuery>(query, { limit, queryParams });
  return data.boards;
}

export async function queryMondayItem(
  client: MondayClient,
  identifier: string
): Promise<MondayItemWithContext | undefined> {
  const query = `query ($itemId: [ID!]!) {
    items(ids: $itemId) {
      id name updated_at
      board { id name url }
      group { title }
      column_values { id type text value }
      updates(limit: 25) { id text_body created_at creator { name } }
    }
  }`;

  const data = await client.request<MondayItemsQuery>(query, { itemId: [identifier] });
  return data.items[0];
}

export async function exportMondayDocMarkdown(
  client: MondayClient,
  docId: string
): Promise<string | undefined> {
  const query = `query ($docId: ID!) {
    export_markdown_from_doc(docId: $docId) { markdown }
  }`;
  const data = await client.request<MondayDocExportQuery>(query, { docId });
  return data.export_markdown_from_doc?.markdown?.trim() || undefined;
}
