import { mkdirSync, writeFileSync } from 'node:fs';
import { info, step } from './lib/log.ts';

const phKey = process.env.PH_KEY ?? '';
const phHost = process.env.PH_HOST ?? '';

if (!phKey || !phHost) {
  console.log('PostHog secrets not set; skipping telemetry injection.');
  process.exit(0);
}

step('Inject PostHog config');
mkdirSync('dist/main', { recursive: true });
writeFileSync(
  'dist/main/appConfig.json',
  JSON.stringify({ posthogHost: phHost, posthogKey: phKey }, null, 2)
);
info('Wrote dist/main/appConfig.json');
