import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { flattenStyle } from '@/utils/flatten-style';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ILLUSTRATION_HEIGHT = SCREEN_HEIGHT * 0.38;

// ── Illustration components ──────────────────────────────────────────────────

function IllustrationFindSquad() {
  return (
    <View style={illustrations.container}>
      {/* Large circle — primary at 15% opacity */}
      <View
        style={{
          width: 180,
          height: 180,
          borderRadius: 90,
          backgroundColor: Colors.primary,
          opacity: 0.15,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 140,
          top: 30,
        }}
      />
      {/* Medium circle — accentGold at 20% opacity */}
      <View
        style={{
          width: 120,
          height: 120,
          borderRadius: 60,
          backgroundColor: Colors.accentGold,
          opacity: 0.2,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 20,
          top: 80,
        }}
      />
      {/* Small circle — accentGreen at 30% opacity */}
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: Colors.accentGreen,
          opacity: 0.3,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 80,
          top: 110,
        }}
      />
    </View>
  );
}

function IllustrationPlayTogether() {
  return (
    <View style={illustrations.container}>
      {/* Large rotated square — primary at 15% opacity */}
      <View
        style={{
          width: 140,
          height: 140,
          backgroundColor: Colors.primary,
          opacity: 0.15,
          position: 'absolute',
          transform: [{ rotate: '45deg' }],
          left: SCREEN_WIDTH * 0.5 - 130,
          top: 40,
        }}
      />
      {/* Medium circle — textHeading at 20% opacity */}
      <View
        style={{
          width: 130,
          height: 130,
          borderRadius: 65,
          backgroundColor: Colors.textHeading,
          opacity: 0.2,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 20,
          top: 60,
        }}
      />
      {/* Small circle — accentGold at 40% opacity */}
      <View
        style={{
          width: 70,
          height: 70,
          borderRadius: 35,
          backgroundColor: Colors.accentGold,
          opacity: 0.4,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 75,
          top: 115,
        }}
      />
    </View>
  );
}

function IllustrationBuildVillage() {
  return (
    <View style={illustrations.container}>
      {/* Large ring (border only) — accentGold */}
      <View
        style={{
          width: 200,
          height: 200,
          borderRadius: 100,
          borderWidth: 3,
          borderColor: Colors.accentGold,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 130,
          top: 20,
        }}
      />
      {/* Medium filled circle — accentGreen at 25% opacity */}
      <View
        style={{
          width: 130,
          height: 130,
          borderRadius: 65,
          backgroundColor: Colors.accentGreen,
          opacity: 0.25,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 55,
          top: 60,
        }}
      />
      {/* Small filled circle — primary at 20% opacity */}
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: Colors.primary,
          opacity: 0.2,
          position: 'absolute',
          left: SCREEN_WIDTH * 0.5 - 100,
          top: 100,
        }}
      />
    </View>
  );
}

// ── Page data ────────────────────────────────────────────────────────────────

const PAGE_IDS = ['1', '2', '3'];

// ── Main component ───────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const locationRequested = useRef(false);

  // Request location permission when the first page is visible
  useEffect(() => {
    if (currentIndex === 0 && !locationRequested.current) {
      locationRequested.current = true;
      Location.requestForegroundPermissionsAsync().catch(() => {
        // Silently ignore — we don't block the UI on location
      });
    }
  }, [currentIndex]);

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        const idx = parseInt(viewableItems[0].item as string, 10) - 1;
        setCurrentIndex(idx);
      }
    }
  ).current;

  const handleNext = () => {
    if (currentIndex < 2) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    }
  };

  const handleFinish = async () => {
    await AsyncStorage.setItem('onboardingComplete', 'true');
    router.replace('/(tabs)');
  };

  const renderIllustration = (index: number) => {
    if (index === 0) return <IllustrationFindSquad />;
    if (index === 1) return <IllustrationPlayTogether />;
    return <IllustrationBuildVillage />;
  };

  const getHeadline = (index: number) => {
    if (index === 0) return t('onboarding.screen1.headline');
    if (index === 1) return t('onboarding.screen2.headline');
    return t('onboarding.screen3.headline');
  };

  const getBody = (index: number) => {
    if (index === 0) return t('onboarding.screen1.body');
    if (index === 1) return t('onboarding.screen2.body');
    return t('onboarding.screen3.body');
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={PAGE_IDS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        keyExtractor={(item) => item}
        renderItem={({ item }) => {
          const idx = parseInt(item, 10) - 1;
          return (
            <View style={styles.page}>
              {/* Illustration area */}
              <View style={styles.illustrationArea}>{renderIllustration(idx)}</View>

              {/* Content area */}
              <View style={styles.contentArea}>
                <Text style={styles.headline}>{getHeadline(idx)}</Text>
                <Text style={styles.body}>{getBody(idx)}</Text>
              </View>
            </View>
          );
        }}
      />

      {/* Page dots */}
      <View style={styles.dotsRow}>
        {PAGE_IDS.map((_, i) => (
          <View
            key={i}
            style={flattenStyle([styles.dot, i === currentIndex && styles.dotActive])}
          />
        ))}
      </View>

      {/* Bottom buttons */}
      <View style={styles.buttonArea}>
        <TouchableOpacity
          style={styles.nextButton}
          onPress={currentIndex === 2 ? handleFinish : handleNext}
          activeOpacity={0.8}
        >
          <Text style={styles.nextButtonText}>
            {currentIndex === 2 ? t('auth.letsGo') : t('auth.next')}
          </Text>
        </TouchableOpacity>

        {currentIndex === 2 && (
          <TouchableOpacity onPress={handleFinish} activeOpacity={0.7} style={styles.skipWrapper}>
            <Text style={styles.skipText}>{t('auth.skip')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const illustrations = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
  },
  illustrationArea: {
    height: ILLUSTRATION_HEIGHT,
    overflow: 'hidden',
  },
  contentArea: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  headline: {
    fontFamily: Typography.display,
    fontSize: 28,
    color: Colors.textHeading,
  },
  body: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.secondary,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 24,
    borderRadius: 4,
  },
  buttonArea: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
    alignItems: 'center',
  },
  nextButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  nextButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.surface,
  },
  skipWrapper: {
    paddingVertical: Spacing.xs,
  },
  skipText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textPrimary,
  },
});