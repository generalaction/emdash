import { makeAutoObservable, observable } from 'mobx';

class NavigationStore {
  currentViewId: string = 'home';
  viewParams = {};

  constructor() {
    makeAutoObservable(this);
  }

  navigate() {}
}

export class ProjectManagerStore {
  // handles the lifecycle of the projects
  // should manage project data and project state
}

export class ProjectStore {
  taskManager = new TaskManagerStore();
  constructor() {}
}

export class TaskManagerStore {
  tasks = observable.map<string, TaskStore>();
  // nested inside the project store
  // handles the lifecycle of the tasks
  // should manage task data
}

export class TaskStore {
  // put task view state here as well and manage the serialization and deserialization of the view state
  // has lifecycle state like pending tasks, errors, etc.
  // includes child entities like conversations, terminals, and filesystem
}

export class ConversationManagerStore {
  // nested inside the tasks store
  // handles retrieving and creating conversations for a task
}

export class ConversationStore {
  // should manage pty sessions -> state session created or not, etc.
  // should manage agent notifications in observable state so it can be bubbled up to the task store
}

export class TerminalManagerStore {
  // nested inside the tasks store
  // handles retrieving and creating terminals for a task
}

export class TerminalStore {
  // should manage pty sessions -> state session created or not, etc.
}

export class FilesystemStore {
  // manages the filetree (and updates via subscriptions and fallback polling)
  // manages open files and the interactions with the monaco-model-registry
}
