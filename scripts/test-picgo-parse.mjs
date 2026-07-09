/**
 * Quick sanity check for PicGo response parsing logic (mirrors frontend/src/utils/picgo.ts).
 */
function parsePicGoUploadResponse(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('PicGo 返回无效响应');
  }
  if (data.success === false) {
    throw new Error(String(data.message || 'PicGo 上传失败'));
  }
  if (Array.isArray(data.result) && data.result.length > 0) {
    return String(data.result[0]);
  }
  if (typeof data.fullImageUrl === 'string' && data.fullImageUrl) {
    return data.fullImageUrl;
  }
  if (Array.isArray(data.data) && data.data.length > 0) {
    return String(data.data[0]);
  }
  throw new Error('PicGo 未返回图片 URL');
}

const cases = [
  [{ success: true, result: ['https://cdn.example/a.png'] }, 'https://cdn.example/a.png'],
  [{ success: true, fullImageUrl: 'https://cdn.example/b.png' }, 'https://cdn.example/b.png'],
];

for (const [input, expected] of cases) {
  const actual = parsePicGoUploadResponse(input);
  if (actual !== expected) {
    console.error('FAIL', input, actual, expected);
    process.exit(1);
  }
}

try {
  parsePicGoUploadResponse({ success: false, message: 'fail' });
  console.error('FAIL should throw on success:false');
  process.exit(1);
} catch {
  // expected
}

console.log('picgo parse tests OK');
