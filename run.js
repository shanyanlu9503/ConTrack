const { spawn } = require('child_process');
const server = spawn('node', ['src/server.js'], { stdio: 'inherit' });
server.on('error', (err) => console.error('Server error:', err));
server.on('exit', (code) => console.log('Server exited with code:', code));
