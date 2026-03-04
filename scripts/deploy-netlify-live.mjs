import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const preview = args.has('--preview');
const dryRun = args.has('--dry-run');

const requiredEnv = ['NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID', 'VITE_API_BASE_URL'];
const missing = requiredEnv.filter((key) => !String(process.env[key] ?? '').trim());

if (missing.length > 0) {
  console.error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
  console.error('Beispiel (PowerShell):');
  console.error('$env:NETLIFY_AUTH_TOKEN="<token>"');
  console.error('$env:NETLIFY_SITE_ID="<site-id>"');
  console.error('$env:VITE_API_BASE_URL="https://<api-domain>"');
  process.exit(1);
}

const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run('npm', ['run', 'build']);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const deployArgs = [
  'netlify-cli',
  'deploy',
  '--dir=dist',
  '--site',
  process.env.NETLIFY_SITE_ID,
  '--auth',
  process.env.NETLIFY_AUTH_TOKEN,
  '--message',
  `${preview ? 'preview' : 'live'}-${timestamp}`,
];

if (!preview) deployArgs.push('--prod');

if (dryRun) {
  console.log('Dry run aktiv. Netlify deploy wird uebersprungen.');
  process.exit(0);
}

run('npx', deployArgs);
