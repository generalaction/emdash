export declare function generateApiKey(): string;
export declare function generateWebhookToken(): string;
export declare function createHmacSignature(secret: string, payload: string): string;
export declare function verifyGithubSignature(secret: string, payload: string, signature: string | undefined): boolean;
