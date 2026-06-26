import { ListViewRoot, Toolbar, FilterPills, Body, Footer } from './list-view';
import { VirtualList } from './virtual-list';
import { Row, SectionHeader } from './list-row';
import { FilterButton, FilterPill } from './filter-pill';
import { useListSelection } from './use-list-selection';

// ── Public namespace ──────────────────────────────────────────────────────────

/**
 * ListView — a namespaced, virtualized, composable list pattern.
 *
 * Usage:
 * ```tsx
 * <ListView>
 *   <ListView.Toolbar>
 *     <SearchInput ... />
 *   </ListView.Toolbar>
 *   <ListView.FilterPills>
 *     <ListView.FilterPill label="open" onRemove={...} />
 *   </ListView.FilterPills>
 *   <ListView.Body>
 *     <ListView.List
 *       items={myItems}
 *       getItemKey={i => i.id}
 *       renderItem={item => (
 *         <ListView.Row interactive>...</ListView.Row>
 *       )}
 *     />
 *   </ListView.Body>
 * </ListView>
 * ```
 */
export const ListView = Object.assign(ListViewRoot, {
  Toolbar,
  FilterPills,
  Body,
  Footer,
  List: VirtualList,
  Row,
  SectionHeader,
  FilterButton,
  FilterPill,
  useSelection: useListSelection,
});

// ── Re-export types ───────────────────────────────────────────────────────────

export type { ListViewSection, VirtualListProps, VirtualListHandle } from './virtual-list';
export type { RowProps, SectionHeaderProps } from './list-row';
export type { FilterPillProps, FilterButtonProps } from './filter-pill';
export type { ListSelectionState } from './use-list-selection';
