import type * as ImagePicker from 'expo-image-picker';

import { getSupabaseClient } from '@/lib/supabase';

function guessImageExt(asset: ImagePicker.ImagePickerAsset): string {
  const name = asset.fileName ?? '';
  const fromName = name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,6}$/.test(fromName)) return fromName;

  const uri = asset.uri ?? '';
  const fromUri = uri.split('?')[0]?.split('#')[0]?.split('.').pop()?.toLowerCase();
  if (fromUri && /^[a-z0-9]{1,6}$/.test(fromUri)) return fromUri;

  return 'jpg';
}

function guessContentType(ext: string): string {
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    default:
      return 'image/jpeg';
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function uploadSubmissionPhoto(params: {
  asset: ImagePicker.ImagePickerAsset;
  teamId: string;
  taskId: string;
  bucket?: string;
}): Promise<{ path: string }> {
  const { asset, teamId, taskId } = params;
  const bucket = (params.bucket ?? process.env.EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET)
    ?.trim()
    .slice(0, 200) || 'submission-photos';

  if (!asset?.uri) throw new Error('Missing photo URI.');
  if (!teamId.trim()) throw new Error('Missing team id.');
  if (!taskId.trim()) throw new Error('Missing task id.');

  const ext = guessImageExt(asset);
  const contentType = guessContentType(ext);
  const path = `${teamId.trim()}/${taskId.trim()}/${makeId()}.${ext}`;

  // In Expo/RN, local file URIs can be fetched and converted to a Blob.
  const blob = await (await fetch(asset.uri)).blob();

  const supabase = getSupabaseClient();
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message || 'Upload failed.');

  return { path };
}

