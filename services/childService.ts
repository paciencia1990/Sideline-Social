import {
  collection,
  deleteField,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";

export type ParentChildProfile = {
  id: string;
  parentUid: string;
  displayName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export async function getCurrentUserChildren(): Promise<ParentChildProfile[]> {
  const user = auth.currentUser;
  if (!user) return [];

  const snapshot = await getDocs(collection(db, "users", user.uid, "children"));
  const legacyNameIndexes = snapshot.docs.filter((childDocument) =>
    Object.prototype.hasOwnProperty.call(childDocument.data(), "normalizedName"),
  );
  if (legacyNameIndexes.length > 0) {
    await Promise.all(legacyNameIndexes.map((childDocument) => updateDoc(childDocument.ref, {
      normalizedName: deleteField(),
      updatedAt: serverTimestamp(),
    })));
  }
  return snapshot.docs
    .map((childDocument) => normalizeChildProfile(user.uid, childDocument.id, childDocument.data()))
    .filter((child) => child.displayName)
    .sort((first, second) => first.displayName.localeCompare(second.displayName));
}

export async function createChildProfile(displayName: string): Promise<ParentChildProfile> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to add a child profile.");

  const name = displayName.trim();
  if (!name || name.length > 80) throw new Error("A valid child name is required.");

  const childReference = doc(collection(db, "users", user.uid, "children"));
  const profile: ParentChildProfile = {
    id: childReference.id,
    parentUid: user.uid,
    displayName: name,
  };
  await setDoc(childReference, {
    displayName: profile.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return profile;
}

export async function updateChildProfile(childId: string, displayName: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to update a child profile.");

  const name = displayName.trim();
  if (!childId || !name || name.length > 80) throw new Error("A valid child profile is required.");
  await updateDoc(doc(db, "users", user.uid, "children", childId), {
    displayName: name,
    normalizedName: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteChildProfile(childId: string): Promise<boolean> {
  const callable = httpsCallable<{ childId: string }, { deleted: boolean }>(functions, "deleteChildProfile");
  const response = await callable({ childId });
  return response.data.deleted;
}

export async function setParentTeamChildLinks(teamId: string, childIds: string[]): Promise<void> {
  const callable = httpsCallable<
    { teamId: string; childIds: string[] },
    { childIds: string[] }
  >(functions, "setParentTeamChildLinks");
  await callable({ teamId, childIds: uniqueChildIds(childIds) });
}

function normalizeChildProfile(parentUid: string, id: string, data: Record<string, unknown>): ParentChildProfile {
  return {
    id,
    parentUid,
    displayName: readString(data.displayName),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function uniqueChildIds(childIds: string[]) {
  return Array.from(new Set(childIds.map((childId) => childId.trim()).filter(Boolean)));
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}