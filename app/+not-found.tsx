import { LinkText } from "@/components/ui/link";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { Link, Stack } from "expo-router";
import { SafeAreaView } from "react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <SafeAreaView>
        <VStack>
          <Text size="2xl">This screen doesn&apos;t exist.</Text>
          <Link href="/">
            <LinkText>Go to home screen!</LinkText>
          </Link>
        </VStack>
      </SafeAreaView>
    </>
  );
}
