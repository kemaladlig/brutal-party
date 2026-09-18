import { spawn } from 'node:child_process';
import localtunnel from 'localtunnel';

const port = 5173;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const server = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let tunnel;

try {
  tunnel = await localtunnel({ port });
  console.log(`\nBRUTAL PARTY phone URL: ${tunnel.url}`);
  console.log('Open this HTTPS URL on the phone, then tap the download icon.');
  console.log('Keep this terminal open while testing.\n');
} catch (error) {
  console.error('Could not create the HTTPS tunnel:', error.message);
  server.kill();
  process.exitCode = 1;
}

const shutdown = async () => {
  if (tunnel) await tunnel.close();
  if (!server.killed) server.kill();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
