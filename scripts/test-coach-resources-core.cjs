const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const core = require(path.join(process.cwd(), "functions", "lib", "coachResourceHelpCore.js"));
const checklists = read("content/coachResources/checklists.ts");
const templates = read("content/coachResources/communicationTemplates.ts");
const tips = read("content/coachResources/proTips.ts");
const service = read("services/coachResourcesService.ts");
const types = read("types/coachResources.ts");
const theme = read("constants/theme.ts");
const featureFlags = read("config/featureFlags.ts");
const hub = read("app/coach/resources/index.tsx");
const checklistLibrary = read("app/coach/resources/checklists/index.tsx");
const checklistDetail = read("app/coach/resources/checklists/[checklistId].tsx");
const communicationDetail = read("app/coach/resources/communication/[templateId].tsx");
const help = read("app/coach/resources/help/index.tsx");
const helpResult = read("app/coach/resources/help/result.tsx");
const composer = read("app/coach/messages.tsx");
const functionsSource = read("functions/src/coachResourceHelp.ts");
const isolatedFunctionsSource = read("functions/src/disabled/coachResourceHelp.ts");
const functionsIndex = read("functions/src/index.ts");
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
assert.match(types, /communicationTemplateId\?: string/, "checklist items must support optional communication template metadata without changing progress storage");
assert.match(types, /defaultAnnouncementAudience\?: CoachAnnouncementAudience/, "communication templates must carry an optional default announcement audience");
assert.match(theme, /communicationLink:\s*'#[0-9A-Fa-f]{6}'/, "theme must centralize the checklist communication link sage color");
assert.match(theme, /communicationLinkPressed:\s*'#[0-9A-Fa-f]{6}'/, "theme must centralize the checklist communication link pressed sage color");
const themeColor = (key) => {
  const match = theme.match(new RegExp(`${key}:\\s*'(#(?:[0-9A-Fa-f]{6}))'`));
  assert.ok(match, `${key} theme color must exist`);
  return match[1];
};
const contrastRatio = (foreground, background) => {
  const luminance = (hex) => {
    const [r, g, b] = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
assert.ok(contrastRatio(themeColor("communicationLink"), themeColor("background")) >= 4.5, "communicationLink must meet WCAG AA on the checklist cream background");
assert.ok(contrastRatio(themeColor("communicationLink"), themeColor("surface")) >= 4.5, "communicationLink must meet WCAG AA on warm white surfaces");

const beforeSeason = checklists.slice(checklists.indexOf('id: "before-season"'), checklists.indexOf('id: "practice-day"'));
const practiceDay = checklists.slice(checklists.indexOf('id: "practice-day"'), checklists.indexOf('id: "game-day"'));
const gameDay = checklists.slice(checklists.indexOf('id: "game-day"'), checklists.indexOf('id: "player-safety"'));
const endSeason = checklists.slice(checklists.indexOf('id: "end-season"'));
const practiceBeforeArrival = practiceDay.slice(practiceDay.indexOf('id: "before-arrival"'), practiceDay.indexOf('id: "during"'));
assert.match(beforeSeason, /item\("welcome", "Send a welcome communication", "Envía un mensaje de bienvenida", \{ communicationTemplateId: "welcome-team" \}\)/, "Before the Season welcome item must link to the welcome template");
assert.match(practiceBeforeArrival, /items: \[\s*item\("confirm", "Confirm time, venue, and weather", "Confirma la hora, el lugar y el clima", \{ communicationTemplateId: "practice-reminder" \}\)/, "Practice Day confirmation item must be first and link to Practice Reminder");
assert.match(gameDay, /item\("confirm", "Confirm time, venue, and weather", "Confirma la hora, el lugar y el clima", \{ communicationTemplateId: "game-day-reminder" \}\)/, "Game Day confirmation item must link to Game-Day Reminder");
assert.match(endSeason, /item\("thank", "Thank volunteers", "Agradece a los voluntarios", \{ communicationTemplateId: "season-thanks" \}\)/, "End of Season volunteer thanks item must link to the season thank-you template");
for (const templateId of ["welcome-team", "practice-reminder", "game-day-reminder", "season-thanks"]) {
  assert.match(templates, new RegExp(`template\\("${templateId}"`), `${templateId} template must exist in the canonical communication library`);
}

const hubLayout = hub.slice(hub.indexOf("<ResourceCard"), hub.lastIndexOf("</ScrollView>"));
assert.ok(hubLayout.indexOf("checklistsBody") < hubLayout.indexOf("communicationCardBody"), "Checklists must precede Communication");
assert.ok(hubLayout.indexOf("communicationCardBody") < hubLayout.indexOf("styles.tipCard"), "Communication must precede Pro Tip");
assert.ok(hubLayout.indexOf("styles.tipCard") < hubLayout.indexOf("needHelp"), "guided help must remain last");
assert.doesNotMatch(hub, /firstPractice|gameDayBody|positiveTips|whatToSay/, "placeholder cards must be removed");
assert.doesNotMatch(checklistLibrary, /section\.items|completedItemIds\.map/, "checklist library must not expand all checklist items");
assert.match(checklistDetail, /accessibilityRole="checkbox"[\s\S]*accessibilityState=\{\{ checked \}\}/, "checklist items must expose checkbox state");
assert.match(checklistDetail, /getCoachCommunicationTemplate/, "checklist detail must resolve linked templates from the canonical library");
assert.match(checklistDetail, /router\.push\(`\/coach\/resources\/communication\/\$\{templateId\}` as never\)/, "checklist template actions must open the canonical communication template route");
assert.ok(checklistDetail.indexOf('accessibilityRole="checkbox"') < checklistDetail.indexOf("styles.templateLink"), "template action must render beneath the checkbox row");
const templateActionSnippet = checklistDetail.slice(checklistDetail.indexOf("accessibilityHint={t(\"coach.resources.openCommunicationTemplateHint\")}"), checklistDetail.indexOf("</Pressable>", checklistDetail.indexOf("accessibilityHint={t(\"coach.resources.openCommunicationTemplateHint\")}")));
assert.doesNotMatch(templateActionSnippet, /toggleItem|setCompletedIds|saveCoachChecklistProgress|persist/, "template action must not toggle or save checklist completion");
assert.match(templateActionSnippet, /MessageCircle color=\{pressed \? Colors\.communicationLinkPressed : Colors\.communicationLink\}/, "checklist message icon must use the sage communication link token");
assert.match(checklistDetail, /templateLinkText:\s*\{[^}]*color: Colors\.communicationLink/, "checklist message link text must use the same sage communication link token");
assert.doesNotMatch(templateActionSnippet, /Colors\.primary/, "checklist message action must no longer use the red primary color");
assert.match(checklistDetail, /itemText:\s*\{[^}]*color: Colors\.textHeading/, "checklist labels must remain navy");
assert.match(checklistDetail, /checkbox:\s*\{[^}]*borderColor: Colors\.primary/, "checkbox outline color must remain unchanged");
assert.match(checklistDetail, /checkboxChecked:\s*\{[^}]*Colors\.accentGreen/, "completed checkbox color must remain unchanged");
assert.match(checklistDetail, /Alert\.alert[\s\S]*resetCoachChecklistProgress/, "reset must require confirmation");
assert.match(communicationDetail, /TextInput[\s\S]*findUnresolvedCoachPlaceholders[\s\S]*\/coach\/messages/, "templates must be editable, validated, and routed to the composer");
assert.match(communicationDetail, /draftAudience:\s*template\?\.defaultAnnouncementAudience \?\? "all"/, "template flow must pass the template default audience to the composer");
assert.doesNotMatch(communicationDetail, /createTeamAnnouncement|performCreate/, "opening a checklist-linked template must not auto-send announcements");
assert.match(composer, /draftBody[\s\S]*draftTitle[\s\S]*draftAudience[\s\S]*selectedTeamId/, "announcement composer must accept drafts and require explicit team context");
assert.match(composer, /TextInput[\s\S]*onChangeText=\{setBody\}[\s\S]*value=\{body\}/, "draft body must remain editable in the composer");
assert.match(featureFlags, /coachAiEnabled:\s*false/, "Coach AI must be disabled through the central typed feature flag");
assert.match(hub, /\{FEATURE_FLAGS\.coachAiEnabled \? \(/, "Coach AI entry point must be hidden unless enabled");
assert.doesNotMatch(hub, /coachAiComingSoon/, "Coach Resources must not ship a visible coming-soon control");
assert.match(help, /if \(!FEATURE_FLAGS\.coachAiEnabled\)[\s\S]*coachAiUnavailableTitle/, "direct help links must render a safe unavailable state");
assert.match(helpResult, /if \(!FEATURE_FLAGS\.coachAiEnabled\)[\s\S]*coachAiUnavailableTitle/, "direct result links must render a safe unavailable state");
assert.doesNotMatch(help, /apiKey|COACH_AI_API_KEY|provider/i, "the client help route must not contain provider credentials");
assert.match(helpResult, /result\.sections[\s\S]*result\.canSendAsAnnouncement/, "structured results must render natively and gate announcements");
assert.ok(service.indexOf("if (!FEATURE_FLAGS.coachAiEnabled)") < service.indexOf("httpsCallable<CoachHelpRequest"), "client service must stop before constructing a callable");
assert.match(functionsSource, /context\.auth[\s\S]*feature_disabled/, "active compatibility callable must authenticate and return a stable disabled reason");
assert.doesNotMatch(functionsSource, /COACH_AI_API_KEY|COACH_AI_ENDPOINT|process\.env|fetch\(|admin\.firestore|coachAiRequests|coachAiRateLimits/, "active callable must not bind secrets, call a provider, or access AI storage");
assert.match(isolatedFunctionsSource, /ISOLATED \/ NOT EXPORTED[\s\S]*secrets:\s*\['COACH_AI_API_KEY', 'COACH_AI_ENDPOINT'\][\s\S]*validateCoachHelpRequest[\s\S]*enforceRateLimit/, "unfinished provider code must remain isolated with its safeguards and secret bindings documented");
assert.match(functionsIndex, /from '\.\/coachResourceHelp'/, "Functions entry must export the non-secret compatibility callable");
assert.doesNotMatch(functionsIndex, /disabled\/coachResourceHelp/, "Functions entry must not import the isolated provider implementation");

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

for (const key of ["checklists", "communicationCardBody", "proTip", "needHelp", "coachAiComingSoon", "coachAiUnavailableTitle", "coachAiUnavailableBody", "backToResources", "privacyReminder", "generateHelp", "resultNotFound", "openCommunicationTemplate", "openCommunicationTemplateHint"]) {
  assert.ok((translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length >= 2, `${key} must resolve in English and Spanish`);
}

console.log("Coach Resources content, persistence, navigation, privacy, and disabled AI-boundary tests passed.");
