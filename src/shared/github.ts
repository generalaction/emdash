export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export type GitHubTokenSource = 'secure_storage' | 'cli' | null;

export interface GitHubStatusResponse {
  authenticated: boolean;
  user: GitHubUser | null;
  tokenSource: GitHubTokenSource;
}

export interface GitHubAuthResponse {
  success: boolean;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
}

export interface GitHubConnectResponse {
  success: boolean;
  token?: string;
  user?: GitHubUser;
  error?: string;
}
