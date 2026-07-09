import { uploadNoteImage } from './assets';
import { formatUploadedImagesMarkdown } from './markdownImages';
import { uploadViaPicGo } from './picgo';
import type { ImageUploadSettings } from '../types';

const DEFAULT_SETTINGS: ImageUploadSettings = {
  mode: 'local',
  picgoServerUrl: 'http://127.0.0.1:36677',
  picgoSecret: '',
};

let currentSettings: ImageUploadSettings = { ...DEFAULT_SETTINGS };

export function applyImageUploadSettings(settings: Partial<ImageUploadSettings>) {
  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    mode: settings.mode === 'picgo' ? 'picgo' : 'local',
    picgoServerUrl: settings.picgoServerUrl?.trim() || DEFAULT_SETTINGS.picgoServerUrl,
    picgoSecret: settings.picgoSecret?.trim() || '',
  };
}

export function getImageUploadSettings(): ImageUploadSettings {
  return { ...currentSettings };
}

export async function uploadEditorImage(notePath: string, file: File): Promise<string> {
  if (currentSettings.mode === 'picgo') {
    return uploadViaPicGo(file, {
      serverUrl: currentSettings.picgoServerUrl,
      secret: currentSettings.picgoSecret,
    });
  }
  return uploadNoteImage(notePath, file);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(file.name);
}

export function prepareImageFilesForUpload(files: File[]): File[] {
  const seen = new Map<string, number>();

  return files.filter(isImageFile).map((file) => {
    const name = file.name?.trim() || 'image.png';
    const normalized = name.toLowerCase();
    const count = seen.get(normalized) ?? 0;
    seen.set(normalized, count + 1);

    if (count === 0) {
      return file.name ? file : renameFile(file, name);
    }

    return renameFile(file, appendNameSuffix(name, count));
  });
}

export async function uploadEditorImages(notePath: string, files: File[]): Promise<string[]> {
  const prepared = prepareImageFilesForUpload(files);
  const uploads: string[] = [];

  for (const file of prepared) {
    uploads.push(await uploadEditorImage(notePath, file));
  }

  return uploads;
}

export async function uploadEditorImagesMarkdown(notePath: string, files: File[]): Promise<string> {
  const refs = await uploadEditorImages(notePath, files);
  return formatUploadedImagesMarkdown(refs);
}

function appendNameSuffix(name: string, suffix: number): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}-${suffix}`;
  return `${name.slice(0, dot)}-${suffix}${name.slice(dot)}`;
}

function renameFile(file: File, name: string): File {
  return new File([file], name, {
    type: file.type || 'image/png',
    lastModified: file.lastModified,
  });
}
