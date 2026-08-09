export type CancelableUploadTask = {
  cancel: () => boolean;
};

export type FriendChatImageUploadCancelResult = {
  canceled: boolean;
  errors: number;
  full: boolean;
  thumbnail: boolean;
};

export function cancelFriendChatImageUploadTasks(
  fullTask?: CancelableUploadTask | null,
  thumbnailTask?: CancelableUploadTask | null,
): FriendChatImageUploadCancelResult {
  const full = cancelTask(fullTask);
  const thumbnail = cancelTask(thumbnailTask);
  return {
    canceled: full.canceled || thumbnail.canceled,
    errors: full.errors + thumbnail.errors,
    full: full.canceled,
    thumbnail: thumbnail.canceled,
  };
}

function cancelTask(task?: CancelableUploadTask | null) {
  if (!task) return { canceled: false, errors: 0 };
  try {
    return { canceled: task.cancel() === true, errors: 0 };
  } catch {
    return { canceled: false, errors: 1 };
  }
}
