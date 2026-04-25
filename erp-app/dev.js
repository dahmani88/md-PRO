const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const bin = path.join(__dirname, 'node_modules', '.bin');
const isWin = process.platform === 'win32';

function bin_cmd(name) {
  return path.join(bin, isWin ? `${name}.cmd` : name);
}

function run(exe, args, env) {
  const p = spawn(bin_cmd(exe), args, {
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, ...env }
  });
  p.on('error', (e) => console.error(`[dev] ${exe} error: ${e.message}`));
  return p;
}

function waitForPort(port, retries = 60) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const check = () => {
      let done = false;
      const tryConnect = (host) => {
        const s = net.createConnection(port, host);
        s.on('connect', () => { s.destroy(); if (!done) { done = true; resolve(); } });
        s.on('error', () => {});
      };
      tryConnect('127.0.0.1');
      tryConnect('::1');
      setTimeout(() => {
        if (!done) {
          if (++n >= retries) reject(new Error('Timeout'));
          else check();
        }
      }, 1000);
    };
    check();
  });
}

console.log('[dev] Starting TypeScript compiler...');
run('tsc', ['-p', 'tsconfig.electron.json', '--watch', '--noEmit', 'false', '--skipLibCheck'], {});

console.log('[dev] Starting Vite...');
run('vite', [], {});

console.log('[dev] Waiting for Vite on port 5174...');
waitForPort(5174).then(() => {
  console.log('[dev] Vite ready! Starting Electron...');
  run('electron', ['.'], { NODE_ENV: 'development', VITE_PORT: '5174' });
}).catch(e => console.error('[dev]', e.message));
