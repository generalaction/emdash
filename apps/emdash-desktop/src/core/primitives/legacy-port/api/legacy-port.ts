export type LegacyImportSource = 'v0' | 'v1-beta';

export type ProjectIdentityKind = 'local' | 'ssh';

export type LegacyPortPreviewSource = {
  available: boolean;
  projects: number;
  tasks: number;
};

export type SourceProjectInfo = {
  id: string;
  identityKey: string;
  kind: ProjectIdentityKind;
  name: string;
  path: string;
  taskCount: number;
  updatedAt: string | null;
  sshConnectionId: string | null;
  gitRemoteKeys: string[];
};

export type LegacyProjectConflict = {
  identityKey: string;
  kind: ProjectIdentityKind;
  v0: SourceProjectInfo;
  v1Beta: SourceProjectInfo;
};

export type LegacyPortPreview = {
  sources: {
    v0: LegacyPortPreviewSource;
    v1Beta: LegacyPortPreviewSource;
  };
  conflicts: LegacyProjectConflict[];
  projects: number;
  tasks: number;
};
