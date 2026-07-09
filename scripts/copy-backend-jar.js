const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'backend', 'target', 'backend-1.0.0.jar');
const targetDir = path.join(__dirname, '..', 'resources');
const target = path.join(targetDir, 'backend.jar');

if (!fs.existsSync(source)) {
  console.error('Backend jar not found. Run mvn package first.');
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied ${source} -> ${target}`);
