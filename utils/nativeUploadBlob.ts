export type NativeUploadBlobReadOptions = {
  invalidUriCode: string;
  localReadCode: string;
  localReadTimeoutCode: string;
  canceledCode: string;
  sizeMismatchCode: string;
};

export async function readNativeUploadBlob(
  uri: string,
  expectedSizeBytes: number,
  options: NativeUploadBlobReadOptions,
  createRequest: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<Blob> {
  if (!/^(?:file|content|cache):/iu.test(uri)) throw new Error(options.invalidUriCode);
  if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1) {
    throw new Error(options.sizeMismatchCode);
  }

  return new Promise<Blob>((resolve, reject) => {
    const request = createRequest();
    let settled = false;
    const finish = (error?: Error, blob?: Blob) => {
      if (settled) return;
      settled = true;
      request.onload = request.onerror = request.onabort = request.ontimeout = null;
      if (error) {
        closeNativeUploadBlob(blob);
        reject(error);
      } else {
        resolve(blob!);
      }
    };
    request.onload = () => {
      let blob: Blob | undefined;
      try {
        const response: unknown = request.response;
        if (response instanceof Blob) blob = response;
        if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
          finish(new Error(options.localReadCode), blob);
        } else if (!blob || blob.size !== expectedSizeBytes) {
          finish(new Error(options.sizeMismatchCode), blob);
        } else {
          finish(undefined, blob);
        }
      } catch {
        finish(new Error(options.localReadCode), blob);
      }
    };
    request.onerror = () => finish(new Error(options.localReadCode));
    request.onabort = () => finish(new Error(options.canceledCode));
    request.ontimeout = () => finish(new Error(options.localReadTimeoutCode));
    try {
      request.open("GET", uri, true);
      request.responseType = "blob";
      request.timeout = 30_000;
      request.send();
    } catch {
      finish(new Error(options.localReadCode));
    }
  });
}

export function closeNativeUploadBlob(blob?: Blob) {
  const nativeBlob = blob as (Blob & { close?: () => void }) | undefined;
  nativeBlob?.close?.();
}
