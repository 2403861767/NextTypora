// 读 jar 里的 META-INF/MANIFEST.MF，不依赖 JDK 的 jar 工具（copy-backend-jar.js 在 prepare-jre 之前跑）。
// 只支持 Maven 打出来的普通 jar：非 zip64、条目是 stored 或 deflate。
const fs = require('fs');
const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readJarEntry(jarPath, entryName) {
  const buf = fs.readFileSync(jarPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${jarPath} is not a zip file`);

  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n += 1) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error(`${jarPath}: bad central directory`);
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === entryName) {
      if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`${jarPath}: bad local header for ${name}`);
      const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`${jarPath}: ${name} uses unsupported compression method ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** 主段的属性。续行以一个空格开头（每行最多 72 字节，长的 Class-Path 一定会折行）。 */
function readManifest(jarPath) {
  const raw = readJarEntry(jarPath, 'META-INF/MANIFEST.MF');
  if (!raw) throw new Error(`${jarPath} has no META-INF/MANIFEST.MF`);
  const attributes = {};
  let last = null;
  for (const line of raw.toString('utf8').split(/\r\n|\r|\n/)) {
    if (line === '') break;
    if (line.startsWith(' ') && last) {
      attributes[last] += line.slice(1);
      continue;
    }
    const colon = line.indexOf(': ');
    if (colon < 0) continue;
    last = line.slice(0, colon);
    attributes[last] = line.slice(colon + 2);
  }
  return attributes;
}

/** manifest Class-Path 里的条目，按原顺序。 */
function readClassPath(jarPath) {
  const value = readManifest(jarPath)['Class-Path'] || '';
  return value.split(' ').filter(Boolean);
}

module.exports = { readJarEntry, readManifest, readClassPath };
