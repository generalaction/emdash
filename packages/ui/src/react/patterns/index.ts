export { ListView } from './list-view';
export type {
  ListViewSection,
  VirtualListProps,
  VirtualListHandle,
  RowProps,
  SectionHeaderProps,
  FilterPillProps,
  FilterButtonProps,
  ListSelectionState,
} from './list-view';

// ── Headless list state (createListView) ──────────────────────────────────────
export { createListView, ListViewStore } from './list-view';
export {
  matchesQuery,
  createTextMatcher,
  compareStrings,
  compareNumbers,
  compareDates,
  byField,
  chainComparators,
  useClientListFilter,
  defineSearch,
  defineFilter,
  defineSort,
  definePagination,
  defineSelection,
  defineRename,
} from './list-view';
export type {
  Comparator,
  TextMatcherOptions,
  ClientListFilterOptions,
  ListViewSpec,
  ListSource,
  SearchSpec,
  FilterSpec,
  FilterModel,
  SortSpec,
  SectionsSpec,
  PaginationSpec,
  SelectionSpec,
  RenameSpec,
  ExternalSelectionStore,
  SearchApi,
  FilterApi,
  SortApi,
  PaginationApi,
  SelectionApi,
  RenameApi,
  ScrollApi,
  ListViewApi,
  ListProps,
  StaticListProps,
  VirtualizationOptions,
  ListViewSnapshot,
  ItemContextValue,
  SectionContextValue,
  FilterModelOf,
  SortKeyOf,
} from './list-view';

export { ListPage } from './list-page';
export type {
  ListPageProps,
  ListPageBodyProps,
  ListPageSectionProps,
  ListPageSectionHeaderProps,
  ListPageSeparatorProps,
  ListPageRowProps,
  ListPageRowIconProps,
  ListPageRowContentProps,
  ListPageRowTitleProps,
  ListPageRowDescriptionProps,
  ListPageRowTrailingProps,
} from './list-page';

export { PageLayout } from './page-layout';
export type {
  PageLayoutProps,
  PageSidebarProps,
  PageContentProps,
  PageNavItem,
  PageNavDivider,
  PageNavSection,
  PageSidebarMenuItem,
  PageSidebarMenuProps,
  PageHeaderProps,
} from './page-layout';

export { SettingsCard, type SettingsCardProps } from './settings';
export { SettingsRow, type SettingsRowProps } from './settings';
