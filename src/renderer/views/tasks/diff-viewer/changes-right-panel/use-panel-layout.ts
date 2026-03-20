import React, { useLayoutEffect, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';

// Matches the SectionHeader height: outer py-2 (8+8px) + button p-2 (8+8px) + size-4 icon (16px) = 48px
export const SECTION_HEADER_HEIGHT = '3rem';

export type ExpandedState = {
  unstaged: boolean;
  staged: boolean;
  pullRequests: boolean;
};

type usePanelLayoutReturn = {
  expanded: ExpandedState;
  toggleExpanded: (section: keyof ExpandedState) => void;
  setExpanded: React.Dispatch<React.SetStateAction<ExpandedState>>;
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

export function usePanelLayout(): usePanelLayoutReturn {
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

  const [expanded, setExpanded] = useState<ExpandedState>({
    unstaged: true,
    staged: true,
    pullRequests: true,
  });

  const toggleExpanded = (section: keyof ExpandedState) =>
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

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
    toggleExpanded,
    setExpanded,
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
  };
}
