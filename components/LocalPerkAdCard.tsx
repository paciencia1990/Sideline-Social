import React from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { MapPin, X } from "lucide-react-native";

import { Card } from "@/components/Card";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export type LocalPerkAdCardProps = {
  accessibilityLabel: string;
  advertiserName: string;
  ctaLabel: string;
  disclosure: string;
  headline: string;
  logoAccessibilityLabel: string;
  logoInitials?: string;
  logoSource?: ImageSourcePropType;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export type LocalPerkOfferPreviewModalProps = {
  offer: {
    advertiserName: string;
    closeLabel: string;
    ctaLabel: string;
    description: string;
    directionsAccessibilityLabel: string;
    directionsLabel: string;
    disclosure: string;
    eligibleDays: string;
    eligibleDaysLabel: string;
    expiration: string;
    expirationLabel: string;
    headline: string;
    logoAccessibilityLabel: string;
    logoInitials?: string;
    logoSource?: ImageSourcePropType;
    modalTitle: string;
    participatingLocation: string;
    participatingLocationLabel: string;
    previewOnlyLabel: string;
    redemptionInstructions: string;
    redemptionInstructionsLabel: string;
    terms: string;
    termsLabel: string;
    venueContext: string;
    venueContextLabel: string;
  };
  onClose: () => void;
  visible: boolean;
};

export function LocalPerkAdCard({
  accessibilityLabel,
  advertiserName,
  ctaLabel,
  disclosure,
  headline,
  logoAccessibilityLabel,
  logoInitials,
  logoSource,
  onPress,
  style,
}: LocalPerkAdCardProps) {
  return (
    <Card style={[styles.card, style]}>
      <View accessible={false} style={styles.goldAccent} />
      <View style={styles.disclosureRow}>
        <Text accessibilityRole="text" style={styles.disclosure}>{disclosure}</Text>
      </View>
      <View style={styles.identityRow}>
        <LocalPerkLogo
          accessibilityLabel={logoAccessibilityLabel}
          advertiserName={advertiserName}
          initials={logoInitials}
          source={logoSource}
        />
        <View style={styles.identityCopy}>
          <Text style={styles.advertiserName}>{advertiserName}</Text>
        </View>
      </View>
      <Text style={styles.headline}>{headline}</Text>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}
      >
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </Pressable>
    </Card>
  );
}

export function LocalPerkOfferPreviewModal({
  offer,
  onClose,
  visible,
}: LocalPerkOfferPreviewModalProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.modalBackdrop}>
        <Pressable
          accessibilityLabel={offer.closeLabel}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.modalBackdropDismiss}
        />
        <View accessibilityViewIsModal style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleCopy}>
              <Text style={styles.modalDisclosure}>{offer.disclosure}</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>{offer.modalTitle}</Text>
            </View>
            <Pressable
              accessibilityLabel={offer.closeLabel}
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeButton}
            >
              <X accessible={false} color={Colors.textHeading} size={22} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.modalIdentity}>
              <LocalPerkLogo
                accessibilityLabel={offer.logoAccessibilityLabel}
                advertiserName={offer.advertiserName}
                initials={offer.logoInitials}
                source={offer.logoSource}
              />
              <View style={styles.identityCopy}>
                <Text style={styles.advertiserName}>{offer.advertiserName}</Text>
                <Text style={styles.headline}>{offer.headline}</Text>
              </View>
            </View>

            <Text style={styles.description}>{offer.description}</Text>
            <OfferDetail label={offer.participatingLocationLabel} value={offer.participatingLocation} />
            <OfferDetail label={offer.eligibleDaysLabel} value={offer.eligibleDays} />
            <OfferDetail label={offer.expirationLabel} value={offer.expiration} />
            <OfferDetail label={offer.termsLabel} value={offer.terms} />
            <OfferDetail label={offer.redemptionInstructionsLabel} value={offer.redemptionInstructions} />
            <OfferDetail label={offer.venueContextLabel} value={offer.venueContext} />

            <Pressable
              accessibilityLabel={offer.directionsAccessibilityLabel}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              disabled
              style={styles.disabledDirectionsButton}
            >
              <MapPin accessible={false} color={Colors.textPrimary} size={18} />
              <Text style={styles.disabledDirectionsText}>{offer.directionsLabel}</Text>
              <Text style={styles.previewOnlyText}>{offer.previewOnlyLabel}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LocalPerkLogo({
  accessibilityLabel,
  advertiserName,
  initials,
  source,
}: {
  accessibilityLabel: string;
  advertiserName: string;
  initials?: string;
  source?: ImageSourcePropType;
}) {
  const fallback = getFallbackInitials(initials, advertiserName);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={styles.logoContainer}
    >
      {source ? (
        <Image accessible={false} resizeMode="cover" source={source} style={styles.logoImage} />
      ) : (
        <Text style={styles.logoInitials}>{fallback}</Text>
      )}
    </View>
  );
}

function OfferDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.offerDetail}>
      <Text style={styles.offerDetailLabel}>{label}</Text>
      <Text style={styles.offerDetailValue}>{value}</Text>
    </View>
  );
}

function getFallbackInitials(initials: string | undefined, advertiserName: string) {
  const cleaned = initials?.trim() || advertiserName
    .split(/\s+/u)
    .map((part) => part[0])
    .join("");
  return cleaned.slice(0, 2).toUpperCase() || "LP";
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.accentGold,
    borderWidth: 1.5,
    gap: Spacing.sm,
    overflow: "hidden",
  },
  goldAccent: {
    alignSelf: "stretch",
    backgroundColor: Colors.accentGold,
    height: 4,
    marginHorizontal: -Spacing.md,
    marginTop: -Spacing.md,
  },
  disclosureRow: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: `${Colors.accentGold}26`,
    borderColor: Colors.accentGold,
    borderRadius: Radius.sm,
    borderWidth: 1,
    minHeight: 28,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  disclosure: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 16,
    textTransform: "uppercase",
  },
  identityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
    minWidth: 0,
  },
  identityCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  logoContainer: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.accentGold,
    borderRadius: Radius.button,
    borderWidth: 1.5,
    flexShrink: 0,
    height: 60,
    justifyContent: "center",
    overflow: "hidden",
    width: 60,
  },
  logoImage: {
    height: "100%",
    width: "100%",
  },
  logoInitials: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 20,
    letterSpacing: 0.8,
  },
  advertiserName: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 16,
    lineHeight: 22,
  },
  headline: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 19,
    lineHeight: 25,
  },
  description: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 21,
  },
  ctaButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 44,
    paddingHorizontal: Spacing.md,
  },
  ctaButtonPressed: {
    opacity: 0.86,
  },
  ctaText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  modalBackdrop: {
    backgroundColor: `${Colors.textHeading}66`,
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdropDismiss: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderColor: Colors.accentGold,
    borderWidth: 1,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    gap: Spacing.sm,
    maxHeight: "88%",
    padding: Spacing.lg,
    ...Shadow.card,
  },
  modalHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.sm,
    justifyContent: "space-between",
  },
  modalTitleCopy: {
    flex: 1,
    gap: Spacing.xs,
    minWidth: 0,
  },
  modalDisclosure: {
    color: Colors.accentGold,
    fontFamily: Typography.bodyBold,
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 16,
    textTransform: "uppercase",
  },
  modalTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 24,
    lineHeight: 31,
  },
  closeButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  modalContent: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  modalIdentity: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  offerDetail: {
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: Spacing.xs,
    padding: Spacing.sm,
  },
  offerDetailLabel: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 11,
    lineHeight: 16,
    textTransform: "uppercase",
  },
  offerDetailValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 21,
  },
  disabledDirectionsButton: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    opacity: 0.72,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  disabledDirectionsText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  previewOnlyText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
  },
});
