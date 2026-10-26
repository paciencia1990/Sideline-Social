import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { getDeviceTimeZone } from "@/utils/teamScheduleDisplay";

export function useDeviceTimeZone() {
  const [timezone, setTimezone] = useState(getDeviceTimeZone);

  useEffect(() => {
    const updateTimezone = () => setTimezone(getDeviceTimeZone());
    updateTimezone();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updateTimezone();
    });
    return () => subscription.remove();
  }, []);

  return timezone;
}
