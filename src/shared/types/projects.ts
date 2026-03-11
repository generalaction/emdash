export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  path: string;
};

export type RemoteProject = {
  type: 'remote';
  id: string;
  name: string;
  remotePath: string;
  connectionId: string;
  createdAt: string;
  updatedAt: string;
};
