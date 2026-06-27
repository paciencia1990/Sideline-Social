import { Stack } from 'expo-router';
import { Colors } from '@/constants/theme';

export default function GamesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.textHeading,
        headerBackTitle: 'Games',
      }}
    >
      <Stack.Screen name="lobby" options={{ title: 'Lobby', headerBackVisible: false }} />
      <Stack.Screen name="results" options={{ title: 'Results', headerBackVisible: false }} />
      <Stack.Screen name="bomb-defusal" options={{ title: 'Bomb Defusal' }} />
      <Stack.Screen name="spot-difference" options={{ title: 'Spot the Difference' }} />
      <Stack.Screen name="trivia-blitz" options={{ title: 'Trivia Blitz' }} />
    </Stack>
  );
}