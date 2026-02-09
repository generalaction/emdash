type Listener = (hasTerminal: boolean) => void;

class TerminalLivenessStore {
  private activePtys = new Map<string, Set<string>>();
  private listeners = new Map<string, Set<Listener>>();
  private seeded = false;
  // Buffer exits that arrive before seed completes (race guard)
  private earlyExits = new Set<string>();
  private subscribed = false;

  private ensureSubscribed() {
    if (this.subscribed) return;
    this.subscribed = true;

    const api = window.electronAPI;
    if (!api) return;

    // taskId is non-null only for -main- terminals (getPtyTaskId regex on the main process)
    api.onPtyStarted?.((data) => {
      if (!data.taskId) return;
      this.addPty(data.taskId, data.id);
    });

    api.onPtyExited?.((data) => {
      if (!this.seeded) this.earlyExits.add(data.id);
      if (!data.taskId) return;
      this.removePty(data.taskId, data.id);
    });

    // Seed from currently running PTYs (handles app reload)
    api.ptyList?.()
      .then((items) => {
        for (const { id, taskId } of items) {
          if (!taskId) continue;
          if (this.earlyExits.has(id)) continue;
          this.addPty(taskId, id);
        }
        this.seeded = true;
        this.earlyExits.clear();
      })
      .catch(() => {
        this.seeded = true;
        this.earlyExits.clear();
      });
  }

  private addPty(taskId: string, ptyId: string) {
    let set = this.activePtys.get(taskId);
    if (!set) {
      set = new Set();
      this.activePtys.set(taskId, set);
    }
    const hadTerminal = set.size > 0;
    set.add(ptyId);
    if (!hadTerminal) this.emit(taskId, true);
  }

  private removePty(taskId: string, ptyId: string) {
    const set = this.activePtys.get(taskId);
    if (!set) return;
    set.delete(ptyId);
    if (set.size === 0) {
      this.activePtys.delete(taskId);
      this.emit(taskId, false);
    }
  }

  private emit(taskId: string, hasTerminal: boolean) {
    const ls = this.listeners.get(taskId);
    if (!ls) return;
    for (const fn of ls) {
      try { fn(hasTerminal); } catch {}
    }
  }

  subscribe(taskId: string, fn: Listener): () => void {
    this.ensureSubscribed();
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(fn);
    // Emit current state
    fn((this.activePtys.get(taskId)?.size ?? 0) > 0);

    return () => {
      const s = this.listeners.get(taskId);
      if (s) {
        s.delete(fn);
        if (s.size === 0) this.listeners.delete(taskId);
      }
    };
  }
}

export const terminalLivenessStore = new TerminalLivenessStore();
