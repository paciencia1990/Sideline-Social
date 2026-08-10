const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

function loadTypeScript(relativePath, devValue) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("__DEV__", "module", "exports", output)(devValue, loaded, loaded.exports);
  return loaded.exports;
}

const home = read("app", "(tabs)", "index.tsx");
const component = read("components", "LocalPerkAdCard.tsx");
const previewConfig = read("constants", "localPerkPreview.ts");
const translations = read("i18n", "index.ts");
const packageJson = read("package.json");
const scrollLayout = home.slice(home.indexOf("<ScrollView"), home.indexOf("</ScrollView>"));
const cardBody = component.slice(component.indexOf("export function LocalPerkAdCard"), component.indexOf("export function LocalPerkOfferPreviewModal"));
const modalBody = component.slice(component.indexOf("export function LocalPerkOfferPreviewModal"), component.indexOf("function LocalPerkLogo"));
const previewConfigProd = loadTypeScript("constants/localPerkPreview.ts", false);
const previewConfigDev = loadTypeScript("constants/localPerkPreview.ts", true);

assert.equal(previewConfigDev.LOCAL_PERK_AD_PREVIEW_ENABLED, false, "Local Perk must remain disabled in development.");
assert.equal(previewConfigProd.LOCAL_PERK_AD_PREVIEW_ENABLED, false, "Local Perk must remain disabled in production.");
assert.match(previewConfig, /LOCAL_PERK_AD_PREVIEW_ENABLED:\s*boolean\s*=\s*false/, "The centralized Local Perk kill switch must be explicitly false.");
assert.doesNotMatch(previewConfig, /__DEV__|process\.env|Constants\.expoConfig|extra\?/, "No build environment may implicitly enable Local Perk.");

const challengeIndex = scrollLayout.indexOf("<ChallengeCard");
const localPerkIndex = scrollLayout.indexOf("<LocalPerkAdCard");
const icebreakerIndex = scrollLayout.indexOf("<IcebreakerCard />");
assert.ok(challengeIndex >= 0, "Home must still render Weekly Challenge.");
assert.ok(icebreakerIndex > challengeIndex, "Weekly Challenge must appear before Icebreaker.");
assert.ok(localPerkIndex > icebreakerIndex, "The disabled future slot must remain after Icebreaker so nearby Home content keeps its order.");
assert.equal((scrollLayout.match(/<LocalPerkAdCard/g) ?? []).length, 1, "The future card architecture must not be duplicated.");
assert.equal((home.match(/<LocalPerkOfferPreviewModal/g) ?? []).length, 1, "The future modal architecture must not be duplicated.");
assert.match(home, /const localPerkPreviewOffer = LOCAL_PERK_AD_PREVIEW_ENABLED \? getLocalPerkPreviewOffer\(t\) : null;/, "Disabled Local Perk must not build offer content.");
assert.match(scrollLayout, /\{LOCAL_PERK_AD_PREVIEW_ENABLED && localPerkPreviewOffer \? \(\s*<LocalPerkAdCard[\s\S]*?\) : null\}/, "The card must be an unwrapped null-rendering conditional with no reserved layout space.");
assert.match(home.slice(home.indexOf("</ScrollView>")), /\{LOCAL_PERK_AD_PREVIEW_ENABLED && localPerkPreviewOffer \? \(\s*<LocalPerkOfferPreviewModal[\s\S]*?\) : null\}/, "The offer modal must remain unmounted while the kill switch is false.");
assert.match(home, /onPress=\{\(\) => setLocalPerkPreviewOpen\(true\)\}/, "The preserved future interaction must exist only inside the disabled card branch.");
assert.match(home, /onClose=\{\(\) => setLocalPerkPreviewOpen\(false\)\}/, "The preserved future close action must exist only inside the disabled modal branch.");

assert.match(component, /export type LocalPerkAdCardProps/, "Local Perk card must expose typed reusable props.");
assert.match(component, /logoSource\?: ImageSourcePropType/, "The card must support a logo image source.");
assert.match(component, /logoInitials\?: string/, "The card must support an initials fallback.");
assert.match(component, /function LocalPerkLogo/, "The logo fallback must be centralized.");
assert.match(component, /getFallbackInitials/, "The initials fallback must remain useful when no logo is supplied.");

assert.ok(component.indexOf("styles.disclosure") < component.indexOf("styles.headline"), "The disclosure must appear before the ad headline.");
assert.match(cardBody, /disclosure/, "The compact card must render an Advertisement disclosure.");
assert.match(cardBody, /LocalPerkLogo/, "The compact card must render the advertiser logo.");
assert.match(cardBody, /advertiserName/, "The compact card must render the advertiser name.");
assert.match(cardBody, /headline/, "The compact card must render the offer headline.");
assert.match(cardBody, /ctaLabel/, "The compact card must render the View Offer button.");
assert.doesNotMatch(cardBody, /description|venueContext|validityText|eligibleDays|expiration|terms|redemptionInstructions|participatingLocation/, "The compact card must not render venue, dates, terms, context, redemption, or supporting copy.");
assert.doesNotMatch(home, /<LocalPerkAdCard[\s\S]*description=|<LocalPerkAdCard[\s\S]*venueContext=|<LocalPerkAdCard[\s\S]*validityText=/, "Home must not pass detail-only copy into the compact Local Perk card.");
assert.match(component, /accessibilityRole="image"/, "The placeholder logo must have an accessible image representation.");
assert.match(component, /accessibilityLabel=\{accessibilityLabel\}/, "The CTA must expose the ad accessibility label.");
assert.match(component, /accessibilityViewIsModal/, "The offer preview must be exposed as a modal to assistive tech.");
assert.match(component, /accessibilityState=\{\{ disabled: true \}\}/, "The directions preview action must be disabled.");
assert.match(component, /accessibilityLabel=\{offer\.closeLabel\}/, "The modal must have an accessible close action.");
assert.match(component, /minHeight: 44/, "The View Offer CTA must keep at least a 44-pixel touch target.");

for (const detail of [
  "offer.description",
  "offer.participatingLocation",
  "offer.eligibleDays",
  "offer.expiration",
  "offer.terms",
  "offer.redemptionInstructions",
  "offer.venueContext",
]) {
  assert.match(modalBody, new RegExp(detail.replace(".", "\\.")), `${detail} must be shown in the offer preview pop-up.`);
}

assert.doesNotMatch(component, /Colors\.(?:accentGreen|communicationLink|communicationLinkPressed)/, "The Local Perk card and pop-up must not use sage theme tokens.");
assert.match(component, /Colors\.primary/, "The View Offer button must use the approved red primary token.");
assert.match(component, /Colors\.background/, "The detail pop-up must use the approved cream background token.");
assert.match(component, /styles\.disclosureRow/, "The ad disclosure must have a distinct top row treatment.");
assert.match(component, /borderColor: Colors\.accentGold/, "The ad card must use a visible gold outline.");
assert.match(component, /Colors\.accentGold/, "Gold should be used for restrained ad disclosure and border treatment.");
assert.match(component, /Colors\.surface/, "The card and modal sheet must use the approved surface token.");
assert.match(component, /Colors\.textHeading/, "The card must keep navy heading text.");

for (const key of [
  "disclosure", "advertiserName", "logoAccessibilityLabel", "headline", "description",
  "eligibleDaysLabel", "eligibleDays", "expirationLabel", "expiration", "ctaLabel",
  "contextLabel", "context", "cardAccessibilityLabel", "modalTitle",
  "participatingLocationLabel", "participatingLocation", "termsLabel", "terms",
  "redemptionInstructionsLabel", "redemptionInstructions",
  "directionsLabel", "directionsAccessibilityLabel", "previewOnlyLabel", "closeOffer",
]) {
  assert.equal((translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length >= 2, true, `${key} must have English and Spanish Local Perk copy.`);
}
assert.match(translations, /disclosure: 'Advertisement'/, "English ad disclosure must be localized.");
assert.match(translations, /disclosure: 'Anuncio'/, "Spanish ad disclosure must be localized.");
assert.match(translations, /10% off your family\\u2019s meal/, "English offer headline must be localized.");
assert.match(translations, /10% de descuento en la comida de tu familia/, "Spanish offer headline must be localized.");
assert.match(translations, /Shown because this offer is near your Home Squad venue\./, "English venue context must be localized.");
assert.match(translations, /Se muestra porque esta oferta est\\u00e1 cerca de la sede de tu Home Squad\./, "Spanish venue context must be localized.");
assert.match(translations, /Redemption instructions/, "English redemption instructions label must be localized.");
assert.match(translations, /Instrucciones de canje/, "Spanish redemption instructions label must be localized.");
assert.doesNotMatch(component, /localPerkPreview\./, "The card component must receive display strings, not render raw localization keys.");

const localPerkSources = `${component}\n${previewConfig}`;
assert.doesNotMatch(localPerkSources, /analytics|Firebase|Firestore|httpsCallable|collection\(|addDoc|setDoc|expo-location|requestLocation|Linking|openURL|router/iu, "The preview must not track, write backend data, request location, or open external navigation.");
assert.doesNotMatch(packageJson, /admob|adsense|doubleclick|facebook-ads|react-native-google-mobile-ads/iu, "The preview must not add advertising SDKs.");
assert.doesNotMatch(component, /FlatList|Carousel|Banner|Interstitial/iu, "The preview must not be a carousel, banner, pop-up, or interstitial.");

console.log("Disabled Local Perk kill switch, Home ordering, zero-layout slot, preserved architecture, and no-side-effect tests passed.");
