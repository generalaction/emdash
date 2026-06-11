import { useLayoutEffect, useRef, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import type {
  ChangesViewStore,
  ExpandedSections,
} from '@renderer/features/tasks/diff-view/stores/changes-view-store';

// Unreachable in practice: callers guard with `if (!changesView) return null` before calling this
// hook, so changesView is always non-null here. React Hooks rules prevent a conditional call.
const DEFAULT_EXPANDED: ExpandedSections = { unstaged: true, staged: true, pullRequests: true };

// Matches the SectionHeader height: outer py-2 (8+8px) + button p-2 (8+8px) + size-4 icon (16px) = 48px
export const SECTION_HEADER_HEIGHT = '40px';

type usePanelLayoutReturn = {
  expanded: ExpandedSections;
  toggleExpanded: (section: keyof ExpandedSections) => void;
  setExpanded: (next: ExpandedSections | ((prev: ExpandedSections) => ExpandedSections)) => void;
  panelTransitionClass: string | false;
  pointerHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
  unstagedRef: ReturnType<typeof usePanelRef>;
  stagedRef: ReturnType<typeof usePanelRef>;
  prRef: ReturnType<typeof usePanelRef>;
  spacerRef: ReturnType<typeof usePanelRef>;
  containerRef: React.RefObject<HTMLDivElement | null>;
};

export function usePanelLayout(
  changesView: ChangesViewStore | null,
  isVisible: boolean
): usePanelLayoutReturn {
  const unstagedRef = usePanelRef();
  const stagedRef = usePanelRef();
  const prRef = usePanelRef();
  const spacerRef = usePanelRef();

  const [isDragging, setIsDragging] = useState(false);

  const panelTransitionClass = !isDragging && '[transition:flex-basis_200ms_ease-in-out]';
  const pointerHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
    },
    onPointerUp: () => setIsDragging(false),
    onPointerCancel: () => setIsDragging(false),
  };

  const expanded = changesView?.expandedSections ?? DEFAULT_EXPANDED;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const appliedExpanded = useRef<ExpandedSections | null>(null);

  useLayoutEffect(() => {
    // The panel stays mounted under `display: none` while the sidebar is hidden, and imperative
    // resize/collapse calls against a zero-size group make react-resizable-panels compute NaN
    // percentages that survive reopening (ENG-1559). Only apply the layout while visible; a state
    // change that arrives while hidden is applied when isVisible flips back. A ResizeObserver
    // cannot replace the flag here: Chromium delivers no resize event when an ancestor toggles
    // display:none. The offsetHeight check covers hide paths the flag does not know about, and
    // skipping already-applied states keeps user drag-resizes intact across hide/show.
    // Reference equality is intentional: ChangesViewStore replaces the whole expandedSections
    // object on every mutation, so a stable reference means "nothing changed". Returning fresh
    // object literals per render here would re-apply the layout on every reveal and reset drags.
    if (!isVisible || appliedExpanded.current === expanded) return;
    if ((containerRef.current?.offsetHeight ?? 0) === 0) return;
    appliedExpanded.current = expanded;

    const sections = [
      { key: 'unstaged' as const, ref: unstagedRef },
      { key: 'staged' as const, ref: stagedRef },
      { key: 'pullRequests' as const, ref: prRef },
    ];

    const expandedCount = sections.filter((s) => expanded[s.key]).length;
    const share = expandedCount > 0 ? `${100 / expandedCount}%` : '0%';

    spacerRef.current?.resize(expandedCount === 0 ? '100%' : '0%');

    sections.forEach(({ key, ref }) => {
      if (expanded[key]) {
        ref.current?.resize(share);
      } else {
        ref.current?.collapse();
      }
    });
  }, [expanded, isVisible, unstagedRef, stagedRef, prRef, spacerRef]);

  return {
    expanded,
    toggleExpanded: (section) => changesView?.toggleExpanded(section),
    setExpanded: (next) => changesView?.setExpanded(next),
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
    containerRef,
  };
}
