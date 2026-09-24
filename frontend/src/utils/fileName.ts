const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const isWindowsPlatform = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);

/**
 * 校验单个文件/文件夹名在 Windows 上是否合法（与后端 FileService.validateWindowsFileName 规则一致），
 * 非 Windows 平台不做限制。返回错误提示，合法时返回 null。
 */
export function windowsFileNameError(name: string, windows = isWindowsPlatform): string | null {
  if (!windows) return null;
  const invalid = name.match(WINDOWS_INVALID_CHARS);
  if (invalid) {
    const shown = invalid[0] < ' ' ? '控制字符' : invalid[0];
    return `名称“${name}”包含 Windows 不允许的字符：${shown}（不能包含 < > : " / \\ | ? *）`;
  }
  if (/[. ]$/.test(name)) {
    return `名称“${name}”不能以点或空格结尾`;
  }
  const dot = name.indexOf('.');
  const baseName = (dot >= 0 ? name.slice(0, dot) : name).trimEnd();
  if (WINDOWS_RESERVED_NAME.test(baseName)) {
    return `名称“${name}”是 Windows 保留名称，请换一个名称`;
  }
  return null;
}

/** 校验相对路径中的每一段（新建时允许输入 notes/hello.md 这种子路径）。 */
export function windowsPathError(path: string, windows = isWindowsPlatform): string | null {
  for (const segment of path.split(/[\\/]/)) {
    if (!segment || segment === '.' || segment === '..') continue;
    const error = windowsFileNameError(segment, windows);
    if (error) return error;
  }
  return null;
}
