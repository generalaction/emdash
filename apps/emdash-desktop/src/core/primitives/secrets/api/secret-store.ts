export interface SecretStore {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, secret: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}
