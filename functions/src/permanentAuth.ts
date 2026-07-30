import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import * as functions from "firebase-functions";

export type AccountCapability = "app" | "communication" | "safety";

export type EffectiveAccountStanding =
  | "active"
  | "messagingRestricted"
  | "suspended"
  | "banned";

export type ResolvedAccountStanding = {
  effective: EffectiveAccountStanding;
  expiresAtMillis: number | null;
  reasonCode: string | null;
  revision: number;
};

type CallableBuilder = {
  https: {
    onCall: typeof functions.https.onCall;
  };
};

type CallableHandler = Parameters<typeof functions.https.onCall>[0];
type FunctionBuilder = ReturnType<typeof functions.region>;

export function isAnonymousCallableContext(
  context: functions.https.CallableContext,
) {
  return context.auth?.token.firebase?.sign_in_provider === "anonymous";
}

export function requirePermanentUid(
  context: functions.https.CallableContext,
) {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Sign in is required.",
      { reason: "auth_required" },
    );
  }

  if (isAnonymousCallableContext(context)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "A permanent Sideline Social account is required.",
      { reason: "permanent_account_required" },
    );
  }

  return uid;
}

export async function resolveAccountStanding(
  uid: string,
  nowMillis = Date.now(),
): Promise<ResolvedAccountStanding> {
  const snapshot = await admin.firestore().collection("accountStanding").doc(uid).get();
  if (!snapshot.exists) return activeStanding();

  const data = snapshot.data() ?? {};
  const expiresAtMillis = timestampMillis(data.expiresAt);
  const expired = expiresAtMillis !== null && expiresAtMillis <= nowMillis;
  const status = data.status === "banned"
    ? "banned"
    : data.status === "suspended"
      ? "suspended"
      : "active";
  const effective = expired
    ? "active"
    : status === "banned"
      ? "banned"
      : status === "suspended"
        ? "suspended"
        : data.messagingRestricted === true
          ? "messagingRestricted"
          : "active";

  return {
    effective,
    expiresAtMillis: expired ? null : expiresAtMillis,
    reasonCode: typeof data.reasonCode === "string" && data.reasonCode
      ? data.reasonCode
      : null,
    revision: Number.isInteger(data.revision) && data.revision > 0
      ? data.revision
      : 1,
  };
}

export async function accountCanUseApp(uid: string) {
  const standing = await resolveAccountStanding(uid);
  return standing.effective === "active" ||
    standing.effective === "messagingRestricted";
}

export async function accountCanCommunicate(uid: string) {
  return (await resolveAccountStanding(uid)).effective === "active";
}

export async function requireAccountCapability(
  uid: string,
  capability: AccountCapability,
) {
  if (capability === "safety") return activeStanding();

  const standing = await resolveAccountStanding(uid);
  if (standing.effective === "banned") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This account cannot access Sideline Social.",
      { reason: "account_banned", revision: standing.revision },
    );
  }
  if (standing.effective === "suspended") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This account is temporarily unavailable.",
      { reason: "account_suspended", revision: standing.revision },
    );
  }
  if (
    capability === "communication" &&
    standing.effective === "messagingRestricted"
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Communication is currently unavailable for this account.",
      { reason: "messaging_restricted", revision: standing.revision },
    );
  }
  return standing;
}

export function permanentAccountOnCall(
  builder: CallableBuilder,
  handler: CallableHandler,
  capability: AccountCapability = "app",
) {
  return builder.https.onCall(async (data, context) => {
    const uid = requirePermanentUid(context);
    await requireAccountCapability(uid, capability);
    return handler(data, context);
  });
}

function protectHttps(
  https: CallableBuilder["https"],
  capability: AccountCapability,
) {
  return new Proxy(https, {
    get(target, property, receiver) {
      if (property === "onCall") {
        return (handler: CallableHandler) => permanentAccountOnCall(
          { https: target },
          handler,
          capability,
        );
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

function protectBuilder(
  builder: FunctionBuilder,
  capability: AccountCapability,
): FunctionBuilder {
  return new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "https") {
        return protectHttps(target.https, capability);
      }

      if (property === "runWith") {
        return (runtimeOptions: Parameters<FunctionBuilder["runWith"]>[0]) =>
          protectBuilder(target.runWith(runtimeOptions), capability);
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * Keeps every callable in a source module on the same provider-aware boundary
 * without changing scheduled, Firestore, Auth, or database triggers.
 */
export function permanentAccountFunctions(
  sdk: typeof functions,
  capability: AccountCapability = "app",
): typeof functions {
  return new Proxy(sdk, {
    get(target, property, receiver) {
      if (property === "https") {
        return protectHttps(target.https, capability);
      }

      if (property === "region") {
        return (...regions: Parameters<typeof functions.region>) =>
          protectBuilder(target.region(...regions), capability);
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

function activeStanding(): ResolvedAccountStanding {
  return {
    effective: "active",
    expiresAtMillis: null,
    reasonCode: null,
    revision: 0,
  };
}

function timestampMillis(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    const milliseconds = value.toMillis();
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
  }
  return null;
}
