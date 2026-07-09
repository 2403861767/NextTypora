export interface PicGoConfig {
  serverUrl: string;
  secret?: string;
}

export function normalizePicGoServerUrl(url: string): string {
  const trimmed = (url || 'http://127.0.0.1:36677').trim().replace(/\/+$/, '');
  return trimmed || 'http://127.0.0.1:36677';
}

export function parsePicGoUploadResponse(data: unknown): string {
  if (!data || typeof data !== 'object') {
    throw new Error('PicGo 返回无效响应');
  }
  const obj = data as Record<string, unknown>;
  if (obj.success === false) {
    throw new Error(String(obj.message || 'PicGo 上传失败'));
  }
  if (Array.isArray(obj.result) && obj.result.length > 0) {
    return String(obj.result[0]);
  }
  if (typeof obj.fullImageUrl === 'string' && obj.fullImageUrl) {
    return obj.fullImageUrl;
  }
  if (Array.isArray(obj.data) && obj.data.length > 0) {
    return String(obj.data[0]);
  }
  throw new Error('PicGo 未返回图片 URL');
}

function buildPicGoHeaders(secret?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (secret?.trim()) {
    headers.Authorization = `Bearer ${secret.trim()}`;
  }
  return headers;
}

async function uploadViaPicGoFetch(file: File, config: PicGoConfig): Promise<string> {
  const base = normalizePicGoServerUrl(config.serverUrl);
  const form = new FormData();
  form.append('files', file, file.name || 'image.png');

  const response = await fetch(`${base}/upload`, {
    method: 'POST',
    headers: buildPicGoHeaders(config.secret),
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { message?: string }).message || response.statusText;
    throw new Error(message || 'PicGo 上传失败');
  }
  return parsePicGoUploadResponse(data);
}

export async function uploadViaPicGo(file: File, config: PicGoConfig): Promise<string> {
  if (window.nextTyproa?.uploadToPicGo) {
    const buffer = await file.arrayBuffer();
    const data = await window.nextTyproa.uploadToPicGo({
      serverUrl: config.serverUrl,
      secret: config.secret,
      buffer,
      filename: file.name || 'image.png',
      mimeType: file.type || 'application/octet-stream',
    });
    return parsePicGoUploadResponse(data);
  }
  return uploadViaPicGoFetch(file, config);
}

export async function testPicGoConnection(config: PicGoConfig): Promise<{ ok: boolean; message: string }> {
  try {
    if (window.nextTyproa?.testPicGoConnection) {
      const data = await window.nextTyproa.testPicGoConnection({
        serverUrl: config.serverUrl,
        secret: config.secret,
      });
      if (data && typeof data === 'object' && (data as { success?: boolean }).success === false) {
        return { ok: false, message: String((data as { message?: string }).message || 'PicGo 未就绪') };
      }
      return { ok: true, message: '已连接到 PicGo 服务' };
    }

    const base = normalizePicGoServerUrl(config.serverUrl);
    const response = await fetch(`${base}/heartbeat`, {
      method: 'POST',
      headers: buildPicGoHeaders(config.secret),
    });
    if (!response.ok) {
      return { ok: false, message: `PicGo 响应异常 (${response.status})` };
    }
    return { ok: true, message: '已连接到 PicGo 服务' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '无法连接 PicGo，请确认 PicGo 已启动并开启 Server',
    };
  }
}
