export const QUICK_REPLY_IDS = [
  "attending",
  "notAttending",
  "canHelp",
  "stillNeeded",
] as const;

export type QuickReplyId = (typeof QUICK_REPLY_IDS)[number];

export const QUICK_REPLY_TRANSLATION_KEYS: Record<QuickReplyId, `teamReplies.${QuickReplyId}`> = {
  attending: "teamReplies.attending",
  notAttending: "teamReplies.notAttending",
  canHelp: "teamReplies.canHelp",
  stillNeeded: "teamReplies.stillNeeded",
};
