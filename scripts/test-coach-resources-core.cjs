const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const core = require(path.join(process.cwd(), "functions", "lib", "coachResourceHelpCore.js"));
const checklists = read("content/coachResources/checklists.ts");
const templates = read("content/coachResources/communicationTemplates.ts");
const tips = read("content/coachResources/proTips.ts");
const service = read("services/coachResourcesService.ts");
const hub = read("app/coach/resources/index.tsx");
const checklistLibrary = read("app/coach/resources/checklists/index.tsx");
const checklistDetail = read("app/coach/resources/checklists/[checklistId].tsx");
const communicationDetail = read("app/coach/resources/communication/[templateId].tsx");
const help = read("app/coach/resources/help/index.tsx");
const helpResult = read("app/coach/resources/help/result.tsx");
const composer = read("app/coach/messages.tsx");
const functionsSource = read("functions/src/coachResourceHelp.ts");
const translations = read("i18n/index.ts");

for (const id of ["first-time-setup", "before-season", "practice-day", "game-day", "player-safety", "end-season"]) {
  assert.match(checklists, new RegExp(`id: "${id}"`), `${id} checklist must exist`);
}
assert.ok((checklists.match(/item\("/g) ?? []).length >= 60, "six useful checklists must contain at least 60 reviewed items");
assert.equal((templates.match(/template\("/g) ?? []).length, 16, "communication library must include 16 templates");
assert.equal((tips.match(/tip\("/g) ?? []).length, 30, "tip library must include 30 curated tips");
assert.match(service, /getLocalCalendarDayNumber[\s\S]*% tips\.length/, "daily tip must use stable local-calendar modulo selection");
assert.match(service, /sidelineSocial\.coachChecklistProgress\.v1[\s\S]*userId[\s\S]*checklistId/, "progress must be isolated by version, user, and checklist");
assert.doesNotMatch(`${checklists}\n${templates}\n${tips}\n${service}`, /sidelineStars|awardStars|completeWeeklyChallenge/, "Coach Resources must not award Stars");

const hubLayout = hub.slice(hub.indexOf("<ResourceCard"), hub.lastIndexOf("</ScrollView>"));
assert.ok(hubLayout.indexOf("checklistsBody") < hubLayout.indexOf("communicationCardBody"), "Checklists must precede Communication");
assert.ok(hubLayout.indexOf("communicationCardBody") < hubLayout.indexOf("styles.tipCard"), "Communication must precede Pro Tip");
assert.ok(hubLayout.indexOf("styles.tipCard") < hubLayout.indexOf("needHelp"), "guided help must remain last");
assert.doesNotMatch(hub, /firstPractice|gameDayBody|positiveTips|whatToSay/, "placeholder cards must be removed");
assert.doesNotMatch(checklistLibrary, /section\.items|completedItemIds\.map/, "checklist library must not expand all checklist items");
assert.match(checklistDetail, /accessibilityRole="checkbox"[\s\S]*accessibilityState=\{\{ checked \}\}/, "checklist items must expose checkbox state");
assert.match(checklistDetail, /Alert\.alert[\s\S]*resetCoachChecklistProgress/, "reset must require confirmation");
assert.match(communicationDetail, /TextInput[\s\S]*findUnresolvedCoachPlaceholders[\s\S]*\/coach\/messages/, "templates must be editable, validated, and routed to the composer");
assert.match(composer, /draftBody[\s\S]*draftTitle[\s\S]*selectedTeamId/, "announcement composer must accept drafts and require explicit team context");
assert.match(help, /CATEGORIES\.map/, "AI help must use guided categories");
assert.match(help, /privacyReminder/, "AI help must show a privacy reminder");
assert.match(help, /generateCoachResourceHelp/, "AI help must use the trusted callable boundary");
assert.doesNotMatch(help, /apiKey|COACH_AI_API_KEY|provider/i, "the client help route must not contain provider credentials");
assert.match(helpResult, /result\.sections[\s\S]*result\.canSendAsAnnouncement/, "structured results must render natively and gate announcements");
assert.match(functionsSource, /context\.auth[\s\S]*validateCoachHelpRequest[\s\S]*enforceRateLimit[\s\S]*COACH_AI_API_KEY/, "server boundary must authenticate, validate, rate-limit, and keep credentials server-side");

const request = core.validateCoachHelpRequest({
  category: "parent_concern",
  situation: "A parent raised a concern after the game.",
  desiredOutcome: "Arrange a calm follow-up.",
  tone: "warm",
  clientRequestId: "request_12345",
  locale: "en",
});
assert.equal(request.category, "parent_concern");
assert.throws(() => core.validateCoachHelpRequest({ category: "other", situation: "short", clientRequestId: "request_12345", locale: "en" }), /invalid_situation/);
assert.throws(() => core.validateCoachHelpRequest({ category: "other", situation: "x".repeat(1501), clientRequestId: "request_12345", locale: "en" }), /value_too_long/);
assert.equal(core.isCoachHelpSafetySensitive({ ...request, situation: "There is immediate danger." }), true);
assert.equal(core.createCoachHelpSafetyResult("es").canSendAsAnnouncement, false);
assert.equal(core.validateCoachHelpResult({ resultType: "message", title: "Draft", body: "A calm private reply.", canSendAsAnnouncement: true }, "parent_concern").canSendAsAnnouncement, false);
assert.equal(core.validateCoachHelpResult({ resultType: "message", title: "Draft", body: "A team update.", canSendAsAnnouncement: true }, "parent_message").canSendAsAnnouncement, true);

for (const key of ["checklists", "communicationCardBody", "proTip", "needHelp", "privacyReminder", "generateHelp", "resultNotFound"]) {
  assert.ok((translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length >= 2, `${key} must resolve in English and Spanish`);
}

console.log("Coach Resources content, persistence, navigation, privacy, and AI-boundary tests passed.");
