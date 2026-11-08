// 把 Maven 的产物摆成发布用的后端布局（V105-05）：
//   backend/target/backend.jar  -> resources/backend/app.jar
//   backend/target/lib/<jar>    -> resources/backend/lib/<jar>，只复制 app.jar 的 manifest Class-Path 里列的那些
// app.jsa（应用类缓存）和 app.jsa.json 由之后的 scripts/train-backend-cds.js 生成。这里先清空整个目录，
// 免得留下对不上新 jar 的旧缓存，或者 target/lib 里早已不用、copy-dependencies 又不会删的旧 jar。
const fs = require('fs');
const path = require('path');
const { readClassPath, readManifest } = require('./jarManifest');

const projectRoot = path.join(__dirname, '..');
const sourceJar = path.join(projectRoot, 'backend', 'target', 'backend.jar');
const sourceLib = path.join(projectRoot, 'backend', 'target', 'lib');
const resourcesDir = path.join(projectRoot, 'resources');
const targetDir = path.join(resourcesDir, 'backend');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(sourceJar)) {
  fail('Backend jar not found. Run mvn package first.');
}

const manifest = readManifest(sourceJar);
if (manifest['Main-Class'] !== 'com.nexttyproa.NextTyproaApplication') {
  fail(`${sourceJar} has Main-Class ${manifest['Main-Class']}; expected the plain jar of com.nexttyproa.NextTyproaApplication`
    + ' (a Spring Boot fat jar? see spring-boot.repackage.skip in backend/pom.xml).');
}

const classPath = readClassPath(sourceJar);
if (classPath.length === 0) {
  fail(`${sourceJar} has no Class-Path in its manifest.`);
}
for (const entry of classPath) {
  if (!/^lib\/[^/]+\.jar$/.test(entry)) fail(`Unexpected Class-Path entry in ${sourceJar}: ${entry}`);
  if (!fs.existsSync(path.join(sourceLib, entry.slice('lib/'.length)))) {
    fail(`${entry} is on the Class-Path but missing from ${sourceLib}. Run mvn package.`);
  }
}

fs.rmSync(targetDir, { recursive: true, force: true });
// 1.0.4 及以前的布局：单个胖 jar。留着不会被打包，但会让人以为它还在用。
fs.rmSync(path.join(resourcesDir, 'backend.jar'), { force: true });
fs.mkdirSync(path.join(targetDir, 'lib'), { recursive: true });

fs.copyFileSync(sourceJar, path.join(targetDir, 'app.jar'));
for (const entry of classPath) {
  const name = entry.slice('lib/'.length);
  fs.copyFileSync(path.join(sourceLib, name), path.join(targetDir, 'lib', name));
}
console.log(`Copied ${sourceJar} -> ${path.join(targetDir, 'app.jar')} and ${classPath.length} jars -> ${path.join(targetDir, 'lib')}`);
