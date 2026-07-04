import type { ThreadModel } from '@team-plain/graphql';
import type { PlainClient } from '../../../integrations/impl/plain/types';

const THREAD_REF_PATTERN = /^[A-Za-z]+-\d+$/;

export async function queryPlainThread(
  client: PlainClient,
  term: string
): Promise<ThreadModel | undefined> {
  try {
    return THREAD_REF_PATTERN.test(term)
      ? await client.query.threadByRef({ ref: term })
      : await client.query.thread({ threadId: term });
  } catch (error) {
    if (error instanceof Error && /^thread\w* not found$/.test(error.message)) return undefined;
    throw error;
  }
}
