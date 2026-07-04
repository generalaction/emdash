import { TasksApi, UsersApi } from 'asana';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';

export const asanaCredentialsSchema = z.object({
  accessToken: credentialString('Access token is required'),
});

export type AsanaCredentials = z.infer<typeof asanaCredentialsSchema>;

export type AsanaClient = {
  users: UsersApi;
  tasks: TasksApi;
};

export type AsanaWorkspace = {
  gid: string;
  name?: string;
};

export type AsanaNamedResource = {
  gid?: string;
  name?: string;
};

export type AsanaTask = {
  gid: string;
  name?: string;
  notes?: string;
  permalinkUrl?: string;
  completed?: boolean;
  modifiedAt?: string;
  assignee?: AsanaNamedResource | null;
  projects?: AsanaNamedResource[];
  memberships?: Array<{
    section?: AsanaNamedResource | null;
    project?: AsanaNamedResource | null;
  }>;
};

export type RawAsanaTask = {
  gid?: string;
  name?: string;
  notes?: string;
  permalink_url?: string;
  completed?: boolean;
  modified_at?: string;
  assignee?: AsanaNamedResource | null;
  projects?: AsanaNamedResource[];
  memberships?: Array<{
    section?: AsanaNamedResource | null;
    project?: AsanaNamedResource | null;
  }>;
};

export type AsanaUser = {
  gid?: string;
  name?: string;
  workspaces?: AsanaWorkspace[];
};

export type AsanaSearchTasksOpts = NonNullable<
  Parameters<TasksApi['searchTasksForWorkspace']>[1]
> & {
  limit: number;
};

export type AsanaVerifiedConnection = {
  account?: {
    id: string;
    login: string;
  };
  displayName?: string;
  displayDetail?: string;
  credentials: AsanaCredentials;
};

export type AsanaResponse<T> = {
  data?: T;
};
