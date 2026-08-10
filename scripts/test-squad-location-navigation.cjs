const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const squad = read('app/(tabs)/squad.tsx');
const rootIndex = read('app/index.tsx');
const context = read('context/SquadContext.tsx');
const service = read('services/squadService.ts');
const resume = read('services/systemRouteResumeService.ts');
const translations = read('i18n/index.ts');

assert.match(squad, /useFocusEffect/);
assert.match(squad, /AppState\.addEventListener\("change"/);
assert.match(squad, /screenFocusedRef\.current[\s\S]*recheckPermission/);
assert.match(squad, /permissionCheckInFlightRef/);
assert.match(squad, /permissionRequestInFlightRef/);
assert.match(squad, /locationInFlightRef/);
assert.match(squad, /requestId !== locationRequestIdRef\.current/);
assert.match(squad, /rememberSquadSystemReturn[\s\S]*requestLocationPermission/);
assert.match(squad, /rememberSquadSystemReturn[\s\S]*Linking\.openSettings/);
assert.match(squad, /permission\.status === "granted"[\s\S]*retrieveLocation/);
assert.match(squad, /permission\.canAskAgain \? "denied" : "permanent"/);
assert.match(squad, /retryLocation/);
assert.match(squad, /searchByVenue/);
assert.doesNotMatch(squad, /router\.(?:replace|push)\(["']\/\(tabs\)["']/, 'permission flow must never route to Home');

assert.match(context, /squadSearchRequestId/);
assert.match(context, /requestId === squadSearchRequestId\.current/);
assert.match(context, /fetchNearbySquads[\s\S]*requestId === squadSearchRequestId\.current[\s\S]*setNearbySquads/);
assert.match(context, /searchVenueSquads[\s\S]*requestId === squadSearchRequestId\.current[\s\S]*setNearbySquads/);

assert.match(service, /LocationPermissionState = "undetermined" \| "granted" \| "denied" \| "error"/);
assert.match(service, /permission-request[\s\S]*status: "error", canAskAgain: true/);
assert.doesNotMatch(`${service}\n${squad}`, /requestBackgroundPermissionsAsync|watchPositionAsync|startLocationUpdatesAsync|startGeofencingAsync/);

assert.match(resume, /SQUAD_SYSTEM_RETURN_ROUTE = '\/\(tabs\)\/squad'/);
assert.match(resume, /SYSTEM_ROUTE_RESUME_TTL_MS/);
assert.match(resume, /value\.route !== SQUAD_SYSTEM_RETURN_ROUTE/);
assert.match(resume, /AsyncStorage\.removeItem\(SYSTEM_ROUTE_RESUME_KEY\)/);
const notificationIndex = rootIndex.indexOf('getPendingNotificationOpenTarget');
const resumeIndex = rootIndex.indexOf('consumeSystemReturnRoute()', notificationIndex);
const homeFallbackIndex = rootIndex.indexOf('router.replace("/(tabs)")', resumeIndex);
assert.ok(notificationIndex >= 0 && resumeIndex > notificationIndex, 'notification opens retain first priority');
assert.ok(homeFallbackIndex > resumeIndex, 'the allowlisted system return route wins before the Home fallback');
assert.match(rootIndex.slice(resumeIndex, homeFallbackIndex), /router\.replace\(systemReturnRoute/);

assert.equal((translations.match(/retryLocation:/g) ?? []).length, 2, 'Retry Location needs English and Spanish text');
assert.equal((translations.match(/locationDisclosure:/g) ?? []).length, 2, 'the existing foreground-location privacy disclosure remains localized');

console.log('Squad permission return routing, retry states, stale-response protection, and foreground-only location tests passed.');
