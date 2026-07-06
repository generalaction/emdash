import type { PlaneWorkItemDetail } from '../../../integrations/impl/plane/types';
import { stripHtml } from './mapper';

export function formatPlaneContext(item: PlaneWorkItemDetail): string | undefined {
  const lines: string[] = [];
  if (item.priority) lines.push(`Priority: ${item.priority}`);

  const description = item.description_stripped ?? stripHtml(item.description_html);
  if (description) {
    lines.push('');
    lines.push(description);
  }

  return lines.length ? lines.join('\n') : undefined;
}
