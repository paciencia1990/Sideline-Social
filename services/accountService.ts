import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";

export type DeleteAccountResult = {
  deleted: true;
  anonymizedDocuments: number;
  deletedDocuments: number;
  deletedStorageObjects: number;
};

export async function deleteOwnAccount() {
  const callable = httpsCallable<Record<string, never>, DeleteAccountResult>(functions, "deleteOwnAccount", {
    timeout: 540_000,
  });
  return (await callable({})).data;
}
