import { getPublicUserProfiles } from "@/services/publicProfileService";
import { looksLikeEmailAddress as isEmailAddress } from "@/utils/friendPrivacy";

const PROFILE_QUERY_CHUNK_SIZE = 10;

export type TeamRosterProfile = {
  displayName: string | null;
  profileState: "available" | "unnamed" | "deleted";
};

export async function getTeamRosterProfiles(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean)));
  const profiles: Record<string, TeamRosterProfile> = Object.fromEntries(
    uniqueUserIds.map((userId) => [userId, { displayName: null, profileState: "deleted" }]),
  );

  for (let index = 0; index < uniqueUserIds.length; index += PROFILE_QUERY_CHUNK_SIZE) {
    const userIdChunk = uniqueUserIds.slice(index, index + PROFILE_QUERY_CHUNK_SIZE);
    const publicProfiles = await getPublicUserProfiles(userIdChunk);
    publicProfiles.forEach((profile) => {
      profiles[profile.userId] = {
        displayName: !looksLikeEmailAddress(profile.displayName) ? profile.displayName : null,
        profileState: profile.profileState,
      };
    });
  }

  return profiles;
}

export function looksLikeEmailAddress(value: string | null) {
  return isEmailAddress(value);
}
