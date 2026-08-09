export const LOCAL_PERK_AD_PREVIEW_ENABLED = __DEV__ === true;

type LocalPerkPreviewTranslator = (key: string, options?: Record<string, unknown>) => string;

export type LocalPerkPreviewOffer = {
  accessibilityLabel: string;
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
  logoInitials: string;
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

export function getLocalPerkPreviewOffer(t: LocalPerkPreviewTranslator): LocalPerkPreviewOffer {
  return {
    accessibilityLabel: t("localPerkPreview.cardAccessibilityLabel"),
    advertiserName: t("localPerkPreview.advertiserName"),
    closeLabel: t("localPerkPreview.closeOffer"),
    ctaLabel: t("localPerkPreview.ctaLabel"),
    description: t("localPerkPreview.description"),
    directionsAccessibilityLabel: t("localPerkPreview.directionsAccessibilityLabel"),
    directionsLabel: t("localPerkPreview.directionsLabel"),
    disclosure: t("localPerkPreview.disclosure"),
    eligibleDays: t("localPerkPreview.eligibleDays"),
    eligibleDaysLabel: t("localPerkPreview.eligibleDaysLabel"),
    expiration: t("localPerkPreview.expiration"),
    expirationLabel: t("localPerkPreview.expirationLabel"),
    headline: t("localPerkPreview.headline"),
    logoAccessibilityLabel: t("localPerkPreview.logoAccessibilityLabel"),
    logoInitials: "PP",
    modalTitle: t("localPerkPreview.modalTitle"),
    participatingLocation: t("localPerkPreview.participatingLocation"),
    participatingLocationLabel: t("localPerkPreview.participatingLocationLabel"),
    previewOnlyLabel: t("localPerkPreview.previewOnlyLabel"),
    redemptionInstructions: t("localPerkPreview.redemptionInstructions"),
    redemptionInstructionsLabel: t("localPerkPreview.redemptionInstructionsLabel"),
    terms: t("localPerkPreview.terms"),
    termsLabel: t("localPerkPreview.termsLabel"),
    venueContext: t("localPerkPreview.context"),
    venueContextLabel: t("localPerkPreview.contextLabel"),
  };
}
