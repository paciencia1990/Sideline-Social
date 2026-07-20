import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";

export type TeamContentReportReason = "offensive" | "harassment" | "privacy" | "spam" | "other";

type TeamContentReport = {
  kind: "announcement" | "announcementReply" | "privateTeamMessage";
  teamId: string;
  parentId: string;
  contentId?: string;
  reason: TeamContentReportReason;
};

export async function reportTeamContent(input: TeamContentReport) {
  const callable = httpsCallable<TeamContentReport, { alreadyReported: boolean; reported: true }>(functions, "reportTeamContent");
  return (await callable(input)).data;
}
