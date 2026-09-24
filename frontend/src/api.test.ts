import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, deleteNote, deletePath, describeError, exportHtml, getNote, movePath, refreshWorkspace, searchNotes } from './api';

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function textResponse(text: string, init: Pick<Response, 'ok' | 'status' | 'statusText'>) {
  return Promise.resolve({
    ...init,
    text: () => Promise.resolve(text),
  } as Response);
}

describe('api wrappers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves a path with the expected payload', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ name: 'note.md', path: 'archive/note.md', directory: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await movePath('docs/note.md', 'archive');

    expect(result.path).toBe('archive/note.md');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/files/move',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ path: 'docs/note.md', targetFolder: 'archive' }),
      }),
    );
  });

  it('requests standalone HTML export for the selected note', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ path: 'docs/note.md', title: 'Note', html: '<!doctype html>' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await exportHtml('docs/note.md');

    expect(result.html).toContain('<!doctype html>');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/export/html',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: 'docs/note.md' }),
      }),
    );
  });

  it('refreshes the workspace tree through the refresh endpoint', async () => {
    const fetchMock = vi.fn(() => jsonResponse([{ name: 'note.md', path: 'note.md', directory: false, children: [] }]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshWorkspace();

    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/tree/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requests paged search with sort parameters and normalizes legacy array responses', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse([{ path: 'docs/a.md', title: 'A', snippet: 'hello', lineNumber: 3 }]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchNotes({ q: 'hello world', sort: 'path', limit: 12, offset: 24 });

    expect(result.total).toBe(1);
    expect(result.results[0].lineNumber).toBe(3);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8080/api/search?q=hello+world&sort=path&limit=12&offset=24');
  });

  it('keeps paged search metadata from object responses', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      results: [{ path: 'docs/b.md', title: 'B', snippet: '<mark>hello</mark>', lineNumber: 7 }],
      total: 37,
      limit: 12,
      offset: 24,
      sort: 'updatedAt',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchNotes({ q: 'hello', sort: 'updatedAt', limit: 12, offset: 24 });

    expect(result.total).toBe(37);
    expect(result.limit).toBe(12);
    expect(result.offset).toBe(24);
    expect(result.sort).toBe('updatedAt');
    expect(result.results[0].snippet).toBe('<mark>hello</mark>');
  });

  it('treats 204 responses as successful empty results', async () => {
    const fetchMock = vi.fn(() => textResponse('', { ok: true, status: 204, statusText: 'No Content' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteNote('docs/note.md')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/note?path=docs%2Fnote.md',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('treats DELETE responses with an empty body as successful empty results', async () => {
    const fetchMock = vi.fn(() => textResponse('', { ok: true, status: 200, statusText: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deletePath('docs/old.md')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/files?path=docs%2Fold.md',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws for empty successful non-DELETE response bodies', async () => {
    const fetchMock = vi.fn(() => textResponse('', { ok: true, status: 200, statusText: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshWorkspace()).rejects.toThrow('Empty response body: 200');
  });

  it('surfaces JSON error bodies with API error metadata', async () => {
    const fetchMock = vi.fn(() => textResponse(
      JSON.stringify({ error: 'Note missing', code: 'NOTE_NOT_FOUND' }),
      { ok: false, status: 404, statusText: 'Not Found' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getNote('docs/missing.md')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Note missing',
      status: 404,
      body: { error: 'Note missing', code: 'NOTE_NOT_FOUND' },
      code: 'NOTE_NOT_FOUND',
    } satisfies Partial<ApiError>);
  });

  it('surfaces plain-text error bodies as the error message', async () => {
    const fetchMock = vi.fn(() => textResponse('Backend unavailable', { ok: false, status: 503, statusText: 'Service Unavailable' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getNote('docs/offline.md')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Backend unavailable',
      status: 503,
      body: 'Backend unavailable',
    } satisfies Partial<ApiError>);
  });

  it('turns fetch failures into network ApiErrors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(getNote('docs/a.md')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      kind: 'network',
      code: 'NETWORK_ERROR',
    } satisfies Partial<ApiError>);
  });

  it('classifies API errors by HTTP status', () => {
    expect(new ApiError('x', 401, undefined).kind).toBe('unauthorized');
    expect(new ApiError('x', 400, undefined).kind).toBe('badRequest');
    expect(new ApiError('x', 404, undefined).kind).toBe('notFound');
    expect(new ApiError('x', 409, undefined).kind).toBe('conflict');
    expect(new ApiError('x', 500, undefined).kind).toBe('server');
    expect(new ApiError('x', 503, undefined).kind).toBe('server');
  });

  it('describes each error kind with a specific user message', () => {
    expect(describeError(new ApiError('Failed to fetch', 0, undefined), '删除失败')).toContain('无法连接到后端服务');
    expect(describeError(new ApiError('Unauthorized', 401, undefined), '删除失败')).toContain('身份验证失败');
    expect(describeError(new ApiError('Path not found: a.md', 404, undefined), '删除失败'))
      .toBe('删除失败：文件或文件夹不存在，可能已被移动或删除（Path not found: a.md）');
    expect(describeError(new ApiError('Disk full', 500, undefined), '保存失败')).toContain('HTTP 500');
    expect(describeError(new ApiError('Path already exists: b.md', 409, undefined), '重命名失败'))
      .toBe('重命名失败：Path already exists: b.md');
    expect(describeError(new Error('boom'), '打开失败')).toBe('打开失败：boom');
    expect(describeError('weird', '打开失败')).toBe('打开失败');
  });

  it('encodes note paths in query string endpoints', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ path: 'docs/a b/汉字.md', content: '# title', hash: 'hash' }));
    vi.stubGlobal('fetch', fetchMock);

    await getNote('docs/a b/汉字.md');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/note?path=docs%2Fa%20b%2F%E6%B1%89%E5%AD%97.md',
      expect.any(Object),
    );
  });

  it('includes the search scope parameter when provided', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ results: [], total: 0, limit: 5, offset: 0, sort: 'relevance' }));
    vi.stubGlobal('fetch', fetchMock);

    await searchNotes({ q: 'asset refs', scope: 'body', limit: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/search?q=asset+refs&sort=relevance&limit=5&offset=0&scope=body',
      expect.any(Object),
    );
  });
});

describe('backend connection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.nextTyproa;
  });

  // reconnectBackend 会改写模块内的后端配置，每个用例使用独立的模块实例
  async function freshApi() {
    vi.resetModules();
    return import('./api');
  }

  it('health check bounds the request with a timeout and reports failures as offline', async () => {
    const api = await freshApi();
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.healthCheck()).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    fetchMock.mockImplementationOnce(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    await expect(api.healthCheck()).resolves.toBe(false);

    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false } as Response));
    await expect(api.healthCheck()).resolves.toBe(false);
  });

  it('reconnect re-reads the Electron backend config so a restarted backend is reachable', async () => {
    const api = await freshApi();
    const getBackendConfig = vi.fn(() => Promise.resolve({ port: 43210, token: 'rotated-token' }));
    window.nextTyproa = { getBackendConfig } as unknown as NonNullable<Window['nextTyproa']>;
    const fetchMock = vi.fn((url: string) => (url.endsWith('/api/health')
      ? Promise.resolve({ ok: true } as Response)
      : jsonResponse({ path: 'D:/vault' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.reconnectBackend()).resolves.toBe(true);
    await api.getWorkspace();

    expect(getBackendConfig).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:43210/api/health', expect.any(Object));
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:43210/api/workspace',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Auth-Token': 'rotated-token' }) }),
    );
  });

  it('reconnect reports offline when the backend config cannot be read', async () => {
    const api = await freshApi();
    window.nextTyproa = {
      getBackendConfig: () => Promise.reject(new Error('main process busy')),
    } as unknown as NonNullable<Window['nextTyproa']>;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.reconnectBackend()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('network failures surface as network errors so the UI can detect a lost backend', async () => {
    const api = await freshApi();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(api.getWorkspace()).rejects.toMatchObject({ kind: 'network', status: 0 });
  });
});
