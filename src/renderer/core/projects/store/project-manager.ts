import { makeAutoObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { LocalProject, SshProject } from '@shared/projects';
import { rpc } from '@renderer/core/ipc';
import {
  ActiveProjectStore,
  CreatingPhase,
  CreationPendingProjectStore,
  ProjectStore,
} from './project';

interface BaseModeData {
  name: string;
  path: string;
}

export interface PickModeData extends BaseModeData {
  mode: 'pick';
}

export interface CloneModeData extends BaseModeData {
  mode: 'clone';
  repositoryUrl: string;
}

export interface NewModeData extends BaseModeData {
  mode: 'new';
  repositoryName: string;
  repositoryOwner: string;
  repositoryVisibility: 'public' | 'private';
}

export type ModeData = PickModeData | CloneModeData | NewModeData;

export type ProjectType = { type: 'local' } | { type: 'ssh'; connectionId: string };

class ProjectManagerStore {
  isLoading = false;
  projects = observable.map<string, ProjectStore>();

  constructor() {
    makeAutoObservable(this, { projects: false });
    onBecomeObserved(this, 'projects', () => this.load());
  }

  async load(): Promise<void> {
    runInAction(() => {
      this.isLoading = true;
    });
    try {
      const rawProjects = await rpc.projects.getProjects();
      runInAction(() => {
        for (const p of rawProjects) {
          const existing = this.projects.get(p.id);
          if (existing) continue;
          this.projects.set(p.id, new ActiveProjectStore(p));
        }
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async createProject(projectType: ProjectType, data: ModeData): Promise<string | undefined> {
    if (projectType.type === 'local') {
      const existing = await rpc.projects.getLocalProjectByPath(data.path);
      if (existing) return existing.id;
    } else {
      const existing = await rpc.projects.getSshProjectByPath(data.path, projectType.connectionId);
      if (existing) return existing.id;
    }

    const id = crypto.randomUUID();
    switch (data.mode) {
      case 'pick': {
        runInAction(() => {
          this.projects.set(id, new CreationPendingProjectStore(id, data.name, 'registering'));
        });
        try {
          const project = await rpc.projects.createLocalProject({
            id,
            path: data.path,
            name: data.name,
          });
          this._setAndOpenProject(id, project);
        } catch (err) {
          this._markError(id, err);
          throw err;
        }
        break;
      }

      case 'clone': {
        runInAction(() => {
          this.projects.set(id, new CreationPendingProjectStore(id, data.name, 'cloning'));
        });
        try {
          const clonePath = `${data.path}/${data.name}`;
          const cloneResult = await rpc.github.cloneRepository(data.repositoryUrl, clonePath);
          if (!cloneResult.success) throw new Error(cloneResult.error);
          this._updatePhase(id, 'registering');
          const project = await rpc.projects.createLocalProject({
            id,
            path: clonePath,
            name: data.name,
          });
          this._setAndOpenProject(id, project);
        } catch (err) {
          this._markError(id, err);
          throw err;
        }
        break;
      }

      case 'new': {
        runInAction(() => {
          this.projects.set(id, new CreationPendingProjectStore(id, data.name, 'creating-repo'));
        });
        try {
          const repoResult = await rpc.github.createNewProject({
            name: data.repositoryName,
            owner: data.repositoryOwner,
            isPrivate: data.repositoryVisibility === 'private',
          });
          if (!repoResult.success || !repoResult.repoUrl) throw new Error(repoResult.error);
          this._updatePhase(id, 'cloning');
          const clonePath = `${data.path}/${data.name}`;
          const cloneResult = await rpc.github.cloneRepository(repoResult.repoUrl, clonePath);
          if (!cloneResult.success) throw new Error(cloneResult.error);
          this._updatePhase(id, 'registering');
          const project = await rpc.projects.createLocalProject({
            id,
            path: clonePath,
            name: data.name,
          });
          this._setAndOpenProject(id, project);
        } catch (err) {
          this._markError(id, err);
          throw err;
        }
        break;
      }
    }

    return id;
  }

  async openProject(projectId: string): Promise<void> {
    // need to make idempotent
    // store the promise in a map, and check if it's already in the map
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    try {
      await rpc.projects.openProject(projectId);
    } catch (err) {
      this._markError(projectId, err);
      throw err;
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const snapshot = this.projects.get(projectId);
    runInAction(() => this.projects.delete(projectId));
    try {
      await rpc.projects.deleteProject(projectId);
    } catch (err) {
      runInAction(() => {
        if (snapshot) this.projects.set(projectId, snapshot);
      });
      throw err;
    }
  }

  private _setAndOpenProject(id: string, project: LocalProject | SshProject): void {
    runInAction(() => {
      this.projects.set(id, new ActiveProjectStore(project));
      this.openProject(id);
    });
  }

  private _updatePhase(id: string, phase: CreatingPhase): void {
    runInAction(() => {
      const store = this.projects.get(id);
      if (store?.state === 'pending') store.phase = phase;
    });
  }

  private _markError(id: string, err: unknown): void {
    runInAction(() => {
      const store = this.projects.get(id);
      if (store?.state === 'pending') {
        store.phase = 'error';
        store.error = err instanceof Error ? err.message : String(err);
      }
    });
  }
}

export const projectManagerStore = new ProjectManagerStore();
