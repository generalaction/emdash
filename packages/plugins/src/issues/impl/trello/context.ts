import type {
  TrelloCardWithContext,
  TrelloChecklist,
  TrelloCommentAction,
} from '../../../integrations/impl/trello/types';
import { formatTrelloDate } from './mapper';

export function formatTrelloContext(card: TrelloCardWithContext): string | undefined {
  const sections = [formatChecklists(card.checklists), formatComments(card.actions)].filter(
    Boolean
  );
  return sections.length ? sections.join('\n\n') : undefined;
}

function formatChecklists(checklists: TrelloChecklist[] | undefined): string | undefined {
  if (!checklists?.length) return undefined;

  return checklists
    .map((checklist) => {
      const items = [...(checklist.checkItems ?? [])]
        .sort((a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0))
        .map((item) => `- [${item.state === 'complete' ? 'x' : ' '}] ${item.name ?? ''}`);
      return [`Checklist: ${checklist.name ?? ''}`, ...items].join('\n');
    })
    .join('\n\n');
}

function formatComments(actions: TrelloCommentAction[] | undefined): string | undefined {
  const comments = (actions ?? []).filter((action) => action.data.text?.trim());
  if (!comments.length) return undefined;

  return comments
    .map((action) => {
      const author = action.memberCreator?.fullName ?? action.memberCreator?.username ?? 'Unknown';
      return `**${author}** (${formatTrelloDate(action.date) ?? ''}):\n${action.data.text}`;
    })
    .join('\n\n');
}
