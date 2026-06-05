#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { generateApiKey } from './crypto.js';
import { configSchema, defaultConfigPath, defaultDbPath, loadConfig, saveConfig } from './config.js';
import { initDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildServer } from './server.js';
import { RunnerWorker } from './runner/worker.js';
const { positionals } = parseArgs({ allowPositionals: true });
const command = positionals[0] ?? 'start';
async function init() {
    const configPath = defaultConfigPath();
    if (existsSync(configPath)) {
        console.log(`Config already exists at ${configPath}`);
        return;
    }
    // Parse through the schema so defaults (runner, automations, …) are applied.
    const config = configSchema.parse({
        apiKey: generateApiKey(),
        port: 8080,
        host: '0.0.0.0',
        dbPath: defaultDbPath(),
        signingSecrets: {},
        routes: [],
    });
    saveConfig(config);
    console.log(`✓ Initialized emdash-server`);
    console.log(`  Config: ${configPath}`);
    console.log(`  API key: ${config.apiKey}`);
    console.log(`  DB: ${config.dbPath}`);
    console.log(`\nAdd this server in Emdash Settings → emdash-server.`);
    console.log(`Run 'emdash-server start' to start the server.`);
}
async function migrate() {
    const config = loadConfig();
    initDb(config.dbPath);
    runMigrations();
    console.log('✓ Migrations applied');
}
async function start() {
    const config = loadConfig();
    initDb(config.dbPath);
    runMigrations();
    const app = buildServer(config);
    await app.listen({ port: config.port, host: config.host });
    console.log(`emdash-server listening on ${config.host}:${config.port}`);
    // Start the agent runner (no-op unless config.runner.enabled).
    const runner = new RunnerWorker({ config });
    runner.start();
    const shutdown = (signal) => {
        console.log(`\nReceived ${signal}, shutting down...`);
        runner.stop();
        void app.close().then(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
if (command === 'init') {
    await init();
}
else if (command === 'migrate') {
    await migrate();
}
else if (command === 'start') {
    await start();
}
else {
    console.error(`Unknown command: ${command}. Use: init | migrate | start`);
    process.exit(1);
}
