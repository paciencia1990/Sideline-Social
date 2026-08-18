import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";

import { rtdb } from "@/config/firebase";
import { serverAdjustedNow } from "@/utils/gameStartSynchronization";

export function useFirebaseServerClock() {
  const [offsetMs, setOffsetMs] = useState(0);

  useEffect(() => onValue(ref(rtdb, ".info/serverTimeOffset"), (snapshot) => {
    const value = snapshot.val();
    setOffsetMs(typeof value === "number" && Number.isFinite(value) ? value : 0);
  }), []);

  return {
    offsetMs,
    now: () => serverAdjustedNow(Date.now(), offsetMs),
  };
}
