import { getPublicUserProfiles } from "@/services/publicProfileService";
import { looksLikeEmailAddress as isEmailAddress } from "@/utils/friendPrivacy";

const PROFILE_QUERY_CHUNK_SIZE = 10;

export async function getTeamRosterProfiles(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean)));
  const profiles: Record<string, string | null> = Object.fromEntries(
    uniqueUserIds.map((userId) => [userId, null]),
  );

  for (let index = 0; index < uniqueUserIds.length; index += PROFILE_QUERY_CHUNK_SIZE) {
    const userIdChunk = uniqueUserIds.slice(index, index + PROFILE_QUERY_CHUNK_SIZE);
    const publicProfiles = await getPublicUserProfiles(userIdChunk);
    publicProfiles.forEach((profile) => {
      profiles[profile.userId] = !looksLikeEmailAddress(profile.displayName)
        ? profile.displayName
        : null;
    });
  }

  return profiles;
}

export function looksLikeEmailAddress(value: string | null) {
  return isEmailAddress(value);
}
