import {
  withTimeout as withRequestTimeout,
  type SignalContext,
  type SignalHandler,
  type WithTimeoutOptions,
} from '@emdash/shared/requests';
import { TimeoutError } from '@emdash/shared/scheduling';
import { WireError } from './protocol';

export type { WithTimeoutOptions } from '@emdash/shared/requests';

export function withTimeout(options: WithTimeoutOptions) {
  return function <I, O, C extends SignalContext>(
    next: SignalHandler<I, O, C>
  ): SignalHandler<I, O, C> {
    const timed = withRequestTimeout(options)(next);
    return async (input, context) => {
      try {
        return await timed(input, context);
      } catch (error) {
        if (error instanceof TimeoutError) {
          throw new WireError('TIMEOUT', error.message, { cause: error });
        }
        throw error;
      }
    };
  };
}
