const crypto = require('crypto');
const { spawn } = require('child_process');

// 每次 npm run dev 生成一个随机 token，同时传给后端（AUTH_TOKEN）、Vite（VITE_AUTH_TOKEN）和 Electron
const token = process.env.AUTH_TOKEN || crypto.randomBytes(24).toString('hex');
console.log(`[dev] X-Auth-Token for this session: ${token}`);

const child = spawn('npm run dev:all', {
  env: { ...process.env, AUTH_TOKEN: token, VITE_AUTH_TOKEN: token },
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
