import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import {
  getFirebaseAppCheckStatus,
  subscribeToFirebaseAppCheckStatus,
} from "@/config/firebaseAppCheck";
import { resolveModerationReportReadiness } from "@/config/firebaseAppCheckCore";
import { auth } from "@/config/firebase";

export type ModerationReportReadiness = "checking" | "ready" | "signedOut" | "unavailable";

export function useModerationReportReadiness(): ModerationReportReadiness {
  const [readiness, setReadiness] = useState<ModerationReportReadiness>("checking");

  useEffect(() => {
    let authResolved = false;
    let signedIn = false;
    let appCheckStatus = getFirebaseAppCheckStatus();
    const update = () => setReadiness(resolveModerationReportReadiness({
      appCheckStatus,
      authResolved,
      signedIn,
    }));
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      authResolved = true;
      signedIn = Boolean(user);
      update();
    });
    const unsubscribeAppCheck = subscribeToFirebaseAppCheckStatus((nextStatus) => {
      appCheckStatus = nextStatus;
      update();
    });
    return () => {
      unsubscribeAuth();
      unsubscribeAppCheck();
    };
  }, []);

  return readiness;
}
