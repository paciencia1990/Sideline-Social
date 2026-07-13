import { collection, documentId, getDocs, query, where } from "firebase/firestore";

import { db } from "@/config/firebase";
import { getPersistedDisplayName } from "@/utils/profileName";

const PROFILE_QUERY_CHUNK_SIZE = 10;

export async function getTeamRosterProfiles(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean)));
  const profiles: Record<string, string | null> = Object.fromEntries(
    uniqueUserIds.map((userId) => [userId, null]),
  );

  for (let index = 0; index < uniqueUserIds.length; index += PROFILE_QUERY_CHUNK_SIZE) {
    const userIdChunk = uniqueUserIds.slice(index, index + PROFILE_QUERY_CHUNK_SIZE);
    const snapshot = await getDocs(query(
      collection(db, "users"),
      where(documentId(), "in", userIdChunk),
    ));
    snapshot.docs.forEach((profileDocument) => {
      const profile = profileDocument.data();
      const persistedName = getPersistedDisplayName(profile);
      const firstAndLastName = getPersistedDisplayName({
        firstName: profile.firstName,
        lastName: profile.lastName,
      });
      profiles[profileDocument.id] = !looksLikeEmailAddress(persistedName)
        ? persistedName
        : (!looksLikeEmailAddress(firstAndLastName) ? firstAndLastName : null);
    });
  }

  return profiles;
}

function looksLikeEmailAddress(value: string | null) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value));
}
