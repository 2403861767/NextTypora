import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAssetDisplayUrl,
  invalidateAssetConfigCache,
  proxyImageUrl,
  proxyImageUrlSync,
  resolveVaultAssetPath,
} from './assets';

describe('asset URL helpers', () => {
  afterEach(() => {
    invalidateAssetConfigCache();
  });

  it('resolves bare local image names into the note asset folder', () => {
    expect(resolveVaultAssetPath('docs/guide.md', 'cover.png')).toBe('docs/guide.assets/cover.png');
  });

  it('resolves nested local image paths relative to the note directory', () => {
    expect(resolveVaultAssetPath('docs/guide.md', 'images/cover 1.png')).toBe('docs/images/cover 1.png');
  });

  it('builds asset proxy URLs with encoded local paths and auth token', async () => {
    const proxied = await buildAssetDisplayUrl('docs/guide.assets/cover 1.png');
    const url = new URL(proxied);

    expect(url.origin).toBe('http://127.0.0.1:8080');
    expect(url.pathname).toBe('/api/asset');
    expect(url.searchParams.get('path')).toBe('docs/guide.assets/cover 1.png');
    expect(url.searchParams.get('token')).toBe('dev-token-change-me');
  });

  it('proxies local image sources asynchronously', async () => {
    const proxied = await proxyImageUrl('docs/guide.md', 'cover.png');
    const url = new URL(proxied);

    expect(url.pathname).toBe('/api/asset');
    expect(url.searchParams.get('path')).toBe('docs/guide.assets/cover.png');
    expect(url.searchParams.get('token')).toBe('dev-token-change-me');
  });

  it('proxies local image sources synchronously with the supplied base URL and token', () => {
    const proxied = proxyImageUrlSync('docs/guide.md', 'images/cover 1.png', 'http://127.0.0.1:9100', 'token with spaces');
    const url = new URL(proxied);

    expect(url.origin).toBe('http://127.0.0.1:9100');
    expect(url.pathname).toBe('/api/asset');
    expect(url.searchParams.get('path')).toBe('docs/images/cover 1.png');
    expect(url.searchParams.get('token')).toBe('token with spaces');
  });

  it('leaves remote, data, blob, and empty image sources unchanged', async () => {
    await expect(proxyImageUrl('docs/guide.md', 'https://example.com/image.png')).resolves.toBe('https://example.com/image.png');
    await expect(proxyImageUrl('docs/guide.md', 'data:image/png;base64,abc')).resolves.toBe('data:image/png;base64,abc');
    expect(proxyImageUrlSync('docs/guide.md', 'blob:http://app/image', 'http://127.0.0.1:8080', 'token')).toBe('blob:http://app/image');
    expect(proxyImageUrlSync('docs/guide.md', '', 'http://127.0.0.1:8080', 'token')).toBe('');
  });
});
