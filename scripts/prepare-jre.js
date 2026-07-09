const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const jreDir = path.join(projectRoot, 'resources', 'jre');

function findJavaHome() {
  if (process.env.JAVA_HOME) {
    const home = process.env.JAVA_HOME;
    if (fs.existsSync(path.join(home, 'bin', 'java.exe')) || fs.existsSync(path.join(home, 'bin', 'java'))) {
      return home;
    }
  }

  try {
    const output = execSync('java -XshowSettings:properties -version 2>&1', { encoding: 'utf8' });
    const match = output.match(/^\s*java\.home\s*=\s*(.+)$/m);
    if (match) {
      return match[1].trim();
    }
  } catch {
    // ignore
  }

  const candidates = [
    'C:/Program Files/Java/jdk-17',
    'C:/Program Files/Java/jdk-21',
    'C:/Program Files/Eclipse Adoptium/jdk-17',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'bin', 'java.exe'))) {
      return candidate;
    }
  }

  throw new Error('JDK 17+ not found. Install JDK and ensure `java -version` works.');
}

function findJlink(javaHome) {
  const jlink = path.join(javaHome, 'bin', process.platform === 'win32' ? 'jlink.exe' : 'jlink');
  if (fs.existsSync(jlink)) return jlink;
  return null;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyRuntime(javaHome) {
  console.log('jlink unavailable, copying JDK runtime (larger bundle)...');
  fs.rmSync(jreDir, { recursive: true, force: true });
  fs.mkdirSync(jreDir, { recursive: true });
  for (const dir of ['bin', 'conf', 'legal', 'lib']) {
    const src = path.join(javaHome, dir);
    if (fs.existsSync(src)) {
      copyDir(src, path.join(jreDir, dir));
    }
  }
}

function buildWithJlink(javaHome, jlink) {
  console.log('Building minimal JRE with jlink...');
  fs.rmSync(jreDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(jreDir), { recursive: true });

  const modules = [
    'java.base', 'java.logging', 'java.sql', 'java.naming', 'java.desktop',
    'java.xml', 'java.net.http', 'java.security.jgss', 'java.security.sasl',
    'java.transaction.xa', 'java.management', 'java.instrument',
    'jdk.unsupported', 'jdk.crypto.ec', 'jdk.localedata',
  ];
  const args = [
    `--module-path=${path.join(javaHome, 'jmods')}`,
    `--add-modules=${modules.join(',')}`,
    '--strip-debug',
    '--no-man-pages',
    '--no-header-files',
    '--compress=2',
    `--output=${jreDir}`,
  ];

  const result = spawnSync(jlink, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('jlink failed');
  }
}

function main() {
  const javaHome = findJavaHome();
  console.log(`Using JAVA_HOME: ${javaHome}`);

  const jlink = findJlink(javaHome);
  if (jlink) {
    buildWithJlink(javaHome, jlink);
  } else {
    copyRuntime(javaHome);
  }

  const javaBin = path.join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!fs.existsSync(javaBin)) {
    throw new Error(`Packaged JRE invalid: ${javaBin} not found`);
  }
  console.log(`JRE ready: ${jreDir}`);
}

main();
