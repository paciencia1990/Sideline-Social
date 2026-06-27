import React, { useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Typography } from '@/constants/theme';

export default function SplashScreen() {
  const router = useRouter();
  const opacity = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  useEffect(() => {
    // Fade in over 400ms
    opacity.value = withTiming(1, {
      duration: 400,
      easing: Easing.out(Easing.ease),
    });

    // After 400ms fade + 600ms hold = 1000ms total, navigate
    const timer = setTimeout(async () => {
      try {
        const onboardingComplete = await AsyncStorage.getItem('onboardingComplete');

        if (onboardingComplete !== 'true') {
          router.replace('/(auth)/onboarding');
          return;
        }

        // Check Firebase auth state
      // Skip Firebase check for now — go to sign-in
router.replace('/(auth)/sign-in');

      } catch {
        router.replace('/(auth)/sign-in');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={animatedStyle}>
        <Text style={styles.wordmark}>Sideline Social</Text>
        <Text style={styles.tagline}>turn wait time into game time</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.textHeading,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  wordmark: {
    fontFamily: Typography.heading,
    fontSize: 36,
    color: Colors.surface,
    textAlign: 'center',
  },
  tagline: {
    fontFamily: Typography.accent,
    fontSize: 18,
    color: Colors.accentGreen,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
});