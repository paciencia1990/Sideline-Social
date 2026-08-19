export const FRIEND_CHAT_IMAGE_MEDIA_PROFILE_VERSION = 2 as const;
export const FRIEND_CHAT_IMAGE_SOURCE_LIMIT_BYTES = 5 * 1024 * 1024;

export type FriendChatImageVariantProfile = {
  initialMaxEdge: number;
  maxBytes: number;
  minimumQuality: number;
  qualitySteps: readonly number[];
  scaleSteps: readonly number[];
};

export type FriendChatImageCompressionAttempt = {
  maxEdge: number;
  quality: number;
};

export const FRIEND_CHAT_IMAGE_PROFILE_V2 = {
  display: {
    initialMaxEdge: 1440,
    maxBytes: 1024 * 1024,
    minimumQuality: 0.5,
    qualitySteps: [0.75, 0.68, 0.6, 0.5],
    scaleSteps: [1, 0.85, 0.72],
  },
  thumbnail: {
    initialMaxEdge: 480,
    maxBytes: 120 * 1024,
    minimumQuality: 0.45,
    qualitySteps: [0.65, 0.58, 0.52, 0.45],
    scaleSteps: [1, 0.85, 0.72],
  },
} as const satisfies Record<"display" | "thumbnail", FriendChatImageVariantProfile>;

export function createFriendChatImageCompressionAttempts(
  profile: FriendChatImageVariantProfile,
): FriendChatImageCompressionAttempt[] {
  return profile.scaleSteps.flatMap((scale) => profile.qualitySteps.map((quality) => ({
    maxEdge: Math.max(1, Math.round(profile.initialMaxEdge * scale)),
    quality: Math.max(profile.minimumQuality, quality),
  })));
}
