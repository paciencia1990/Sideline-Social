import { randomUUID } from "node:crypto";

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as firebaseFunctions from "firebase-functions";

import { canAccessTeamAnnouncement, isTeamActive } from "./teamMembershipCore";
import { isExplicitConversationParticipant } from "./teamVoiceMessagingCore";
import {
  boundedModerationText,
  canonicalModerationReason,
  moderationCaseGroupingKey,
  moderationDedupeId,
  moderationHash,
  moderationReceiptNumber,
  MODERATION_TARGET_TYPES,
  readPositiveIntegerConfiguration,
  safeModerationEvidenceSourcePath,
  type ModerationReasonCode,
  type ModerationTargetType,
} from "./moderationReportsCore";
import {
  permanentAccountFunctions,
  requirePermanentUid,
  resolveAccountStanding,
} from "./permanentAuth";

const functions = permanentAccountFunctions(firebaseFunctions, "safety");
const moderationFunctions = functions.region("us-central1").runWith({
  memory: "256MB",
  timeoutSeconds: 60,
});

const CURRENT_LEGAL_ASSENT_VERSION = "1.0.0-2026-08-14";
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/u;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,200}$/u;
const EMULATOR_REPORT_LIMIT = 25;

type EvidenceAttachment = {
  kind: "image" | "thumbnail" | "voice";
  mimeType: string | null;
  sizeBytes: number | null;
  sourcePath: string;
};

type ResolvedReportTarget = {
  attachments: EvidenceAttachment[];
  contextId: string | null;
  evidenceMetadata: Record<string, string | number | boolean | null>;
  evidenceText: string | null;
  evidenceType: "image" | "metadata" | "profile" | "text" | "voice";
  reportedUserId: string | null;
  retentionReference?: string;
  sourceReference: string | null;
  targetId: string;
  targetKey: string;
  targetType: ModerationTargetType;
};

type ParsedReportInput = {
  blockRequested: boolean;
  clientRequestId: string;
  explanation: string | null;
  reason: ModerationReasonCode;
  target: Record<string, unknown>;
  targetType: ModerationTargetType;
};

export const submitModerationReportV2 = moderationFunctions.https.onCall(async (data, context) => {
  requireModerationReportingEnabled();
  recordAppCheckObservation(context);
  const reporterUserId = requirePermanentUid(context);
  const standing = await resolveAccountStanding(reporterUserId);
  if (standing.effective === "suspended" || standing.effective === "banned") {
    throw new firebaseFunctions.https.HttpsError(
      "permission-denied",
      "This account cannot submit a new report.",
      { reason: "account_restricted" },
    );
  }

  const input = parseReportInput(data);
  if (input.targetType === "conduct" && (!input.explanation || input.explanation.length < 20)) {
    throw new firebaseFunctions.https.HttpsError(
      "invalid-argument",
      "A short explanation is required for a behavior report.",
      { reason: "explanation_required" },
    );
  }

  const firestore = admin.firestore();
  const reporterReference = firestore.collection("users").doc(reporterUserId);
  const reportReference = firestore.collection("moderationReports").doc();
  const reporterLinkReference = firestore.collection("moderationReporterLinks").doc(reportReference.id);
  const evidenceQueueReference = firestore.collection("moderationEvidenceCaptureQueue").doc(reportReference.id);
  const rateReference = firestore.collection("moderationRateLimits")
    .doc(moderationHash(`${reporterUserId}:reportSubmissionV2`));
  const now = Timestamp.now();
  const reporterHash = moderationHash(reporterUserId);
  let result = {
    alreadyReported: false,
    blockActionRequired: false,
    receiptNumber: moderationReceiptNumber(reportReference.id),
    reportId: reportReference.id,
    reporterVisibleStatus: "received" as const,
  };

  await firestore.runTransaction(async (transaction) => {
    const reporter = await transaction.get(reporterReference);
    assertCurrentLegalAssent(reporter.data());
    const resolved = await resolveReportTarget(transaction, reporterUserId, input);
    const dedupeId = moderationDedupeId({
      reporterUserId,
      targetType: resolved.targetType,
      targetKey: resolved.targetKey,
    });
    const dedupeReference = firestore.collection("moderationDedupKeys").doc(dedupeId);
    const [existingDedupe, rateSnapshot] = await Promise.all([
      transaction.get(dedupeReference),
      transaction.get(rateReference),
    ]);

    if (existingDedupe.exists) {
      const existingReportId = readDocumentId(existingDedupe.data()?.reportId);
      const existingReceipt = boundedModerationText(existingDedupe.data()?.receiptNumber, 40);
      if (!existingReportId || !existingReceipt) {
        throw new firebaseFunctions.https.HttpsError(
          "failed-precondition",
          "The existing report receipt is unavailable.",
          { reason: "dedupe_record_invalid" },
        );
      }
      result = {
        alreadyReported: true,
        blockActionRequired: input.blockRequested && Boolean(resolved.reportedUserId),
        receiptNumber: existingReceipt,
        reportId: existingReportId,
        reporterVisibleStatus: "received",
      };
      return;
    }

    if (resolved.retentionReference) {
      transaction.set(firestore.doc(resolved.retentionReference), {
        moderationEvidenceRetained: true,
        moderationEvidenceRetainedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    applyReportRateLimit(transaction, rateReference, rateSnapshot, now);
    const receiptNumber = moderationReceiptNumber(reportReference.id);
    const caseGroupingKey = moderationCaseGroupingKey(resolved.targetType, resolved.targetKey);
    const attachmentPaths = resolved.attachments.map((attachment) => attachment.sourcePath);
    const report = {
      reportId: reportReference.id,
      receiptNumber,
      schemaVersion: 2,
      source: "mobile",
      reporterHash,
      reporterLinkReference: reporterLinkReference.path,
      reportedUserId: resolved.reportedUserId,
      targetType: resolved.targetType,
      targetId: resolved.targetId,
      targetKey: resolved.targetKey,
      targetReference: resolved.sourceReference,
      contextId: resolved.contextId,
      caseGroupingKey,
      caseId: null,
      reason: input.reason,
      explanation: input.explanation,
      evidenceSnapshot: {
        contentType: resolved.evidenceType,
        text: resolved.evidenceText,
        metadata: resolved.evidenceMetadata,
        attachments: resolved.attachments,
      },
      blockRequested: input.blockRequested,
      blockResult: input.blockRequested && resolved.reportedUserId ? "clientActionRequired" : "notRequested",
      clientRequestId: input.clientRequestId,
      idempotencyPayloadHash: moderationHash(JSON.stringify({
        reason: input.reason,
        targetKey: resolved.targetKey,
        targetType: resolved.targetType,
      })),
      dedupeId,
      internalStatus: "received",
      reporterVisibleStatus: "received",
      retentionExpiresAt: null,
      retentionPolicyState: "configurationRequired",
      legalHoldIds: [],
      createdAt: now,
      updatedAt: now,
    };

    transaction.create(reportReference, report);
    transaction.create(reporterLinkReference, {
      reportId: reportReference.id,
      reporterUserId,
      reporterHash,
      createdAt: now,
      anonymizedAt: null,
    });
    transaction.create(evidenceQueueReference, {
      reportId: reportReference.id,
      caseGroupingKey,
      attachmentPaths,
      captureState: "requested",
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(dedupeReference, {
      dedupeId,
      reportId: reportReference.id,
      receiptNumber,
      reporterHash,
      targetType: resolved.targetType,
      targetKeyHash: moderationHash(resolved.targetKey),
      createdAt: now,
      retentionExpiresAt: null,
    });
    result = {
      alreadyReported: false,
      blockActionRequired: input.blockRequested && Boolean(resolved.reportedUserId),
      receiptNumber,
      reportId: reportReference.id,
      reporterVisibleStatus: "received",
    };
  });

  firebaseFunctions.logger.info("moderation_report_v2_recorded", {
    alreadyReported: result.alreadyReported,
    reason: input.reason,
    targetType: input.targetType,
  });
  return result;
});

export const listMyModerationReports = moderationFunctions.https.onCall(async (_data, context) => {
  requireModerationReportingEnabled();
  recordAppCheckObservation(context);
  const uid = requirePermanentUid(context);
  const snapshot = await admin.firestore().collection("moderationReports")
    .where("reporterHash", "==", moderationHash(uid))
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  return {
    reports: snapshot.docs.map((document) => ({
      receiptNumber: boundedModerationText(document.data().receiptNumber, 40),
      reportId: document.id,
      reporterVisibleStatus: readReporterVisibleStatus(document.data().reporterVisibleStatus),
      targetType: readTargetType(document.data().targetType) ?? "conduct",
      reason: canonicalModerationReason(document.data().reason) ?? "other",
      createdAt: document.data().createdAt instanceof Timestamp
        ? document.data().createdAt.toDate().toISOString()
        : null,
      updatedAt: document.data().updatedAt instanceof Timestamp
        ? document.data().updatedAt.toDate().toISOString()
        : null,
    })),
  };
});

export async function createCoachAiUnsafeModerationReport(input: {
  comment: string | null;
  requestData: FirebaseFirestore.DocumentData;
  requestId: string;
  reporterUserId: string;
}) {
  const firestore = admin.firestore();
  const reportId = `ai_${moderationHash(`${input.reporterUserId}:${input.requestId}`).slice(0, 60)}`;
  const reportReference = firestore.collection("moderationReports").doc(reportId);
  const reporterLinkReference = firestore.collection("moderationReporterLinks").doc(reportId);
  const evidenceQueueReference = firestore.collection("moderationEvidenceCaptureQueue").doc(reportId);
  const dedupeId = moderationDedupeId({
    reporterUserId: input.reporterUserId,
    targetType: "coachAiOutput",
    targetKey: input.requestId,
  });
  const dedupeReference = firestore.collection("moderationDedupKeys").doc(dedupeId);
  const createdAt = Timestamp.now();
  const receiptNumber = moderationReceiptNumber(reportId);
  const evidenceText = coachAiOutputText(input.requestData.result);
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reportReference);
    if (existing.exists) return;
    const caseGroupingKey = moderationCaseGroupingKey("coachAiOutput", input.requestId);
    transaction.create(reportReference, {
      reportId,
      receiptNumber,
      schemaVersion: 2,
      source: "coachAiFeedback",
      reporterHash: moderationHash(input.reporterUserId),
      reporterLinkReference: reporterLinkReference.path,
      reportedUserId: null,
      targetType: "coachAiOutput",
      targetId: input.requestId,
      targetKey: input.requestId,
      targetReference: `coachAiRequests/${input.reporterUserId}_${input.requestId}`,
      contextId: input.requestId,
      caseGroupingKey,
      caseId: null,
      reason: "ai_unsafe_output",
      explanation: boundedModerationText(input.comment, 500),
      evidenceSnapshot: {
        contentType: "text",
        text: evidenceText,
        metadata: {
          category: boundedModerationText(input.requestData.category, 80),
          locale: boundedModerationText(input.requestData.locale, 20),
          modelIdentifier: boundedModerationText(input.requestData.modelIdentifier, 80),
          promptIncluded: false,
        },
        attachments: [],
      },
      blockRequested: false,
      blockResult: "notRequested",
      clientRequestId: input.requestId,
      idempotencyPayloadHash: moderationHash(`coachAiOutput:${input.requestId}`),
      dedupeId,
      internalStatus: "received",
      reporterVisibleStatus: "received",
      retentionExpiresAt: null,
      retentionPolicyState: "configurationRequired",
      legalHoldIds: [],
      createdAt,
      updatedAt: createdAt,
    });
    transaction.create(reporterLinkReference, {
      reportId,
      reporterUserId: input.reporterUserId,
      reporterHash: moderationHash(input.reporterUserId),
      createdAt,
      anonymizedAt: null,
    });
    transaction.create(evidenceQueueReference, {
      reportId,
      caseGroupingKey,
      attachmentPaths: [],
      captureState: "requested",
      attemptCount: 0,
      nextAttemptAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    transaction.set(dedupeReference, {
      dedupeId,
      reportId,
      receiptNumber,
      reporterHash: moderationHash(input.reporterUserId),
      targetType: "coachAiOutput",
      targetKeyHash: moderationHash(input.requestId),
      createdAt,
      retentionExpiresAt: null,
    }, { merge: false });
  });
  return { receiptNumber, reportId };
}

async function resolveReportTarget(
  transaction: FirebaseFirestore.Transaction,
  reporterUserId: string,
  input: ParsedReportInput,
): Promise<ResolvedReportTarget> {
  if (input.targetType === "friendMessage") {
    return resolveFriendMessageTarget(transaction, reporterUserId, input.target);
  }
  if (input.targetType === "teamContent") {
    return resolveTeamContentTarget(transaction, reporterUserId, input.target);
  }
  if (input.targetType === "userProfile") {
    return resolveUserProfileTarget(transaction, reporterUserId, input.target);
  }
  if (input.targetType === "coachAiOutput") {
    return resolveCoachAiTarget(transaction, reporterUserId, input.target);
  }
  const reportedUserId = readOptionalDocumentId(input.target.reportedUserId);
  if (reportedUserId === reporterUserId) {
    throw new firebaseFunctions.https.HttpsError("failed-precondition", "You cannot report your own account.");
  }
  if (reportedUserId) {
    const profile = await transaction.get(admin.firestore().collection("publicUserProfiles").doc(reportedUserId));
    if (!profile.exists) {
      throw new firebaseFunctions.https.HttpsError("not-found", "The referenced account is unavailable.");
    }
  }
  return {
    attachments: [],
    contextId: null,
    evidenceMetadata: { explanationProvided: Boolean(input.explanation) },
    evidenceText: null,
    evidenceType: "metadata",
    reportedUserId,
    sourceReference: null,
    targetId: reportedUserId ?? `conduct_${input.clientRequestId}`,
    targetKey: `conduct:${input.clientRequestId}`,
    targetType: "conduct",
  };
}

async function resolveFriendMessageTarget(
  transaction: FirebaseFirestore.Transaction,
  reporterUserId: string,
  target: Record<string, unknown>,
): Promise<ResolvedReportTarget> {
  const conversationId = readRequiredDocumentId(target.conversationId, "conversation");
  const messageId = readRequiredDocumentId(target.messageId, "message");
  const conversationReference = admin.firestore().collection("friendConversations").doc(conversationId);
  const memberReference = conversationReference.collection("members").doc(reporterUserId);
  const messageReference = conversationReference.collection("messages").doc(messageId);
  const [member, message] = await Promise.all([
    transaction.get(memberReference),
    transaction.get(messageReference),
  ]);
  const data = message.data() ?? {};
  if (!member.exists || member.data()?.status !== "active") {
    throw new firebaseFunctions.https.HttpsError("permission-denied", "Active conversation membership is required.");
  }
  if (
    !message.exists ||
    data.status === "removed" ||
    data.moderationState === "hidden" ||
    data.moderationState === "removed"
  ) {
    throw new firebaseFunctions.https.HttpsError("failed-precondition", "Message unavailable.");
  }
  if (!readStringArray(data.visibleToUserIds).includes(reporterUserId)) {
    throw new firebaseFunctions.https.HttpsError("permission-denied", "This message is not visible to the reporter.");
  }
  const reportedUserId = readOptionalDocumentId(data.senderUserId);
  if (!reportedUserId || reportedUserId === reporterUserId) {
    throw new firebaseFunctions.https.HttpsError("failed-precondition", "Only another user's message can be reported.");
  }
  const messageType = data.messageType === "voice" ? "voice" : data.messageType === "image" ? "image" : "text";
  const attachments = friendMessageAttachments(data, messageType);
  return {
    attachments,
    contextId: conversationId,
    evidenceMetadata: {
      messageType,
      hasCaption: Boolean(boundedModerationText(data.caption, 1)),
    },
    evidenceText: joinEvidenceText(data.text, data.caption),
    evidenceType: messageType,
    reportedUserId,
    retentionReference: messageReference.path,
    sourceReference: messageReference.path,
    targetId: messageId,
    targetKey: `${conversationId}:${messageId}`,
    targetType: "friendMessage",
  };
}

async function resolveTeamContentTarget(
  transaction: FirebaseFirestore.Transaction,
  reporterUserId: string,
  target: Record<string, unknown>,
): Promise<ResolvedReportTarget> {
  const teamId = readRequiredDocumentId(target.teamId, "team");
  const kind = readTeamContentKind(target.kind);
  const parentId = readRequiredDocumentId(target.parentId, kind === "privateTeamMessage" ? "conversation" : "announcement");
  const contentId = kind === "announcement"
    ? parentId
    : readRequiredDocumentId(target.contentId, "content");
  const firestore = admin.firestore();
  const teamReference = firestore.collection("teams").doc(teamId);
  const memberReference = teamReference.collection("members").doc(reporterUserId);
  const [team, member] = await Promise.all([
    transaction.get(teamReference),
    transaction.get(memberReference),
  ]);
  if (!team.exists || !isTeamActive(team.data())) {
    throw new firebaseFunctions.https.HttpsError("failed-precondition", "This team is unavailable.");
  }
  if (!member.exists || member.data()?.status !== "active") {
    throw new firebaseFunctions.https.HttpsError("permission-denied", "An active team membership is required.");
  }

  let contentReference: FirebaseFirestore.DocumentReference;
  let content: FirebaseFirestore.DocumentSnapshot;
  let contextId = teamId;
  if (kind === "privateTeamMessage") {
    const conversationReference = firestore.collection("teamPrivateConversations").doc(parentId);
    const conversation = await transaction.get(conversationReference);
    if (
      !conversation.exists ||
      conversation.data()?.teamId !== teamId ||
      !isExplicitConversationParticipant(conversation.data(), reporterUserId)
    ) {
      throw new firebaseFunctions.https.HttpsError("permission-denied", "This conversation is unavailable.");
    }
    contentReference = conversationReference.collection("messages").doc(contentId);
    content = await transaction.get(contentReference);
    contextId = parentId;
  } else {
    const announcementReference = teamReference.collection("announcements").doc(parentId);
    const announcement = await transaction.get(announcementReference);
    if (!announcement.exists || !canAccessTeamAnnouncement(member.data(), announcement.data()?.audience)) {
      throw new firebaseFunctions.https.HttpsError("permission-denied", "This announcement is unavailable.");
    }
    if (kind === "announcement") {
      contentReference = announcementReference;
      content = announcement;
    } else {
      contentReference = announcementReference.collection("replies").doc(contentId);
      content = await transaction.get(contentReference);
    }
  }

  const data = content.data() ?? {};
  if (!content.exists || data.isDeleted === true || data.moderationState === "hidden" || data.moderationState === "removed") {
    throw new firebaseFunctions.https.HttpsError("failed-precondition", "The reported content is unavailable.");
  }
  const reportedUserId = readOptionalDocumentId(
    kind === "announcement" ? data.createdBy : kind === "announcementReply" ? data.userId : data.senderUserId,
  );
  if (!reportedUserId || reportedUserId === reporterUserId) {
    throw new firebaseFunctions.https.HttpsError("failed-precondition", "Only another user's content can be reported.");
  }
  const contentType = data.contentType === "voice" ? "voice" : "text";
  const voicePath = safeModerationEvidenceSourcePath(data.voiceMemo?.storagePath);
  const attachments: EvidenceAttachment[] = voicePath
    ? [{
        kind: "voice",
        mimeType: boundedModerationText(data.voiceMemo?.mimeType, 100),
        sizeBytes: readPositiveNumber(data.voiceMemo?.sizeBytes),
        sourcePath: voicePath,
      }]
    : [];
  return {
    attachments,
    contextId,
    evidenceMetadata: { contentType, kind, teamId },
    evidenceText: joinEvidenceText(data.title, data.body, data.text, data.caption),
    evidenceType: contentType,
    reportedUserId,
    retentionReference: contentReference.path,
    sourceReference: contentReference.path,
    targetId: contentId,
    targetKey: `${kind}:${teamId}:${parentId}:${contentId}`,
    targetType: "teamContent",
  };
}

async function resolveUserProfileTarget(
  transaction: FirebaseFirestore.Transaction,
  reporterUserId: string,
  target: Record<string, unknown>,
): Promise<ResolvedReportTarget> {
  const reportedUserId = readRequiredDocumentId(target.reportedUserId, "reported account");
  if (reportedUserId === reporterUserId) {
    throw new firebaseFunctions.https.HttpsError("failed-precondition", "You cannot report your own profile.");
  }
  const profileReference = admin.firestore().collection("publicUserProfiles").doc(reportedUserId);
  const profile = await transaction.get(profileReference);
  if (!profile.exists) throw new firebaseFunctions.https.HttpsError("not-found", "The profile is unavailable.");
  const conversationId = readOptionalDocumentId(target.conversationId);
  if (conversationId) {
    const conversationReference = admin.firestore().collection("friendConversations").doc(conversationId);
    const [reporterMember, reportedMember] = await Promise.all([
      transaction.get(conversationReference.collection("members").doc(reporterUserId)),
      transaction.get(conversationReference.collection("members").doc(reportedUserId)),
    ]);
    if (reporterMember.data()?.status !== "active" || reportedMember.data()?.status !== "active") {
      throw new firebaseFunctions.https.HttpsError("permission-denied", "The profile context is unavailable.");
    }
  }
  const profileData = profile.data() ?? {};
  const updatedAt = profileData.updatedAt instanceof Timestamp ? profileData.updatedAt.toMillis() : 0;
  return {
    attachments: [],
    contextId: conversationId,
    evidenceMetadata: {
      photoPresent: typeof profileData.photoURL === "string" && Boolean(profileData.photoURL),
      profileState: boundedModerationText(profileData.profileState, 40),
    },
    evidenceText: boundedModerationText(profileData.displayName, 200),
    evidenceType: "profile",
    reportedUserId,
    sourceReference: profileReference.path,
    targetId: reportedUserId,
    targetKey: `${reportedUserId}:${updatedAt}`,
    targetType: "userProfile",
  };
}

async function resolveCoachAiTarget(
  transaction: FirebaseFirestore.Transaction,
  reporterUserId: string,
  target: Record<string, unknown>,
): Promise<ResolvedReportTarget> {
  const requestId = readRequiredDocumentId(target.requestId, "Coach AI request");
  const requestReference = admin.firestore().collection("coachAiRequests").doc(`${reporterUserId}_${requestId}`);
  const request = await transaction.get(requestReference);
  const data = request.data() ?? {};
  if (!request.exists || data.userId !== reporterUserId || data.status !== "completed") {
    throw new firebaseFunctions.https.HttpsError("not-found", "The Coach AI result is unavailable.");
  }
  return {
    attachments: [],
    contextId: requestId,
    evidenceMetadata: {
      category: boundedModerationText(data.category, 80),
      locale: boundedModerationText(data.locale, 20),
      modelIdentifier: boundedModerationText(data.modelIdentifier, 80),
      promptIncluded: false,
    },
    evidenceText: coachAiOutputText(data.result),
    evidenceType: "text",
    reportedUserId: null,
    sourceReference: requestReference.path,
    targetId: requestId,
    targetKey: requestId,
    targetType: "coachAiOutput",
  };
}

function parseReportInput(value: unknown): ParsedReportInput {
  const data = objectValue(value);
  const target = objectValue(data.target);
  const targetType = readTargetType(target.type);
  const reason = canonicalModerationReason(data.reason);
  const clientRequestId = boundedModerationText(data.clientRequestId, 100) ?? "";
  const explanation = boundedModerationText(data.explanation, 1500);
  if (!targetType || !reason || !CLIENT_REQUEST_ID.test(clientRequestId)) {
    throw new firebaseFunctions.https.HttpsError(
      "invalid-argument",
      "A supported report target, reason, and request identifier are required.",
    );
  }
  return {
    blockRequested: data.blockRequested === true,
    clientRequestId,
    explanation,
    reason,
    target,
    targetType,
  };
}

function applyReportRateLimit(
  transaction: FirebaseFirestore.Transaction,
  reference: FirebaseFirestore.DocumentReference,
  snapshot: FirebaseFirestore.DocumentSnapshot,
  now: Timestamp,
) {
  const limit = configuredReportLimit();
  const configuredWindowHours = readPositiveIntegerConfiguration(
    process.env.MODERATION_REPORT_RATE_LIMIT_WINDOW_HOURS,
    168,
  );
  const windowHours = configuredWindowHours ?? (isEmulator() ? 24 : null);
  if (!windowHours) {
    throw new firebaseFunctions.https.HttpsError(
      "failed-precondition",
      "Report rate-limit policy is not configured.",
      { reason: "report_policy_not_configured" },
    );
  }
  const currentStartedAt = snapshot.data()?.windowStartedAt;
  const inWindow = currentStartedAt instanceof Timestamp &&
    now.toMillis() - currentStartedAt.toMillis() < windowHours * 3_600_000;
  const currentCount = inWindow ? Number(snapshot.data()?.count ?? 0) : 0;
  if (!Number.isInteger(currentCount) || currentCount < 0 || currentCount >= limit) {
    throw new firebaseFunctions.https.HttpsError(
      "resource-exhausted",
      "Please wait before submitting another report.",
      { reason: "report_rate_limited" },
    );
  }
  transaction.set(reference, {
    uidHash: reference.id,
    operation: "reportSubmissionV2",
    count: currentCount + 1,
    windowStartedAt: inWindow ? currentStartedAt : now,
    updatedAt: now,
    retentionExpiresAt: null,
    retentionPolicyState: "configurationRequired",
  });
}

function configuredReportLimit() {
  const configured = readPositiveIntegerConfiguration(process.env.MODERATION_REPORT_RATE_LIMIT_MAX, 500);
  if (configured) return configured;
  if (isEmulator()) return EMULATOR_REPORT_LIMIT;
  throw new firebaseFunctions.https.HttpsError(
    "failed-precondition",
    "Report rate-limit policy is not configured.",
    { reason: "report_policy_not_configured" },
  );
}

function requireModerationReportingEnabled() {
  if (isEmulator()) return;
  const approvedStagingProject = "sideline-social-staging-2026";
  const actualProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (
    process.env.MODERATION_REPORTING_V2_ENABLED === "true" &&
    process.env.MODERATION_EXPECTED_PROJECT_ID === approvedStagingProject &&
    actualProject === approvedStagingProject
  ) return;
  throw new firebaseFunctions.https.HttpsError(
    "failed-precondition",
    "The new reporting system is not active.",
    { reason: "moderation_v2_disabled" },
  );
}

function recordAppCheckObservation(context: firebaseFunctions.https.CallableContext) {
  firebaseFunctions.logger.info("moderation_app_check_observation", {
    mode: "monitor",
    status: context.app ? "present" : "missing",
    surface: "mobileModerationReporting",
  });
}

function assertCurrentLegalAssent(profile: FirebaseFirestore.DocumentData | undefined) {
  if (
    profile?.adultEligibilityConfirmed !== true ||
    profile?.legalAssentVersion !== CURRENT_LEGAL_ASSENT_VERSION ||
    !profile?.termsOfUseAcceptedAt ||
    !profile?.communityGuidelinesAcceptedAt
  ) {
    throw new firebaseFunctions.https.HttpsError(
      "failed-precondition",
      "Current Terms and Community Guidelines acceptance is required.",
      { reason: "current_policy_acceptance_required" },
    );
  }
}

function friendMessageAttachments(
  data: FirebaseFirestore.DocumentData,
  messageType: "image" | "text" | "voice",
) {
  const result: EvidenceAttachment[] = [];
  if (messageType === "image") {
    const fullPath = safeModerationEvidenceSourcePath(data.image?.fullPath);
    const thumbnailPath = safeModerationEvidenceSourcePath(data.image?.thumbnailPath);
    if (fullPath) result.push({
      kind: "image",
      mimeType: boundedModerationText(data.image?.mimeType, 100),
      sizeBytes: readPositiveNumber(data.image?.sizeBytes),
      sourcePath: fullPath,
    });
    if (thumbnailPath) result.push({
      kind: "thumbnail",
      mimeType: "image/jpeg",
      sizeBytes: null,
      sourcePath: thumbnailPath,
    });
  }
  if (messageType === "voice") {
    const voicePath = safeModerationEvidenceSourcePath(data.voiceMemo?.storagePath);
    if (voicePath) result.push({
      kind: "voice",
      mimeType: boundedModerationText(data.voiceMemo?.mimeType, 100),
      sizeBytes: readPositiveNumber(data.voiceMemo?.sizeBytes),
      sourcePath: voicePath,
    });
  }
  return result;
}

function coachAiOutputText(value: unknown) {
  const result = objectValue(value);
  const sections = Array.isArray(result.sections)
    ? result.sections.flatMap((section) => {
        const data = objectValue(section);
        return [data.heading, ...(Array.isArray(data.items) ? data.items : [])];
      })
    : [];
  const values = [
    result.title,
    result.introduction,
    result.body,
    ...sections,
    ...(Array.isArray(result.phrasesToUse) ? result.phrasesToUse : []),
    ...(Array.isArray(result.phrasesToAvoid) ? result.phrasesToAvoid : []),
    result.safetyNotice,
  ];
  return values
    .map((item) => boundedModerationText(item, 1000))
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
    .slice(0, 6000) || null;
}

function joinEvidenceText(...values: unknown[]) {
  return values
    .map((value) => boundedModerationText(value, 2200))
    .filter((value): value is string => Boolean(value))
    .join("\n\n")
    .slice(0, 2200) || null;
}

function readTargetType(value: unknown) {
  return typeof value === "string" && (MODERATION_TARGET_TYPES as readonly string[]).includes(value)
    ? value as ModerationTargetType
    : null;
}

function readTeamContentKind(value: unknown) {
  if (value === "announcement" || value === "announcementReply" || value === "privateTeamMessage") return value;
  throw new firebaseFunctions.https.HttpsError("invalid-argument", "A supported team-content type is required.");
}

function readRequiredDocumentId(value: unknown, label: string) {
  const result = readDocumentId(value);
  if (!result) throw new firebaseFunctions.https.HttpsError("invalid-argument", `A valid ${label} reference is required.`);
  return result;
}

function readDocumentId(value: unknown) {
  return typeof value === "string" && DOCUMENT_ID.test(value.trim()) ? value.trim() : null;
}

function readOptionalDocumentId(value: unknown) {
  if (value == null || value === "") return null;
  return readDocumentId(value);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && DOCUMENT_ID.test(item))
    : [];
}

function readPositiveNumber(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function readReporterVisibleStatus(value: unknown) {
  return value === "inReview" || value === "resolved" ? value : "received";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isEmulator() {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

export function syntheticModerationClientRequestId(prefix = "report") {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`.slice(0, 100);
}
