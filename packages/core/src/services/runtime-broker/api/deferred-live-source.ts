import type { LiveSource } from '@emdash/wire';

export function deferredLiveSource(resolve: () => LiveSource | Promise<LiveSource>): LiveSource {
  const source = Promise.resolve().then(resolve);
  source.catch(() => {});

  return {
    async snapshot() {
      return await (await source).snapshot();
    },
    async subscribe(callback, options) {
      return await (await source).subscribe(callback, options);
    },
  };
}
