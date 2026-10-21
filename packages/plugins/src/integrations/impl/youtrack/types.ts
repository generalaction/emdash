import type { YouTrack as YouTrackSdkClient } from 'youtrack-client';
import z from 'zod';
import type { VerifiedAccountIdentity } from '../../capabilities/auth';
import { credentialString } from '../../helpers/credentials';
import { normalizeHostedInstanceUrl } from '../../helpers/hosted-instance';

export const youTrackCredentialsSchema = z.object({
  instanceUrl: credentialString('A valid YouTrack instance URL is required.')
    .refine((value) => {
      try {
        const url = new URL(value);
        return !url.username && !url.password;
      } catch {
        return true;
      }
    }, 'YouTrack instance URL must not contain credentials.')
    .transform(normalizeHostedInstanceUrl)
    .pipe(z.string('A valid YouTrack HTTP(S) instance URL is required.')),
  apiToken: credentialString('A YouTrack permanent token is required.'),
});

export type YouTrackCredentials = z.infer<typeof youTrackCredentialsSchema>;

export type YouTrackClient = YouTrackSdkClient;

export type YouTrackVerifiedConnection = {
  account: VerifiedAccountIdentity;
  displayName: string;
  displayDetail: string;
  credentials: YouTrackCredentials;
};

export const youTrackUserSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  fullName: z.string().nullable(),
});
