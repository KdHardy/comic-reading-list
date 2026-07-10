const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000] as const;
export const THUMBNAIL_MAX_RETRIES = RETRY_DELAYS_MS.length;

export function thumbnailRetryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  return dataUrl.split(',')[1] ?? '';
}

/** PostgREST returns bytea as hex (\\x...) or base64 depending on client/version. */
export function byteaToDataUrl(mime: string, raw: string): string {
  const contentType = mime || 'image/jpeg';

  if (raw.startsWith('data:')) {
    return raw;
  }

  if (raw.startsWith('\\x')) {
    const hex = raw.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
    }
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  }

  return `data:${contentType};base64,${raw}`;
}
