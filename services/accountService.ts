import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";

export type DeleteAccountResult = {
  deleted: true;
  anonymizedDocuments: number;
  deletedDocuments: number;
  deletedStorageObjects: number;
};

export type DeleteAccountRequest = {
  appleAuthorizationCode?: string;
};

export async function deleteOwnAccount(request: DeleteAccountRequest = {}) {
  const callable = httpsCallable<DeleteAccountRequest, DeleteAccountResult>(functions, "deleteOwnAccount", {
    timeout: 540_000,
  });
  return (await callable(request)).data;
}
