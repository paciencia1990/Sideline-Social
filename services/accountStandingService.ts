import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/config/firebase";
import type { AccountStanding } from "@/types/accountStanding";

const getStanding = httpsCallable<Record<string, never>, AccountStanding>(
  functions,
  "getMyAccountStanding",
);
const submitAppeal = httpsCallable<
  { explanation: string; revision: number },
  { appealStatus: "submitted"; alreadySubmitted: boolean }
>(functions, "submitMyModerationAppeal");

export async function fetchMyAccountStanding() {
  return (await getStanding({})).data;
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
