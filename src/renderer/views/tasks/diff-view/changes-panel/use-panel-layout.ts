import { useLayoutEffect, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import type { ChangesViewStore, ExpandedSections } from '@renderer/core/stores/changes-view-store';

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
};

export function usePanelLayout(changesView: ChangesViewStore): usePanelLayoutReturn {
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

  const expanded = changesView.expandedSections;

  useLayoutEffect(() => {
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
  }, [expanded, unstagedRef, stagedRef, prRef, spacerRef]);

  return {
    expanded,
    toggleExpanded: (section) => changesView.toggleExpanded(section),
    setExpanded: (next) => changesView.setExpanded(next),
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
  };
}
