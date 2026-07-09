const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const requiredPaths = [
  path.join(projectRoot, 'backend', 'target', 'backend-1.0.0.jar'),
  path.join(projectRoot, 'resources', 'backend.jar'),
  path.join(projectRoot, 'frontend', 'dist', 'index.html'),
  path.join(projectRoot, 'electron', 'main.js'),
  path.join(projectRoot, 'electron', 'preload.js'),
  path.join(projectRoot, 'resources', 'jre'),
];

let ok = true;
for (const filePath of requiredPaths) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing required build artifact: ${filePath}`);
    ok = false;
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const build = packageJson.build || {};

if (!build.productName || !build.appId) {
  console.error('Missing electron-builder productName/appId.');
  ok = false;
}

if (!String(build.artifactName || '').includes('${version}')) {
  console.error('Release artifactName should include ${version}.');
  ok = false;
}

const associations = Array.isArray(build.fileAssociations) ? build.fileAssociations : [];
const hasMarkdownAssociation = associations.some((item) => {
  const extensions = Array.isArray(item.ext) ? item.ext : [item.ext];
  return extensions.includes('md') && extensions.includes('markdown');
});
if (!hasMarkdownAssociation) {
  console.error('Missing Markdown file association for md/markdown.');
  ok = false;
}

const jreBin = path.join(projectRoot, 'resources', 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
if (!fs.existsSync(jreBin)) {
  console.error(`Missing bundled Java runtime: ${jreBin}`);
  ok = false;
}

if (!ok) {
  process.exit(1);
}

console.log('Distribution resource verification passed.');
