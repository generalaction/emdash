export interface FindTarget {
  id: string;
  openFind: () => void;
}

/**
 * Tracks which find-capable surface (terminal, markdown preview, file tree,
 * browser, list search, ...) is currently focused, so the single global
 * `find` command can activate the right one without knowing about any of
 * them directly.
 */
export class FindTargetRegistry {
  private targets = new Map<string, FindTarget>();
  private activeId: string | null = null;
  // Whether activeId was claimed because a target's container genuinely has
  // DOM focus, vs. merely because it became visible (see setActive below).
  private activeIsFocused = false;

  register(target: FindTarget): () => void {
    this.targets.set(target.id, target);
    return () => {
      this.targets.delete(target.id);
      if (this.activeId === target.id) {
        this.activeId = null;
        this.activeIsFocused = false;
      }
    };
  }

  /**
   * `focused: true` (focusin/mouseenter/initial-focus) always wins, including
   * over another target's existing focus claim, since it reflects genuine
   * user intent right now. `focused: false` (IntersectionObserver visibility)
   * is a fallback for panels that become visible without moving DOM focus
   * (e.g. a `display:none` sidebar panel toggled by clicking a tab) — it must
   * not steal activation from a target the user is still actually focused
   * in, or two simultaneously-visible surfaces (e.g. a chat transcript and an
   * embedded terminal in the same tab) would race on mount/observer order
   * instead of reflecting where the user actually clicked.
   */
  setActive(id: string | null, options: { focused?: boolean } = {}): void {
    const focused = options.focused ?? true;
    if (!focused && this.activeIsFocused && this.activeId !== id) return;
    this.activeId = id;
    this.activeIsFocused = id !== null && focused;
  }

  /** Invoked by the `find` command. Returns true if a target handled it. */
  activate(): boolean {
    const target = this.activeId ? this.targets.get(this.activeId) : undefined;
    if (!target) return false;
    target.openFind();
    return true;
  }
}

export const findTargetRegistry = new FindTargetRegistry();
