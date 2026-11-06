const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');

/**
 * 校验 release/ 里的安装包与 package.json 真的是一回事。
 *
 * verify-dist-resources.js 在打包“之前”跑，它保证的是输入正确；这个脚本在打包“之后”跑，
 * 保证的是产物正确。两次真实事故都发生在这个缝里：
 *
 *   1.0.2：产物是按 1.0.0 构建后手工改名的，latest.yml 与 .blockmap 都还停在 1.0.0。
 *   1.0.3：安装包构建于 fe0d9e8 之前，PE 元数据仍写着 CompanyName=nextTyproa，而旁边的
 *          win-unpacked 已经是修过的，latest.yml 的 sha512 指向那个旧包。复测差点就装错了。
 *
 * 所以这里不看文件名、不看模板，只对比产物里真实存在的字节与元数据。
 */

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const build = packageJson.build || {};
const releaseDir = path.join(projectRoot, (build.directories && build.directories.output) || 'release');

const version = packageJson.version;
const productName = build.productName;
const author = packageJson.author;

let ok = true;
const fail = (message) => { console.error(message); ok = false; };

if (!version || !productName || !author) {
  fail('package.json needs version, build.productName and author to verify an artifact.');
  process.exit(1);
}

// 按 artifactName 模板算出产物名，而不是去猜或去遍历：模板本身由 verify-dist-resources 校验。
const artifactName = String(build.artifactName || '${productName}-${version}-${os}-${arch}.${ext}')
  .replace('${productName}', productName)
  .replace('${version}', version)
  .replace('${os}', 'win')
  .replace('${arch}', 'x64')
  .replace('${ext}', 'exe');
const artifactPath = path.join(releaseDir, artifactName);

if (!fs.existsSync(artifactPath)) {
  fail(`Missing release artifact: ${artifactPath}
`
    + `  Build it with: npm run dist:setup`);
  process.exit(1);
}

const bytes = fs.readFileSync(artifactPath);
console.log(`Checking ${artifactName} (${bytes.length} bytes)`);

// ---- PE 元数据：产物自己说自己是谁 ---------------------------------------------------
if (process.platform === 'win32') {
  // 不设输出编码的话，LegalCopyright 里的 © 会变成 ?，报错信息就带着乱码。
  const script = '[Console]::OutputEncoding = [Text.Encoding]::UTF8;'
    + ` $v = (Get-Item -LiteralPath '${artifactPath}').VersionInfo;`
    + ` "$($v.ProductName)|$($v.CompanyName)|$($v.FileVersion)|$($v.LegalCopyright)"`;
  const line = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const [peProduct, peCompany, peFileVersion, peCopyright] = line.split('|');

  if (peProduct !== productName) {
    fail(`ProductName in the artifact is "${peProduct}", but package.json says "${productName}".`);
  }
  if (peCompany !== author) {
    fail(`CompanyName in the artifact is "${peCompany}", but package.json author is "${author}".
`
      + `  This is exactly how the 1.0.3 installer ended up one commit behind the code.`);
  }
  if (!String(peFileVersion).startsWith(version)) {
    fail(`FileVersion in the artifact is "${peFileVersion}", but package.json says "${version}".`);
  }
  if (peCopyright && !peCopyright.includes(author)) {
    fail(`LegalCopyright in the artifact is "${peCopyright}", which does not mention "${author}".`);
  }
} else {
  console.log('  (not on Windows: skipping the PE metadata check)');
}

// ---- latest.yml：自动更新清单必须描述的就是这个文件 ----------------------------------
const latestYmlPath = path.join(releaseDir, 'latest.yml');
if (!fs.existsSync(latestYmlPath)) {
  fail(`Missing ${latestYmlPath}: electron-builder writes it next to the installer.`);
} else {
  const yml = fs.readFileSync(latestYmlPath, 'utf8');
  const read = (key) => {
    const match = yml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
  };
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');

  if (read('version') !== version) {
    fail(`latest.yml says version ${read('version')}, package.json says ${version}.`);
  }
  if (read('path') !== artifactName) {
    fail(`latest.yml path is "${read('path')}", expected "${artifactName}".`);
  }
  const ymlSize = read('size');
  if (ymlSize && Number(ymlSize) !== bytes.length) {
    fail(`latest.yml size is ${ymlSize}, but ${artifactName} is ${bytes.length} bytes.`);
  }
  // 1.0.2 的 latest.yml 之所以骗人，就是因为它记的是另一个文件的 sha512。
  if (!yml.includes(sha512)) {
    fail(`latest.yml does not contain the sha512 of ${artifactName}.
`
      + `  Computed: ${sha512}
`
      + `  latest.yml is describing a different file - repackage instead of renaming.`);
  }
}

// ---- 旁边有没有别的版本的产物在冒充发布物 -------------------------------------------
const strays = fs.readdirSync(releaseDir)
  .filter((name) => name.endsWith('.exe') && name !== artifactName && !name.startsWith('__'));
if (strays.length) {
  console.warn(`Note: release/ also holds ${strays.join(', ')} - older artifacts, not described by latest.yml.`);
}

if (!ok) {
  process.exit(1);
}

console.log(`Release artifact verification passed: ${productName} ${version} by ${author}.`);
