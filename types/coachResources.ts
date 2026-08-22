export type CoachResourceLocale = "en" | "es";
export type LocalizedText = { en: string; es: string };
export type CoachChecklistCategory = "prepare" | "coaching_days" | "safety_wrap_up";
export type CoachAnnouncementAudience = "all" | "staff";
export type CoachChecklist = {
  id: string; category: CoachChecklistCategory; title: LocalizedText; description: LocalizedText;
  contentVersion: number; isActive: boolean; sortOrder: number; recurringType: "manual_reset" | "one_time";
  sections: {
    id: string; title: LocalizedText;
    items: { id: string; label: LocalizedText; detail?: LocalizedText; communicationTemplateId?: string }[];
  }[];
  safetyNote?: LocalizedText;
};
export type CoachChecklistProgress = {
  checklistId: string; completedItemIds: string[]; updatedAt: string; lastResetAt?: string; contentVersion: number;
};
export type CoachCommunicationCategory = "schedule" | "parents" | "message_parent" | "culture";
export type CoachCommunicationTemplate = {
  id: string; category: CoachCommunicationCategory; title: LocalizedText; description: LocalizedText; body: LocalizedText;
  placeholders: string[]; canSendAsAnnouncement: boolean; defaultAnnouncementAudience?: CoachAnnouncementAudience;
  sortOrder: number; isActive: boolean; contentVersion: number;
};
export type CoachProTipCategory = "first_time" | "practice" | "confidence" | "communication" | "parents" | "sportsmanship" | "inclusion" | "game_day" | "mistakes" | "fun" | "safety" | "instruction";
export type CoachProTip = {
  id: string; category: CoachProTipCategory; title: LocalizedText; body: LocalizedText; tryThis?: LocalizedText;
  sortOrder: number; isActive: boolean; contentVersion: number;
};
export type CoachHelpCategory = "practice_plan" | "parent_message" | "parent_concern" | "player_behavior" | "discouraged_player" | "team_culture" | "child_explanation" | "game_day" | "other";
export type CoachHelpTone = "warm" | "direct" | "encouraging" | "neutral";
export type CoachHelpRequest = {
  category: CoachHelpCategory; sport?: string; ageGroup?: string; situation: string; desiredOutcome?: string;
  tone?: CoachHelpTone; practiceMinutes?: number; playerCount?: number; equipment?: string[];
  clientRequestId: string; locale: CoachResourceLocale;
};
export type CoachHelpResult = {
  resultType: "practice_plan" | "message" | "talking_points" | "step_by_step" | "checklist";
  title: string; introduction?: string; body?: string; sections?: { heading: string; items: string[] }[];
  phrasesToUse?: string[]; phrasesToAvoid?: string[]; safetyNotice?: string; canSendAsAnnouncement: boolean;
};
export type SavedCoachHelpResult = { id: string; result: CoachHelpResult; createdAt: string };
export type CoachAiFeedbackRating = "up" | "down";
export type CoachAiFeedbackReason = "inaccurate" | "unsafe" | "wrong_tone" | "not_useful" | "technical_problem" | "other";
export type CoachAiFeedbackInput = {
  requestId: string;
  rating: CoachAiFeedbackRating;
  reason?: CoachAiFeedbackReason;
  comment?: string;
};
