import type {
  BackendConfig,
  ExportHtmlResult,
  FileOperationResult,
  Note,
  SearchIndexStatus,
  SearchRequest,
  SearchResponse,
  SearchResult,
  TreeNode,
} from './types';

let config: BackendConfig = {
  port: Number(import.meta.env.VITE_BACKEND_PORT || 8080),
  token: import.meta.env.VITE_AUTH_TOKEN || '',
};

export async function initApiConfig(): Promise<BackendConfig> {
  if (window.nextTyproa?.getBackendConfig) {
    config = await window.nextTyproa.getBackendConfig();
  }
  return config;
}

function baseUrl(): string {
  return `http://127.0.0.1:${config.port}`;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  code?: string;

  constructor(message: string, status: number, body: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': config.token,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    let message = response.statusText || `Request failed: ${response.status}`;
    let body: unknown = text;
    let code: string | undefined;
    if (text) {
      try {
        body = JSON.parse(text) as { error?: string; code?: string };
        message = (body as { error?: string }).error || message;
        code = (body as { code?: string }).code;
      } catch {
        message = text;
      }
    }
    throw new ApiError(message, response.status, body, code);
  }

  const method = options.method?.toUpperCase() ?? 'GET';
  if (response.status === 204 || (method === 'DELETE' && !text)) {
    return undefined as T;
  }

  if (!text) {
    throw new Error(`Empty response body: ${response.status}`);
  }

  return JSON.parse(text) as T;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export function getWorkspace(): Promise<{ path: string }> {
  return request('/api/workspace');
}

export function setWorkspace(path: string): Promise<{ path: string }> {
  return request('/api/workspace', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function getTree(): Promise<TreeNode[]> {
  return request('/api/tree');
}

export function refreshWorkspace(): Promise<TreeNode[]> {
  return request('/api/tree/refresh', { method: 'POST' });
}

export function getNote(path: string): Promise<Note> {
  return request(`/api/note?path=${encodeURIComponent(path)}`);
}

export function saveNote(path: string, content: string, baseHash?: string, force = false): Promise<Note> {
  return request('/api/note', {
    method: 'PUT',
    body: JSON.stringify({ path, content, baseHash, force }),
  });
}

export function createNote(path: string, content = ''): Promise<Note> {
  return request('/api/note', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });
}

export function createFolder(path: string): Promise<FileOperationResult> {
  return request('/api/files/folder', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function deletePath(path: string): Promise<FileOperationResult> {
  return request(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

export function renamePath(path: string, newName: string): Promise<FileOperationResult> {
  return request('/api/files/rename', {
    method: 'PUT',
    body: JSON.stringify({ path, newName }),
  });
}

export function movePath(path: string, targetFolder: string): Promise<FileOperationResult> {
  return request('/api/files/move', {
    method: 'PUT',
    body: JSON.stringify({ path, targetFolder }),
  });
}

export function exportHtml(path: string): Promise<ExportHtmlResult> {
  return request('/api/export/html', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function deleteNote(path: string): Promise<void> {
  return request(`/api/note?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

export async function searchNotes(input: string | SearchRequest): Promise<SearchResponse> {
  const params = typeof input === 'string' ? { q: input } : input;
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const sort = params.sort ?? 'relevance';
  const query = new URLSearchParams({
    q: params.q,
    sort,
    limit: String(limit),
    offset: String(offset),
  });

  if (params.scope) {
    query.set('scope', params.scope);
  }

  const response = await request<SearchResponse | SearchResult[]>(`/api/search?${query.toString()}`);
  if (Array.isArray(response)) {
    return {
      results: response,
      total: response.length,
      limit,
      offset,
      sort,
    };
  }

  return {
    results: response.results ?? [],
    total: Number.isFinite(response.total) ? response.total : response.results?.length ?? 0,
    limit: response.limit ?? limit,
    offset: response.offset ?? offset,
    sort: response.sort ?? sort,
  };
}

export function getSearchIndexStatus(): Promise<SearchIndexStatus> {
  return request('/api/search/status');
}
