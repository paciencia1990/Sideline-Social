import { closeNativeUploadBlob, readNativeUploadBlob } from "./nativeUploadBlob";

export type FriendChatUploadSnapshot = {
  bytesTransferred: number;
  metadata: { contentType?: string | null };
  totalBytes: number;
};

export type FriendChatUploadTaskObserver = {
  on: (
    event: "state_changed",
    next: (snapshot: FriendChatUploadSnapshot) => void,
    error: (error: unknown) => void,
    complete: () => void,
  ) => unknown;
  snapshot: FriendChatUploadSnapshot;
};

export async function readFriendChatPhotoUploadBlob(
  uri: string,
  expectedSizeBytes: number,
  createRequest: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<Blob> {
  if (!/^file:\/\//iu.test(uri)) throw new Error("invalid_local_media_uri");
  // React Native's native XHR reader returns a native-backed Blob. Do not
  // convert through bytes: Firebase's multipart path joins the body with
  // new Blob(parts), and RN rejects ArrayBuffer/Uint8Array parts there.
  return readNativeUploadBlob(uri, expectedSizeBytes, {
    canceledCode: "media_upload_canceled",
    invalidUriCode: "invalid_local_media_uri",
    localReadCode: "media_local_read_failed",
    localReadTimeoutCode: "media_local_read_timeout",
    sizeMismatchCode: "media_upload_size_mismatch",
  }, createRequest);
}

export function closeFriendChatPhotoUploadBlob(blob?: Blob) {
  closeNativeUploadBlob(blob);
}

export function observeFriendChatUploadTask(
  task: FriendChatUploadTaskObserver,
  expectedSizeBytes: number,
  contentType: string,
  onProgress?: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    task.on("state_changed", (snapshot) => {
      const progress = snapshot.totalBytes > 0
        ? Math.min(1, Math.max(0, snapshot.bytesTransferred / snapshot.totalBytes))
        : 0;
      onProgress?.(progress);
    }, reject, () => {
      const snapshot = task.snapshot;
      if (
        snapshot.bytesTransferred !== expectedSizeBytes ||
        snapshot.totalBytes !== expectedSizeBytes ||
        snapshot.metadata.contentType !== contentType
      ) {
        reject(new Error("media_upload_verification_failed"));
        return;
      }
      resolve();
    });
  });
}

export async function settleFriendChatPhotoUploadPair(
  main: Promise<void>,
  thumbnail: Promise<void>,
  cancelBoth: () => void,
) {
  let firstFailure: unknown;
  const guard = (completion: Promise<void>) => completion.catch((error) => {
    if (firstFailure === undefined) {
      firstFailure = error;
      cancelBoth();
    }
    throw error;
  });
  await Promise.allSettled([guard(main), guard(thumbnail)]);
  if (firstFailure !== undefined) throw firstFailure;
}
