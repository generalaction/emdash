export const ASANA_API_URL = 'https://app.asana.com/api/1.0';

type AsanaErrorResponse = {
  errors?: Array<{ message?: string }>;
};

export class AsanaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'AsanaHttpError';
  }
}

export class AsanaClient {
  constructor(private readonly token: string) {}

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${ASANA_API_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (typeof value !== 'undefined') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      let message = response.statusText || 'Asana request failed.';
      try {
        const body = (await response.json()) as AsanaErrorResponse;
        message = body.errors?.[0]?.message || message;
      } catch {
        // Response body was not JSON — keep the status text.
      }
      throw new AsanaHttpError(response.status, message);
    }

    return (await response.json()) as T;
  }
}
