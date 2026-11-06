const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

/** 期望发布的版本号：命令行 --expect-version <v> 优先，其次环境变量 EXPECT_VERSION。 */
function readExpectedVersion() {
  const flagIndex = process.argv.indexOf('--expect-version');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1].trim();
  }
  const inline = process.argv.find((arg) => arg.startsWith('--expect-version='));
  if (inline) {
    return inline.slice('--expect-version='.length).trim();
  }
  return (process.env.EXPECT_VERSION || '').trim() || null;
}

const requiredPaths = [
  path.join(projectRoot, 'backend', 'target', 'backend.jar'),
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

// 这里检查的是 version 的"值"，不只是 artifactName 模板里有没有 ${version}。
// 1.0.2 就是这样错出去的：模板是对的，值一直停在 1.0.0，产物被手工改名成 1.0.2，
// 而 latest.yml 和 .blockmap 都还停在 1.0.0。见 .scratch/v1.0.3/issues/06-...
const expectedVersion = readExpectedVersion();
if (!expectedVersion) {
  console.error(
    `Refusing to verify without an expected version.
`
    + `  package.json currently says ${packageJson.version}.
`
    + `  Re-run as: npm run dist:verify -- --expect-version ${packageJson.version}
`
    + `  (or set EXPECT_VERSION). Stating the version you are releasing is the point:`
    + ` it is the one moment a machine can catch a stale version number.`,
  );
  ok = false;
} else if (packageJson.version !== expectedVersion) {
  console.error(
    `Version mismatch: package.json says ${packageJson.version}, `
    + `but you said you are releasing ${expectedVersion}.`,
  );
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

// ProgId 必须是应用专属的。`Markdown Document` 这种通用名会和任何同样命名的编辑器撞在一起，
// 1.0.3 的安装版就是这么注册的。
const markdownAssociation = associations.find((item) => {
  const extensions = Array.isArray(item.ext) ? item.ext : [item.ext];
  return extensions.includes('md');
});
const progId = markdownAssociation && markdownAssociation.name;
if (progId && !progId.includes('NextTypora')) {
  console.error(
    `File association ProgId "${progId}" is not app-specific; use something like NextTypora.md.`,
  );
  ok = false;
}

// installer.nsh 的 customUnInstall 要按名字删掉 "<ProgId>_backup" 残留值，所以它内联了
// ProgId。两处必须一致——否则卸载后会在 .md / .markdown 下留下我们自己的垃圾值。
if (progId) {
  const installerNsh = path.join(projectRoot, 'build', 'installer.nsh');
  if (!fs.existsSync(installerNsh)) {
    console.error(`Missing ${installerNsh}, referenced by build.nsis.include.`);
    ok = false;
  } else {
    const nsh = fs.readFileSync(installerNsh, 'utf8');
    if (!nsh.includes(`${progId}_backup`)) {
      console.error(
        `build/installer.nsh does not clean up "${progId}_backup"; `
        + `the ProgId in package.json and installer.nsh have drifted apart.`,
      );
      ok = false;
    }
  }
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
