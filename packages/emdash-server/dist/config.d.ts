import { z } from 'zod';
declare const routeSchema: z.ZodObject<{
    match: z.ZodObject<{
        header: z.ZodOptional<z.ZodString>;
        payload: z.ZodOptional<z.ZodString>;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        header?: string | undefined;
        payload?: string | undefined;
    }, {
        value: string;
        header?: string | undefined;
        payload?: string | undefined;
    }>;
    automationToken: z.ZodString;
    fanOut: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    match: {
        value: string;
        header?: string | undefined;
        payload?: string | undefined;
    };
    automationToken: string;
    fanOut: boolean;
}, {
    match: {
        value: string;
        header?: string | undefined;
        payload?: string | undefined;
    };
    automationToken: string;
    fanOut?: boolean | undefined;
}>;
declare const automationSchema: z.ZodObject<{
    token: z.ZodString;
    repoPath: z.ZodString;
    prompt: z.ZodString;
    image: z.ZodDefault<z.ZodString>;
    push: z.ZodDefault<z.ZodBoolean>;
    branch: z.ZodOptional<z.ZodString>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    push: boolean;
    token: string;
    repoPath: string;
    prompt: string;
    image: string;
    timeoutMs: number;
    branch?: string | undefined;
}, {
    token: string;
    repoPath: string;
    prompt: string;
    push?: boolean | undefined;
    image?: string | undefined;
    branch?: string | undefined;
    timeoutMs?: number | undefined;
}>;
declare const runnerSchema: z.ZodDefault<z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    pollIntervalMs: z.ZodDefault<z.ZodNumber>;
    maxConcurrent: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    pollIntervalMs: number;
    maxConcurrent: number;
}, {
    enabled?: boolean | undefined;
    pollIntervalMs?: number | undefined;
    maxConcurrent?: number | undefined;
}>>;
export declare const configSchema: z.ZodObject<{
    apiKey: z.ZodString;
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    dbPath: z.ZodString;
    signingSecrets: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    routes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        match: z.ZodObject<{
            header: z.ZodOptional<z.ZodString>;
            payload: z.ZodOptional<z.ZodString>;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            header?: string | undefined;
            payload?: string | undefined;
        }, {
            value: string;
            header?: string | undefined;
            payload?: string | undefined;
        }>;
        automationToken: z.ZodString;
        fanOut: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        match: {
            value: string;
            header?: string | undefined;
            payload?: string | undefined;
        };
        automationToken: string;
        fanOut: boolean;
    }, {
        match: {
            value: string;
            header?: string | undefined;
            payload?: string | undefined;
        };
        automationToken: string;
        fanOut?: boolean | undefined;
    }>, "many">>;
    claudeOauthToken: z.ZodOptional<z.ZodString>;
    runner: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        pollIntervalMs: z.ZodDefault<z.ZodNumber>;
        maxConcurrent: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        pollIntervalMs: number;
        maxConcurrent: number;
    }, {
        enabled?: boolean | undefined;
        pollIntervalMs?: number | undefined;
        maxConcurrent?: number | undefined;
    }>>;
    automations: z.ZodDefault<z.ZodArray<z.ZodObject<{
        token: z.ZodString;
        repoPath: z.ZodString;
        prompt: z.ZodString;
        image: z.ZodDefault<z.ZodString>;
        push: z.ZodDefault<z.ZodBoolean>;
        branch: z.ZodOptional<z.ZodString>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        push: boolean;
        token: string;
        repoPath: string;
        prompt: string;
        image: string;
        timeoutMs: number;
        branch?: string | undefined;
    }, {
        token: string;
        repoPath: string;
        prompt: string;
        push?: boolean | undefined;
        image?: string | undefined;
        branch?: string | undefined;
        timeoutMs?: number | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    apiKey: string;
    port: number;
    host: string;
    dbPath: string;
    signingSecrets: Record<string, string>;
    routes: {
        match: {
            value: string;
            header?: string | undefined;
            payload?: string | undefined;
        };
        automationToken: string;
        fanOut: boolean;
    }[];
    runner: {
        enabled: boolean;
        pollIntervalMs: number;
        maxConcurrent: number;
    };
    automations: {
        push: boolean;
        token: string;
        repoPath: string;
        prompt: string;
        image: string;
        timeoutMs: number;
        branch?: string | undefined;
    }[];
    claudeOauthToken?: string | undefined;
}, {
    apiKey: string;
    dbPath: string;
    port?: number | undefined;
    host?: string | undefined;
    signingSecrets?: Record<string, string> | undefined;
    routes?: {
        match: {
            value: string;
            header?: string | undefined;
            payload?: string | undefined;
        };
        automationToken: string;
        fanOut?: boolean | undefined;
    }[] | undefined;
    claudeOauthToken?: string | undefined;
    runner?: {
        enabled?: boolean | undefined;
        pollIntervalMs?: number | undefined;
        maxConcurrent?: number | undefined;
    } | undefined;
    automations?: {
        token: string;
        repoPath: string;
        prompt: string;
        push?: boolean | undefined;
        image?: string | undefined;
        branch?: string | undefined;
        timeoutMs?: number | undefined;
    }[] | undefined;
}>;
export type Config = z.infer<typeof configSchema>;
export type Route = z.infer<typeof routeSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type RunnerConfig = z.infer<typeof runnerSchema>;
export declare function defaultConfigDir(): string;
export declare function defaultConfigPath(): string;
export declare function defaultDbPath(): string;
export declare function loadConfig(configPath?: string): Config;
export declare function saveConfig(config: Config, configPath?: string): void;
export {};
