import type { Post, PostListParams } from 'featurebase-node/resources/feedback/posts/posts';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';

export const featurebaseCredentialsSchema = z.object({
  apiKey: credentialString('Featurebase API key is required.'),
});

export type FeaturebaseCredentials = z.infer<typeof featurebaseCredentialsSchema>;

export type FeaturebaseClient = {
  feedback: {
    posts: {
      list(params?: PostListParams | null): PromiseLike<{ data: Post[] }>;
    };
  };
};

export type FeaturebaseVerifiedConnection = {
  displayName?: string;
  displayDetail?: string;
  credentials: FeaturebaseCredentials;
};
