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

  // jdk.charsets provides Big5 (and other extended charsets) that FileService probes on every
  // read of a file without a BOM; java.base on Windows only ships GBK and Shift_JIS.
  const modules = [
    'java.base', 'java.logging', 'java.sql', 'java.naming', 'java.desktop',
    'java.xml', 'java.net.http', 'java.security.jgss', 'java.security.sasl',
    'java.transaction.xa', 'java.management', 'java.instrument',
    'jdk.unsupported', 'jdk.crypto.ec', 'jdk.localedata', 'jdk.charsets',
  ];
  const args = [
    `--module-path=${path.join(javaHome, 'jmods')}`,
    `--add-modules=${modules.join(',')}`,
    '--strip-debug',
    '--no-man-pages',
    '--no-header-files',
    '--compress=2',
    // 基础类缓存 bin/server/classes.jsa（V105-04）。jlink 默认不生成，JDK 自带的那份也不会复制过来，
    // 没有它 JDK 自己的类每次启动都要从头加载、校验，V105-05 的应用类缓存也建不起来。
    // 生成的缓存对应这个精简镜像本身的 lib/modules，所以必须由 jlink 在这里生成。
    '--generate-cds-archive',
    `--output=${jreDir}`,
  ];

  const result = spawnSync(jlink, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('jlink failed');
  }

  // jlink 把生成的 .jsa 标成只读，JDK 自带的那几份是可写的。照 JDK 的样子去掉只读，
  // 免得安装包覆盖安装、卸载或用户手动删除时碰上只读文件。JVM 只读取、映射这个文件。
  const serverDir = path.join(jreDir, process.platform === 'win32' ? 'bin' : 'lib', 'server');
  for (const name of fs.readdirSync(serverDir)) {
    if (name.endsWith('.jsa')) {
      fs.chmodSync(path.join(serverDir, name), 0o644);
    }
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

  // classes_nocoops.jsa 是关掉压缩指针时（堆上限 ≥ 32GB）用的基础类缓存。后端固定 -Xmx512m
  // （electron/backendLaunch.js），压缩指针永远开着，JVM 只会用 classes.jsa，这份 12.5MB 白占地方
  // （安装包约 2.3MB）。代价是 JRE 和堆上限绑在一起：哪天把堆上限提到 32GB 以上，要把它留下来，
  // 否则基础类缓存和建立在它上面的应用类缓存都会悄悄失效（test:packaged 的类缓存用例会报出来）。
  // jlink 的 --generate-cds-archive 和整个复制 JDK 的那条路都会带上它，所以两条路都在这里删。
  const nocoopsArchive = path.join(jreDir, process.platform === 'win32' ? 'bin' : 'lib', 'server', 'classes_nocoops.jsa');
  fs.rmSync(nocoopsArchive, { force: true });
  console.log(`JRE ready: ${jreDir}`);
}

main();
