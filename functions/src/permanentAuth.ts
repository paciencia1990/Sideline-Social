import * as functions from "firebase-functions";

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

export function permanentAccountOnCall(
  builder: CallableBuilder,
  handler: CallableHandler,
) {
  return builder.https.onCall(async (data, context) => {
    requirePermanentUid(context);
    return handler(data, context);
  });
}

function protectHttps(https: CallableBuilder["https"]) {
  return new Proxy(https, {
    get(target, property, receiver) {
      if (property === "onCall") {
        return (handler: CallableHandler) => permanentAccountOnCall(
          { https: target },
          handler,
        );
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

function protectBuilder(builder: FunctionBuilder): FunctionBuilder {
  return new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "https") {
        return protectHttps(target.https);
      }

      if (property === "runWith") {
        return (runtimeOptions: Parameters<FunctionBuilder["runWith"]>[0]) =>
          protectBuilder(target.runWith(runtimeOptions));
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
): typeof functions {
  return new Proxy(sdk, {
    get(target, property, receiver) {
      if (property === "https") {
        return protectHttps(target.https);
      }

      if (property === "region") {
        return (...regions: Parameters<typeof functions.region>) =>
          protectBuilder(target.region(...regions));
      }

      return Reflect.get(target, property, receiver);
    },
  });
}
