import { defineContract, liveModel, liveState } from '@emdash/wire';
import {
  runtimeActivityKeySchema,
  runtimeSessionsSchema,
  workspaceActivityKeySchema,
  workspaceActivitySchema,
} from './schema';

export const activityEndpoints = {
  activity: liveModel({
    key: runtimeActivityKeySchema,
    states: {
      sessions: liveState({ data: runtimeSessionsSchema }),
    },
  }),
};

export const activityProviderContract = defineContract(activityEndpoints);

export const workspaceActivityContract = defineContract({
  workspaceActivity: liveModel({
    key: workspaceActivityKeySchema,
    states: {
      activity: liveState({ data: workspaceActivitySchema }),
    },
  }),
});
