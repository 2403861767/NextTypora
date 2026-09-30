export function joinLocalPath(dir: string, relativePath: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '');
  return `${base}${sep}${rel}`;
}

export function normalizeFolderPath(path: string): string {
  if (!path) return '';
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function foldersEqual(a: string, b: string): boolean {
  return normalizeFolderPath(a) === normalizeFolderPath(b);
}

/** fullPath 在 folder 内部（任意层子目录）时返回它相对 folder 的路径（/ 分隔），否则返回 undefined；比较规则同 foldersEqual */
export function relativePathInFolder(folder: string, fullPath: string): string | undefined {
  const base = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalized = fullPath.replace(/\\/g, '/');
  if (!base || normalized.charAt(base.length) !== '/') return undefined;
  if (!foldersEqual(normalized.slice(0, base.length), base)) return undefined;
  return normalized.slice(base.length + 1) || undefined;
}

export function parseLocalMarkdownPath(fullPath: string): { dir: string; relativePath: string } {
  const normalized = fullPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) {
    return { dir: '', relativePath: normalized };
  }

  const sepIndex = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
  let dir = fullPath.slice(0, sepIndex);
  const relativePath = fullPath.slice(sepIndex + 1).replace(/\\/g, '/');

  if (/^[A-Za-z]:$/.test(dir.replace(/\\/g, ''))) {
    dir = `${dir}${fullPath.includes('\\') ? '\\' : '/'}`;
  }

  return { dir, relativePath };
}
