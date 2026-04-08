import { makeAutoObservable } from 'mobx';
import type { TaskViewSnapshot } from '@shared/view-state';
import { MainPanelView, RightPanelView } from '../tasks/types';

export class TaskViewStore {
  view: MainPanelView;
  rightPanelView: RightPanelView;
  focusedRegion: 'main' | 'right';

  constructor(savedSnapshot?: Pick<TaskViewSnapshot, 'view' | 'rightPanelView' | 'focusedRegion'>) {
    this.view = (savedSnapshot?.view as MainPanelView) ?? 'agents';
    this.rightPanelView = (savedSnapshot?.rightPanelView as RightPanelView) ?? 'changes';
    this.focusedRegion = savedSnapshot?.focusedRegion ?? 'main';
    makeAutoObservable(this);
  }

  get snapshot(): Pick<TaskViewSnapshot, 'view' | 'rightPanelView' | 'focusedRegion'> {
    return {
      view: this.view,
      rightPanelView: this.rightPanelView,
      focusedRegion: this.focusedRegion,
    };
  }

  setView(v: MainPanelView): void {
    this.view = v;
  }

  setRightPanelView(v: RightPanelView): void {
    this.rightPanelView = v;
  }

  setFocusedRegion(region: 'main' | 'right'): void {
    this.focusedRegion = region;
  }
}
