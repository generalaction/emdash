export const FEATUREBASE_API_URL = 'https://do.featurebase.app';
export const FEATUREBASE_API_VERSION = '2026-01-01.nova';

type FeaturebaseErrorResponse = {
  error?: {
    message?: string;
    status?: number;
    type?: string;
  };
};

export class FeaturebaseHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'FeaturebaseHttpError';
  }
}

export class FeaturebaseClient {
  constructor(private readonly token: string) {}

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(path, FEATUREBASE_API_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (typeof value !== 'undefined') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Featurebase-Version': FEATUREBASE_API_VERSION,
      },
    });

    if (!response.ok) {
      let message = response.statusText || 'Featurebase request failed.';
      try {
        const body = (await response.json()) as FeaturebaseErrorResponse;
        message = body.error?.message || message;
      } catch {
        // Keep status text when the response body is not JSON.
      }
      throw new FeaturebaseHttpError(response.status, message);
    }

    return (await response.json()) as T;
  }
}
