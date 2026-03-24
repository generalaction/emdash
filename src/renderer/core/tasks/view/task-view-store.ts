import { makeAutoObservable, observable } from 'mobx';
import { MainPanelView, RightPanelView } from '../types';
import { AgentsViewState } from './agent-view-store';
import { EditorViewStore } from './editor-view-store';
import { TerminalsViewState } from './terminal-view-store';

export class TaskViewState {
  view: MainPanelView = 'agents';
  rightPanelView: RightPanelView = 'changes';
  agentsView = new AgentsViewState();
  terminalsView = new TerminalsViewState();
  editorView = new EditorViewStore();

  constructor() {
    makeAutoObservable(this);
  }

  setView(v: MainPanelView): void {
    this.view = v;
  }

  setRightPanelView(v: RightPanelView): void {
    this.rightPanelView = v;
  }
}

class TaskViewStateStore {
  private readonly map = observable.map<string, TaskViewState>();

  getOrCreate(taskId: string): TaskViewState {
    if (!this.map.has(taskId)) {
      this.map.set(taskId, new TaskViewState());
    }
    return this.map.get(taskId)!;
  }

  delete(taskId: string): void {
    this.map.delete(taskId);
  }
}

export const taskViewStateStore = new TaskViewStateStore();
