import { Body, ListPageRoot } from './list-page';
import { Row, RowContent, RowDescription, RowIcon, RowTitle, RowTrailing } from './list-page-row';
import { Section, SectionHeader, Separator } from './list-page-section';

/**
 * ListPage — styled list content for `PageLayout` pages.
 *
 * Compose it with a headless `createListView` instance by placing the view's
 * `Root` above the entire page. This lets controls in `PageLayout.Header`
 * consume the same search, filter, and sort state as the rendered list.
 *
 * ```tsx
 * <agentView.Root>
 *   <PageLayout>
 *     <PageLayout.Content>
 *       <PageLayout.Header actions={<AgentsToolbar />} title="Agents" />
 *       <ListPage>
 *         <ListPage.Body>
 *           <agentView.List renderItem={(agent) => <AgentRow agent={agent} />} />
 *         </ListPage.Body>
 *       </ListPage>
 *     </PageLayout.Content>
 *   </PageLayout>
 * </agentView.Root>
 * ```
 */
export const ListPage = Object.assign(ListPageRoot, {
  Body,
  Section,
  SectionHeader,
  Separator,
  Row,
  RowIcon,
  RowContent,
  RowTitle,
  RowDescription,
  RowTrailing,
});

export type { ListPageBodyProps, ListPageProps } from './list-page';
export type {
  ListPageRowContentProps,
  ListPageRowDescriptionProps,
  ListPageRowIconProps,
  ListPageRowProps,
  ListPageRowTitleProps,
  ListPageRowTrailingProps,
} from './list-page-row';
export type {
  ListPageSectionHeaderProps,
  ListPageSectionProps,
  ListPageSeparatorProps,
} from './list-page-section';
