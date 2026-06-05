import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
const routeMatchSchema = z.object({
    header: z.string().optional(),
    payload: z.string().optional(), // JSONPath e.g. $.action
    value: z.string(),
});
const routeSchema = z.object({
    match: routeMatchSchema,
    automationToken: z.string(),
    fanOut: z.boolean().optional().default(false),
});
export const configSchema = z.object({
    apiKey: z.string(),
    port: z.number().default(8080),
    host: z.string().default('0.0.0.0'),
    dbPath: z.string(),
    signingSecrets: z.record(z.string(), z.string()).default({}), // token -> hmac secret
    routes: z.array(routeSchema).default([]),
});
export function defaultConfigDir() {
    return join(homedir(), '.emdash-server');
}
export function defaultConfigPath() {
    return join(defaultConfigDir(), 'config.json');
}
export function defaultDbPath() {
    return join(defaultConfigDir(), 'db.sqlite');
}
export function loadConfig(configPath = defaultConfigPath()) {
    if (!existsSync(configPath)) {
        throw new Error(`Config not found at ${configPath}. Run: emdash-server init`);
    }
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return configSchema.parse(raw);
}
export function saveConfig(config, configPath = defaultConfigPath()) {
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
