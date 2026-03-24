import { makeAutoObservable } from 'mobx';

export class AgentsViewState {
  activeConversationId: string | undefined = undefined;

  constructor() {
    makeAutoObservable(this);
  }

  setActiveConversationId(id: string): void {
    this.activeConversationId = id;
  }
}
