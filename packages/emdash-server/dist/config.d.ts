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
}>;
export type Config = z.infer<typeof configSchema>;
export type Route = z.infer<typeof routeSchema>;
export declare function defaultConfigDir(): string;
export declare function defaultConfigPath(): string;
export declare function defaultDbPath(): string;
export declare function loadConfig(configPath?: string): Config;
export declare function saveConfig(config: Config, configPath?: string): void;
export {};
