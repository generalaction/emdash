export type CliStatusCode = 'connected' | 'missing' | 'needs_key' | 'error';

export interface CliProviderStatus {
  id: string;
  name: string;
  status: CliStatusCode;
  version?: string | null;
  message?: string | null;
  docUrl?: string | null;
  command?: string | null;
  installCommand?: string | null;
}
