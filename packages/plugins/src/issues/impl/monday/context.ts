import { ColumnType } from '@mondaydotcomorg/api';
import z from 'zod';
import type { MondayClient } from '../../../integrations/impl/monday/types';
import { extractDescription } from './mapper';
import type { MondayColumnValue, MondayItemWithContext, MondayUpdate } from './queries';
import { exportMondayDocMarkdown } from './queries';

export async function getMondayIssueContext(client: MondayClient, item: MondayItemWithContext) {
  const description =
    extractDescription(item.column_values) ??
    (await fetchDocDescription(client, item.column_values));
  const context = formatMondayContext(item);
  return { description, context };
}

function formatMondayContext(item: MondayItemWithContext): string | undefined {
  const sections = [formatUpdates(item.updates)].filter(Boolean);
  return sections.length ? sections.join('\n\n') : undefined;
}

function formatUpdates(updates: MondayUpdate[]): string | undefined {
  if (!updates.length) return undefined;
  return updates
    .map((update) => {
      const author = update.creator?.name ?? 'Unknown';
      const createdAt = update.created_at ?? 'unknown time';
      return `**${author}** (${createdAt}):\n${update.text_body ?? ''}`;
    })
    .join('\n\n');
}

const DIRECT_DOC_COLUMN_TYPE = 'direct_doc';

const docColumnValueSchema = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid JSON in doc column value.' });
      return z.NEVER;
    }
  })
  .pipe(
    z.object({
      files: z.array(
        z.looseObject({
          fileType: z.string().optional(),
          objectId: z.union([z.string().min(1), z.number()]).optional(),
        })
      ),
    })
  );

async function fetchDocDescription(
  client: MondayClient,
  columnValues: MondayColumnValue[]
): Promise<string | undefined> {
  const objectId = extractDocObjectId(columnValues);
  if (!objectId) return undefined;

  try {
    return await exportMondayDocMarkdown(client, objectId);
  } catch {
    return undefined;
  }
}

function extractDocObjectId(columnValues: MondayColumnValue[]): string | undefined {
  const docColumn = columnValues.find(
    (column) => column.type === ColumnType.Doc || String(column.type) === DIRECT_DOC_COLUMN_TYPE
  );
  const parsed = docColumnValueSchema.safeParse(docColumn?.value);
  if (!parsed.success) return undefined;

  const file = parsed.data.files.find((f) => f.fileType === 'MONDAY_DOC_ITEM_DESCRIPTION');
  return file?.objectId !== undefined ? String(file.objectId) : undefined;
}
