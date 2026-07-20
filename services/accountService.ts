import { httpsCallable } from "firebase/functions";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";

import { auth, functions } from "@/config/firebase";

export type DeleteAccountResult = {
  deleted: true;
  anonymizedDocuments: number;
  deletedDocuments: number;
  deletedStorageObjects: number;
};

export async function deleteOwnAccount(password: string) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error("Email account is unavailable for reauthentication.");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  const callable = httpsCallable<Record<string, never>, DeleteAccountResult>(functions, "deleteOwnAccount", {
    timeout: 540_000,
  });
  return (await callable({})).data;
}
