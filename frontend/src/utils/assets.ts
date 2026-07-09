import { initApiConfig } from '../api';

let cachedConfig: { port: number; token: string } | null = null;

async function apiConfig() {
  if (!cachedConfig) {
    cachedConfig = await initApiConfig();
  }
  return cachedConfig;
}

export function noteDirForPath(notePath: string): string {
  const normalized = notePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
}

export function assetDirForNote(notePath: string): string {
  const normalized = notePath.replace(/\\/g, '/');
  const dot = normalized.lastIndexOf('.');
  const base = dot > 0 ? normalized.slice(0, dot) : normalized;
  return `${base}.assets`;
}

export function resolveVaultAssetPath(notePath: string, ref: string): string {
  const normalizedRef = ref.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/^(https?:|data:|blob:)/i.test(normalizedRef)) {
    return normalizedRef;
  }
  const noteDir = noteDirForPath(notePath);
  if (normalizedRef.includes('/')) {
    return `${noteDir}${normalizedRef}`;
  }
  return `${assetDirForNote(notePath)}/${normalizedRef}`;
}

export async function buildAssetDisplayUrl(vaultAssetPath: string): Promise<string> {
  const config = await apiConfig();
  const params = new URLSearchParams({
    path: vaultAssetPath,
    token: config.token,
  });
  return `http://127.0.0.1:${config.port}/api/asset?${params.toString()}`;
}

export async function uploadNoteImage(notePath: string, file: File): Promise<string> {
  const config = await apiConfig();
  const form = new FormData();
  form.append('notePath', notePath);
  form.append('file', file);

  const response = await fetch(`http://127.0.0.1:${config.port}/api/asset`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': config.token,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || '图片上传失败');
  }

  const result = await response.json() as { markdownRef: string };
  return result.markdownRef;
}

export async function proxyImageUrl(notePath: string, src: string): Promise<string> {
  if (!src) return src;
  if (/^(https?:|data:|blob:)/i.test(src)) {
    return src;
  }
  return buildAssetDisplayUrl(resolveVaultAssetPath(notePath, src));
}

export function proxyImageUrlSync(notePath: string, src: string, baseUrl: string, token: string): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:)/i.test(src)) {
    return src;
  }
  const vaultPath = resolveVaultAssetPath(notePath, src);
  const params = new URLSearchParams({ path: vaultPath, token });
  return `${baseUrl}/api/asset?${params.toString()}`;
}

export function invalidateAssetConfigCache() {
  cachedConfig = null;
}
