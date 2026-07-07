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
      return richTextPlainText(block.paragraph.rich_text);
    case 'heading_1':
      return heading('#', richTextPlainText(block.heading_1.rich_text));
    case 'heading_2':
      return heading('##', richTextPlainText(block.heading_2.rich_text));
    case 'heading_3':
      return heading('###', richTextPlainText(block.heading_3.rich_text));
    case 'heading_4':
      return heading('####', richTextPlainText(block.heading_4.rich_text));
    case 'bulleted_list_item':
      return listItem('-', richTextPlainText(block.bulleted_list_item.rich_text));
    case 'numbered_list_item':
      return listItem('1.', richTextPlainText(block.numbered_list_item.rich_text));
    case 'to_do':
      return listItem(
        `[${block.to_do.checked ? 'x' : ' '}]`,
        richTextPlainText(block.to_do.rich_text)
      );
    case 'quote':
      return quote(richTextPlainText(block.quote.rich_text));
    case 'code':
      return codeBlock(block.code.language, richTextPlainText(block.code.rich_text));
    case 'child_page':
      return `Child page: ${block.child_page.title}`;
    case 'child_database':
      return `Child database: ${block.child_database.title}`;
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
