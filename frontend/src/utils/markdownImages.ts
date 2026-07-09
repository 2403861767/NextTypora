import { resolveVaultAssetPath } from './assets';

/**
 * Milkdown Crepe stores image aspect ratio in markdown alt text (e.g. ![1.00](url)).
 * Normalize to empty alt for cleaner, Typora-compatible markdown.
 */
export function normalizeEditorImageMarkdown(content: string): string {
  return content.replace(/!\[\d+\.\d{2}\]\(/g, '![](');
}

export function formatImageMarkdown(src: string, caption = ''): string {
  const trimmedCaption = caption.trim();
  if (trimmedCaption) {
    return `![](${src} "${trimmedCaption}")`;
  }
  return `![](${src})`;
}

export function parseImageMarkdown(text: string): { src: string; caption: string } | null {
  const match = text.trim().match(/^!\[[^\]]*\]\(([^\s)]+)(?:\s+"((?:\\.|[^"\\])*)")?\)$/);
  if (!match) return null;
  return {
    src: match[1],
    caption: match[2]?.replace(/\\"/g, '"') ?? '',
  };
}

export interface MarkdownImageReference {
  raw: string;
  alt: string;
  src: string;
  title: string;
  index: number;
  kind: 'remote' | 'local';
  resolvedPath?: string;
}

export interface ImageDiagnosticOptions {
  notePath: string;
  workspacePath?: string;
  existingAssetPaths?: Iterable<string>;
  workspaceAssetPaths?: Iterable<string>;
}

export interface MarkdownImageDiagnostics {
  images: MarkdownImageReference[];
  remoteImages: MarkdownImageReference[];
  localImages: MarkdownImageReference[];
  missingImages: MarkdownImageReference[];
  unreferencedAssets: string[];
}

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(['"])((?:\\.|(?!\4).)*)\4)?\s*\)/g;
const IMAGE_ASSET_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

export function extractMarkdownImages(content: string, notePath = ''): MarkdownImageReference[] {
  return Array.from(content.matchAll(MARKDOWN_IMAGE_PATTERN), (match) => {
    const src = safeDecodeUriComponent(match[2] || match[3] || '');
    const kind = isRemoteImageSource(src) ? 'remote' : 'local';
    return {
      raw: match[0],
      alt: match[1] ?? '',
      src,
      title: (match[5] ?? '').replace(/\\"/g, '"'),
      index: match.index ?? 0,
      kind,
      resolvedPath: kind === 'local' && notePath ? resolveVaultAssetPath(notePath, src) : undefined,
    };
  });
}

export function formatUploadedImagesMarkdown(srcs: string[]): string {
  return srcs.map((src) => formatImageMarkdown(src)).join('\n\n');
}

export function isRemoteImageSource(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

export function isImageAssetPath(path: string): boolean {
  return IMAGE_ASSET_PATTERN.test(path);
}

export function diagnoseMarkdownImages(
  content: string,
  options: ImageDiagnosticOptions,
): MarkdownImageDiagnostics {
  const images = extractMarkdownImages(content, options.notePath);
  const existingAssets = options.existingAssetPaths
    ? new Set(Array.from(options.existingAssetPaths, normalizeAssetPathForCompare))
    : null;
  const referencedLocalAssets = new Set<string>();

  const remoteImages = images.filter((image) => image.kind === 'remote');
  const localImages = images.filter((image) => {
    if (image.resolvedPath) {
      referencedLocalAssets.add(normalizeAssetPathForCompare(image.resolvedPath));
    }
    return image.kind === 'local';
  });

  const missingImages = existingAssets
    ? localImages.filter((image) => {
      if (!image.resolvedPath) return false;
      return !existingAssets.has(normalizeAssetPathForCompare(image.resolvedPath));
    })
    : [];

  const unreferencedAssets = options.workspaceAssetPaths
    ? Array.from(options.workspaceAssetPaths)
      .filter((assetPath) => isImageAssetPath(assetPath))
      .filter((assetPath) => !referencedLocalAssets.has(normalizeAssetPathForCompare(assetPath)))
      .sort()
    : [];

  return {
    images,
    remoteImages,
    localImages,
    missingImages,
    unreferencedAssets,
  };
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeAssetPathForCompare(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}
