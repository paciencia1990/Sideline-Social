import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";
import {
  getVerifiedFriendUserId,
  inspectPublicUserProfiles,
  type PublicFriendProfileRecord,
} from "@/utils/friendRequestMapping";
import { formatPublicUserName } from "@/utils/friendPrivacy";

export type PublicUserProfile = PublicFriendProfileRecord;

export type SuggestedConnection = PublicUserProfile & {
  photoURL: string | null;
  sharedSquadName: string | null;
  sharedActivity: string | null;
  mutualConnectionCount: number | null;
};

const MAX_PUBLIC_PROFILE_IDS = 50;

export async function getPublicUserProfiles(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter((userId) => userId.length > 0)));
  if (uniqueUserIds.length === 0) return [];
  if (uniqueUserIds.some((userId) => getVerifiedFriendUserId(userId) !== userId)) {
    throw createPublicProfileError("public-profile/invalid-user-ids");
  }

  const loadProfiles = httpsCallable<
    { userIds: string[] },
    { profiles: unknown }
  >(functions, "getPublicUserProfiles");
  const profiles: PublicUserProfile[] = [];
  let returnedProfileCount = 0;
  let malformedProfileCount = 0;
  for (let index = 0; index < uniqueUserIds.length; index += MAX_PUBLIC_PROFILE_IDS) {
    const batchUserIds = uniqueUserIds.slice(index, index + MAX_PUBLIC_PROFILE_IDS);
    const response = await loadProfiles({ userIds: batchUserIds });
    const inspectedProfiles = inspectPublicUserProfiles(response.data.profiles);
    const privacySafeProfiles = inspectedProfiles.profiles.filter((profile) => (
      profile.displayName === null || formatPublicUserName(profile.displayName) === profile.displayName
    ));
    profiles.push(...privacySafeProfiles);
    returnedProfileCount += inspectedProfiles.counts.returnedProfileCount;
    malformedProfileCount +=
      inspectedProfiles.counts.profilesMissingUserIdCount +
      inspectedProfiles.counts.profilesWithEmptyUserIdCount +
      inspectedProfiles.counts.profilesWithInvalidUserIdCount +
      inspectedProfiles.counts.profilesWithInvalidDisplayNameCount +
      (inspectedProfiles.profiles.length - privacySafeProfiles.length);
  }
  if (malformedProfileCount > 0 && __DEV__) {
    console.info("[publicProfiles] malformed response", {
      operation: "public-profile-response-validation",
      returnedProfileCount,
      malformedProfileCount,
    });
  }
  return profiles;
}

export async function getSuggestedConnections(queryText: string) {
  const loadSuggestions = httpsCallable<
    { queryText: string },
    { suggestions: SuggestedConnection[] }
  >(functions, "getSuggestedConnections");
  const response = await loadSuggestions({ queryText: queryText.trim() });
  return response.data.suggestions;
}

function createPublicProfileError(code: string) {
  const error = new Error("Public profiles are unavailable.") as Error & { code: string };
  error.code = code;
  return error;
}
