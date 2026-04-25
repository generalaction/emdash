import { makeAutoObservable } from 'mobx';
import type { TaskViewSnapshot } from '@shared/view-state';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { ConversationTabViewStore } from '@renderer/features/tasks/conversations/conversation-tab-view-store';
import { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import type { GitStore } from '@renderer/features/tasks/diff-view/stores/git-store';
import { EditorViewStore } from '@renderer/features/tasks/editor/stores/editor-view-store';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import type { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { MainPanelView, RightPanelView } from '@renderer/features/tasks/types';
import { focusTracker } from '@renderer/utils/focus-tracker';

interface TaskViewResources {
  conversations: ConversationManagerStore;
  terminals: TerminalManagerStore;
  git: GitStore;
  pr: PrStore;
  projectId: string;
  workspaceId: string;
}

export class TaskViewStore {
  view: MainPanelView;
  rightPanelView: RightPanelView;
  focusedRegion: 'main' | 'right';
  readonly conversationTabs: ConversationTabViewStore;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: EditorViewStore;
  readonly diffView: DiffViewStore;

  constructor(resources: TaskViewResources, savedSnapshot?: TaskViewSnapshot) {
    this.view = (savedSnapshot?.view as MainPanelView) ?? 'agents';
    this.rightPanelView = (savedSnapshot?.rightPanelView as RightPanelView) ?? 'changes';
    this.focusedRegion = savedSnapshot?.focusedRegion ?? 'main';

    this.conversationTabs = new ConversationTabViewStore(resources.conversations);
    this.terminalTabs = new TerminalTabViewStore(resources.terminals);
    this.editorView = new EditorViewStore(resources.projectId, resources.workspaceId);
    this.diffView = new DiffViewStore(resources.git, resources.pr);

    if (savedSnapshot?.conversations) {
      this.conversationTabs.restoreSnapshot(savedSnapshot.conversations);
    }
    if (savedSnapshot?.terminals) {
      this.terminalTabs.restoreSnapshot(savedSnapshot.terminals);
    }
    if (savedSnapshot?.editor) {
      this.editorView.restoreSnapshot(savedSnapshot.editor);
    }
    if (savedSnapshot?.diffView) {
      this.diffView.restoreSnapshot(savedSnapshot.diffView);
    }

    makeAutoObservable(this, {
      conversationTabs: false,
      terminalTabs: false,
      editorView: false,
      diffView: false,
    });
  }

  get snapshot(): TaskViewSnapshot {
    return {
      view: this.view,
      rightPanelView: this.rightPanelView,
      focusedRegion: this.focusedRegion,
      conversations: this.conversationTabs.snapshot,
      terminals: this.terminalTabs.snapshot,
      editor: this.editorView.snapshot,
      diffView: this.diffView.snapshot,
    };
  }

  setView(v: MainPanelView): void {
    if (this.view !== v) {
      focusTracker.transition({ mainPanel: v }, 'panel_switch');
    }
    this.view = v;
  }

  setRightPanelView(v: RightPanelView): void {
    if (this.rightPanelView !== v) {
      focusTracker.transition({ rightPanel: v }, 'panel_switch');
    }
    this.rightPanelView = v;
  }

  setFocusedRegion(region: 'main' | 'right'): void {
    if (this.focusedRegion !== region) {
      focusTracker.transition({ focusedRegion: region }, 'region_switch');
    }
    this.focusedRegion = region;
  }

  dispose(): void {
    this.conversationTabs.dispose();
    this.terminalTabs.dispose();
    this.editorView.dispose();
    this.diffView.dispose();
  }
}
