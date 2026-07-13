import { useEffect, useRef } from "react";
import { router, useRootNavigationState, useSegments } from "expo-router";

import { routeRequiresAuthentication, SIGN_IN_ROUTE } from "@/constants/routes";
import { useAuth } from "@/context/AuthContext";

export function AuthNavigationGuard() {
  const { loading, user } = useAuth();
  const navigationState = useRootNavigationState();
  const segments = useSegments();
  const rootSegment = segments[0];
  const redirectedSegment = useRef<string | null>(null);

  useEffect(() => {
    const shouldRedirect = Boolean(
      navigationState?.key
      && !loading
      && !user
      && routeRequiresAuthentication(rootSegment),
    );

    if (!shouldRedirect) {
      redirectedSegment.current = null;
      return;
    }

    if (redirectedSegment.current === rootSegment) return;
    redirectedSegment.current = rootSegment;
    router.replace(SIGN_IN_ROUTE as never);
  }, [loading, navigationState?.key, rootSegment, user]);

  return null;
}