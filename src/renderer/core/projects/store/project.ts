import { makeAutoObservable } from 'mobx';
import type { LocalProject, SshProject } from '@shared/projects';

export type CreatingPhase =
  | 'creating-repo' // GitHub API — new mode only
  | 'cloning' // git clone
  | 'registering' // DB insert
  | 'error';

export class CreationPendingProjectStore {
  readonly state = 'pending' as const;
  id: string;
  name: string;
  phase: CreatingPhase;
  error: string | undefined = undefined;

  constructor(id: string, name: string, phase: CreatingPhase) {
    this.id = id;
    this.name = name;
    this.phase = phase;
    makeAutoObservable(this);
  }
}

export type ActivePhase = 'opening' | 'ready' | 'error';

export class ActiveProjectStore {
  readonly state = 'ready' as const;
  id: string;
  name: string;
  phase: ActivePhase;
  data: LocalProject | SshProject;

  constructor(data: LocalProject | SshProject, phase: ActivePhase = 'opening') {
    this.id = data.id;
    this.name = data.name;
    this.data = data;
    this.phase = phase;
    makeAutoObservable(this);
  }
}

export type ProjectStore = CreationPendingProjectStore | ActiveProjectStore;
