import { Stack } from "expo-router";
import { AuthenticatedRouteGate } from "@/components/AuthenticatedRouteGate";

export default function SocialLayout() {
  return (
    <AuthenticatedRouteGate>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthenticatedRouteGate>
  );
}