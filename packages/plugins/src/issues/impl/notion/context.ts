import type { BlockObjectResponse, PartialBlockObjectResponse } from '@notionhq/client';
import { richTextPlainText } from './mapper';

export function formatNotionContext(
  blocks: Array<BlockObjectResponse | PartialBlockObjectResponse>
): string | undefined {
  const lines = blocks.map(blockToMarkdown).filter((line): line is string => !!line?.trim());
  return lines.length ? lines.join('\n') : undefined;
}

function blockToMarkdown(
  block: BlockObjectResponse | PartialBlockObjectResponse
): string | undefined {
  if (!('type' in block)) return undefined;

  switch (block.type) {
    case 'paragraph':
      return richTextPlainText('paragraph' in block ? block.paragraph?.rich_text : undefined);
    case 'heading_1':
      return heading(
        '#',
        richTextPlainText('heading_1' in block ? block.heading_1?.rich_text : undefined)
      );
    case 'heading_2':
      return heading(
        '##',
        richTextPlainText('heading_2' in block ? block.heading_2?.rich_text : undefined)
      );
    case 'heading_3':
      return heading(
        '###',
        richTextPlainText('heading_3' in block ? block.heading_3?.rich_text : undefined)
      );
    case 'heading_4':
      return heading(
        '####',
        richTextPlainText('heading_4' in block ? block.heading_4?.rich_text : undefined)
      );
    case 'bulleted_list_item':
      return listItem(
        '-',
        richTextPlainText(
          'bulleted_list_item' in block ? block.bulleted_list_item?.rich_text : undefined
        )
      );
    case 'numbered_list_item':
      return listItem(
        '1.',
        richTextPlainText(
          'numbered_list_item' in block ? block.numbered_list_item?.rich_text : undefined
        )
      );
    case 'to_do':
      if (!('to_do' in block)) return undefined;
      return listItem(
        `[${block.to_do?.checked ? 'x' : ' '}]`,
        richTextPlainText(block.to_do?.rich_text)
      );
    case 'quote':
      return quote(richTextPlainText('quote' in block ? block.quote?.rich_text : undefined));
    case 'code':
      if (!('code' in block)) return undefined;
      return codeBlock(block.code?.language ?? '', richTextPlainText(block.code?.rich_text));
    case 'child_page':
      return 'child_page' in block && block.child_page?.title
        ? `Child page: ${block.child_page.title}`
        : undefined;
    case 'child_database':
      return 'child_database' in block && block.child_database?.title
        ? `Child database: ${block.child_database.title}`
        : undefined;
    default:
      return undefined;
  }
}

function heading(prefix: string, text: string): string | undefined {
  return text ? `${prefix} ${text}` : undefined;
}

function listItem(prefix: string, text: string): string | undefined {
  return text ? `${prefix} ${text}` : undefined;
}

function quote(text: string): string | undefined {
  return text ? `> ${text}` : undefined;
}

function codeBlock(language: string, text: string): string | undefined {
  return text ? `\`\`\`${language}\n${text}\n\`\`\`` : undefined;
}
