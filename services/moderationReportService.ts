import * as Crypto from "expo-crypto";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";

export const MODERATION_REASON_CODES = [
  "harassment_bullying",
  "hate_discrimination",
  "threat_violence",
  "sexual_content",
  "child_safety",
  "sexual_extortion",
  "nonconsensual_intimate_image",
  "doxxing_privacy",
  "stalking",
  "self_harm",
  "spam_scam_impersonation",
  "illegal_activity",
  "offline_behavior",
  "ai_unsafe_output",
  "other",
] as const;

export type ModerationReasonCode = typeof MODERATION_REASON_CODES[number];

export type ModerationReportTarget =
  | { type: "friendMessage"; conversationId: string; messageId: string }
  | {
      type: "teamContent";
      kind: "announcement" | "announcementReply" | "privateTeamMessage";
      teamId: string;
      parentId: string;
      contentId?: string;
    }
  | { type: "userProfile"; reportedUserId: string; conversationId?: string }
  | { type: "conduct"; reportedUserId?: string }
  | { type: "coachAiOutput"; requestId: string };

export type ModerationReportReceipt = {
  alreadyReported: boolean;
  blockActionRequired: boolean;
  receiptNumber: string;
  reportId: string;
  reporterVisibleStatus: "received";
};

export type MyModerationReport = {
  createdAt: string | null;
  reason: ModerationReasonCode;
  receiptNumber: string | null;
  reportId: string;
  reporterVisibleStatus: "received" | "inReview" | "resolved";
  targetType: ModerationReportTarget["type"];
  updatedAt: string | null;
};

export async function submitModerationReport(input: {
  blockRequested?: boolean;
  explanation?: string | null;
  reason: ModerationReasonCode;
  target: ModerationReportTarget;
}) {
  const callable = httpsCallable<
    {
      blockRequested: boolean;
      clientRequestId: string;
      explanation: string | null;
      reason: ModerationReasonCode;
      target: ModerationReportTarget;
    },
    ModerationReportReceipt
  >(functions, "submitModerationReportV2");
  return (await callable({
    blockRequested: input.blockRequested === true,
    clientRequestId: createModerationClientRequestId(),
    explanation: input.explanation?.trim() || null,
    reason: input.reason,
    target: input.target,
  })).data;
}

export async function listMyModerationReports() {
  const callable = httpsCallable<Record<string, never>, { reports: MyModerationReport[] }>(
    functions,
    "listMyModerationReports",
  );
  return (await callable({})).data.reports;
}

export function createModerationClientRequestId() {
  return `report_${Crypto.randomUUID().replace(/-/gu, "")}`;
}
