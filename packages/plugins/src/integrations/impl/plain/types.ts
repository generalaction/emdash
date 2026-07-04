import type {
  PlainClient as PlainSdkClient,
  SearchThreadsQuery,
  ThreadModel,
} from '@team-plain/graphql';
import z from 'zod';
import { credentialString } from '../../helpers/credentials';

export const plainCredentialsSchema = z.object({
  apiKey: credentialString('Plain API key cannot be empty.'),
});

export type PlainCredentials = z.infer<typeof plainCredentialsSchema>;

export type PlainClient = PlainSdkClient;

export type PlainSearchThread =
  SearchThreadsQuery['searchThreads']['edges'][number]['node']['thread'];

export type PlainThread = ThreadModel | PlainSearchThread;

export type PlainVerifiedConnection = {
  displayName?: string;
  credentials: PlainCredentials;
};
