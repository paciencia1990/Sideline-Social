const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const detail = read("app/(social)/squad-detail.tsx");
const administration = read("components/SquadAdministrationCard.tsx");
const translations = read("i18n/index.ts");

const shouldShowManageSquad = (state) => state?.callerIsAdmin === true;
assert.equal(shouldShowManageSquad({ callerIsAdmin: true }), true, "trusted active admin sees Manage Squad");
assert.equal(shouldShowManageSquad({ callerIsAdmin: false }), false, "ordinary member does not see Manage Squad");
assert.equal(shouldShowManageSquad(null), false, "unresolved or failed authorization stays hidden");
assert.equal(shouldShowManageSquad({
  callerIsAdmin: false,
  createdBy: "current-user",
  mode: "coach",
  staff: true,
  presenceStatus: "active",
}), false, "creator, mode, staff, and presence hints cannot grant visibility");

const manageBlockStart = detail.indexOf("{administration?.callerIsAdmin === true ? (");
const manageBlockEnd = detail.indexOf("{/* Stats row */}", manageBlockStart);
assert.ok(manageBlockStart >= 0 && manageBlockEnd > manageBlockStart, "Manage Squad must be placed directly after primary identity");
const manageBlock = detail.slice(manageBlockStart, manageBlockEnd);
assert.match(manageBlock, /squadAdmin\.administratorStatus/);
assert.match(manageBlock, /squadAdmin\.manageDescription/);
assert.match(manageBlock, /squadAdmin\.manageAccessibility/);
assert.match(manageBlock, /accessibilityRole="button"/);
assert.match(manageBlock, /onPress=\{scrollToAdministration\}/);
assert.doesNotMatch(manageBlock, /createdBy|creatorId|parent|coach|staff|presence|leaderboard/i);

assert.match(detail, /<ScrollView[\s\S]*ref=\{scrollRef\}/, "the screen retains its existing ScrollView ref");
assert.match(detail, /scrollRef\.current\?\.scrollTo\(\{ animated: true, y: targetY \}\)/, "the existing ScrollView performs an animated section scroll");
assert.match(detail, /onLayout=\{handleAdministrationLayout\}/, "the canonical administration section supplies its measured position");
assert.match(detail, /Math\.max\(0, sectionY - Spacing\.lg\)/, "scroll offset keeps the heading below the top edge");
assert.match(detail, /onMomentumScrollEnd=\{focusAdministrationHeading\}/);
assert.match(administration, /AccessibilityInfo\.setAccessibilityFocus/);
assert.match(administration, /accessibilityRole="header" ref=\{headingRef\}/, "the destination heading receives accessibility focus");
assert.equal((detail.match(/<SquadAdministrationCard(?=[\s>])/g) || []).length, 1, "management controls must not be duplicated");
assert.doesNotMatch(detail, /squadAdmin\.title/, "Squad Details must not duplicate the administration heading");

assert.match(administration, /onStateChange\?\.\(null\)/, "authorization refresh or failure hides the top action");
assert.match(administration, /useFocusEffect/, "returning to Squad Details refreshes trusted administration state");
assert.match(administration, /AppState\.addEventListener/, "returning to the foreground refreshes trusted administration state");
assert.match(administration, /requestSquadAdminAccess/, "orphan recovery remains available");
assert.match(detail, /minHeight: 48[\s\S]*manageSquadButtonText:[\s\S]*flexShrink: 1/, "the action supports Android touch targets and large text wrapping");

for (const key of ["manageSquad", "administratorStatus", "manageDescription", "manageAccessibility"]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs English and Spanish copy`);
}

console.log("Squad Manage action visibility, placement, scrolling, refresh, accessibility, localization, and single-card tests passed.");
