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

export type PublicUserSearchRelationship =
  | "none"
  | "outgoing-request"
  | "incoming-request"
  | "friends";

export type PublicUserSearchResult = PublicUserProfile & {
  relationship: PublicUserSearchRelationship;
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

export async function searchPublicUserProfiles(
  query: string,
  limit = 20,
): Promise<PublicUserSearchResult[]> {
  const searchProfiles = httpsCallable<
    { query: string; limit: number },
    { results: unknown }
  >(functions, "searchPublicUserProfiles");
  const response = await searchProfiles({ query: query.trim(), limit });
  const records = Array.isArray(response.data.results) ? response.data.results : [];
  const inspected = inspectPublicUserProfiles(records);
  const relationshipsByUserId = new Map<string, PublicUserSearchRelationship>();
  records.forEach((record) => {
    if (!record || typeof record !== "object") return;
    const userId = "userId" in record && typeof record.userId === "string"
      ? record.userId
      : "";
    const relationship = "relationship" in record ? record.relationship : null;
    if (
      userId &&
      ["none", "outgoing-request", "incoming-request", "friends"].includes(String(relationship))
    ) {
      relationshipsByUserId.set(userId, relationship as PublicUserSearchRelationship);
    }
  });
  return inspected.profiles
    .filter((profile) => (
      profile.profileState === "available" &&
      Boolean(formatPublicUserName(profile.displayName)) &&
      relationshipsByUserId.has(profile.userId)
    ))
    .map((profile) => ({
      ...profile,
      relationship: relationshipsByUserId.get(profile.userId) ?? "none",
    }));
}

export async function updatePublicUserProfile(input: {
  firstName: string;
  lastName: string;
  photoURL?: string | null;
}) {
  const updateProfile = httpsCallable<
    typeof input,
    { profile: PublicUserProfile }
  >(functions, "updatePublicUserProfile");
  const response = await updateProfile(input);
  return response.data.profile;
}

function createPublicProfileError(code: string) {
  const error = new Error("Public profiles are unavailable.") as Error & { code: string };
  error.code = code;
  return error;
}
