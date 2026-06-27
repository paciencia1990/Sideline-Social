import { Stack } from 'expo-router';
import { Colors } from '@/constants/theme';

export default function SocialLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.textHeading,
      }}
    />
  );
}