import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import type { AccountStanding } from "@/types/accountStanding";
import { measureDevelopmentPerformance } from "@/utils/performanceDiagnostics";

const getStanding = httpsCallable<Record<string, never>, AccountStanding>(
  functions,
  "getMyAccountStanding",
);
const submitAppeal = httpsCallable<
  { explanation: string; revision: number },
  { appealStatus: "submitted"; alreadySubmitted: boolean }
>(functions, "submitMyModerationAppeal");

let standingRequest: { uid: string; promise: Promise<AccountStanding> } | null = null;

export async function fetchMyAccountStanding() {
  const uid = auth.currentUser?.uid ?? "";
  if (uid && standingRequest?.uid === uid) return standingRequest.promise;

  const request = measureDevelopmentPerformance(
    "startup.account-standing",
    async () => (await getStanding({})).data,
  );
  if (!uid) return request;

  const trackedRequest = request.finally(() => {
    if (standingRequest?.promise === trackedRequest) standingRequest = null;
  });
  standingRequest = { uid, promise: trackedRequest };
  return trackedRequest;
}

export async function submitAccountStandingAppeal(
  explanation: string,
  revision: number,
) {
  return (await submitAppeal({ explanation, revision })).data;
}

export function subscribeToMyAccountStanding(
  uid: string,
  onChange: () => void,
  onError: (error: unknown) => void,
) {
  return onSnapshot(
    doc(db, "accountStandingPublic", uid),
    onChange,
    onError,
  );
}
