const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const squadScreen = read("app/(tabs)/squad.tsx");
const home = read("app/(tabs)/index.tsx");
const games = read("app/(tabs)/games.tsx");
const identity = read("components/SquadIdentity.tsx");
const selector = read("components/SquadSelector.tsx");
const service = read("services/squadService.ts");
const functions = read("functions/src/index.ts");
const detail = read("app/(social)/squad-detail.tsx");
const administration = read("components/SquadAdministrationCard.tsx");
const adminFunctions = read("functions/src/squadAdmin.ts");
const adminCore = read("functions/src/squadAdminCore.ts");
const squadCard = read("components/SquadCard.tsx");
const sports = read("constants/sports.ts");
const nearbyCallable = functions.slice(functions.indexOf("export const findNearbyVenueSportSquads"), functions.indexOf("export const searchVenueSportSquads"));
const detailCallable = functions.slice(functions.indexOf("export const getVenueSportSquadDetail"), functions.indexOf("// ---------------------------------------------------------------------------", functions.indexOf("export const getVenueSportSquadDetail")));
const detailService = service.slice(service.indexOf("export async function fetchSquadDetail"), service.indexOf("function selectedSquadStorageKey"));
const presenceCleanup = functions.slice(functions.indexOf("export const deactivateInactiveMembers"), functions.indexOf("export const awardGameStars"));

assert.match(identity, /venueName[\s\S]*sportName/, "venue and sport must be rendered as separate text lines");
assert.match(selector, /SquadIdentity/, "selector must use the shared two-line identity");
assert.match(home, /SquadIdentity/, "Home cards must use the shared two-line identity");
assert.match(games, /selectedSquadId/, "Games must use the explicit selected Squad");
assert.match(squadCard, /getSquadSportOption\(squad\.sportId\)\.emoji/, "Squad list cards must render the original sport emoji indicator");
assert.match(squadCard, /accessibilityRole="image"[\s\S]*styles\.emojiWrap/, "Squad list sport indicators must preserve accessible image semantics");
assert.match(squadCard, /emojiWrap:\s*\{[^}]*backgroundColor:\s*Colors\.background[^}]*height:\s*44[^}]*width:\s*44[^}]*\}/, "Squad list sport emoji container must keep the original size and background");
assert.match(squadCard, /emoji:\s*\{\s*fontSize:\s*22\s*\}/, "Squad list sport emoji must keep the original size");
assert.doesNotMatch(squadCard, /SquadSportIcon|squadSportIconResolver|SPORT_ICON_BY_ID/, "Squad list cards must not use the removed outline sport icon redesign");
assert.match(sports, /normalizeSquadSportId/, "sport emoji selection must keep existing alias and capitalization normalization");
assert.match(sports, /return "other"/, "unknown sport values must keep the existing other-sport fallback");
for (const sportId of ["baseball", "softball", "basketball", "soccer", "football", "volleyball", "swimming", "lacrosse", "hockey", "tennis", "track-field", "cheer", "gymnastics", "dance", "other"]) {
  assert.match(sports, new RegExp(`"${sportId}"`), `${sportId} must remain a supported Squad sport`);
}
assert.doesNotMatch(`${home}\n${games}`, /mySquadIds\s*\[\s*0\s*\]/, "active flows must not depend on array order");
assert.match(squadScreen, /Alert\.alert\([\s\S]*locationDisclosure[\s\S]*requestLocationPermission/, "the explanation must precede the system request");
assert.match(squadScreen, /searchByVenue/, "manual venue search must remain available");
assert.doesNotMatch(squadScreen, /useEffect\([\s\S]{0,300}requestLocationPermission/, "permission must not be requested on mount");
assert.doesNotMatch(`${service}\n${squadScreen}\n${home}`, /updateUserLocation/, "parent coordinates must not be persisted");
assert.doesNotMatch(`${service}\n${squadScreen}`, /startLocationUpdatesAsync|watchPositionAsync|requestBackgroundPermissionsAsync|startGeofencingAsync/, "continuous/background tracking must not be introduced");
assert.doesNotMatch(nearbyCallable, /joinVenueSportSquad|memberIds|userId|child|email/i, "nearby search must not join or expose private membership/profile data");
assert.match(detailService, /getVenueSportSquadDetail/, "Squad detail must use the field-limited callable");
assert.doesNotMatch(detailService, /getDoc|publicUserProfiles|getPublicUserProfiles/, "Squad detail must not read raw Squad or profile documents");
assert.equal(
  (service.match(/getDoc\(doc\(db,\s*["']squads["']/g) ?? []).length,
  1,
  "only member bootstrap may point-read a raw Squad document",
);
assert.match(detailCallable, /viewerIsMember[\s\S]*members[\s\S]*extraMemberCount/, "detail returns an explicit member-aware projection");
assert.doesNotMatch(detailCallable, /venueGeohash|normalizedVenueName|venueSportKey|createdBy|creatorId/, "detail omits internal Squad identity fields");
assert.match(functions, /membershipStatus:\s*'active'/);
assert.match(functions, /presenceStatus:\s*'away'/);
assert.doesNotMatch(presenceCleanup, /membershipStatus:\s*'left'|isActive:\s*false/, "presence expiration must never end durable membership");
assert.doesNotMatch(functions, /sidelineStars[\s\S]{0,300}joinVenueSportSquad/, "Squad join must not award Stars");
assert.match(detail, /SquadAdministrationCard/, "the active Squad details route must render administration");
assert.match(detail, /isMember && squadDetail\.members\.length > 0/, "nonmembers cannot render roster previews");
assert.match(detail, /last_active_admin[\s\S]*showLastAdminExplanation/, "last-admin leave receives a dedicated explanation");
assert.match(detail, /loadError[\s\S]*detailUnavailableTitle[\s\S]*loadSquadDetail/, "transient detail failures must show retry recovery");
assert.match(detail, /detailNotFoundTitle[\s\S]*common\.back/, "missing Squads must remain distinct from transient failures");
assert.match(service, /logSquadDiagnostic\("detail", error\);\s*throw error;/, "Squad detail service must preserve backend failures");
assert.match(administration, /accessibilityRole="button"/, "administration controls retain button semantics");
assert.match(administration, /helpManageBody[\s\S]*responsibilityBody/, "recipients see responsibility copy before accepting");
assert.match(administration, /requestSquadAdminAccess/, "orphaned Squads expose manual recovery request UI");
assert.doesNotMatch(administration, /email|childIds|coordinates|currentLocation/i, "administration UI must not render private member data");
assert.match(service, /getSquadAdministration[\s\S]*inviteSquadAdmin[\s\S]*respondToSquadAdminInvitation/);
assert.match(adminFunctions, /where\('membershipStatus', '==', 'active'\)/, "server authority uses durable active membership");
assert.match(adminFunctions, /runTransaction[\s\S]*last_active_admin/, "last-admin protection is server transactional");
assert.doesNotMatch(adminCore, /coach|staff|leaderboard|presenceStatus/, "mode, staff, leaderboard, and presence never grant admin authority");
console.log("Squad UI, location, selection, and privacy source tests passed.");
