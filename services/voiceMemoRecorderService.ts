export type VoiceRecorderFailureStage =
  | "permission"
  | "load-package"
  | "configure-audio-mode"
  | "create-recorder"
  | "prepare-recorder"
  | "start-recorder"
  | "stop-recorder"
  | "obtain-uri"
  | "unknown";

export type VoiceRecorderDiagnostic = {
  platform: string;
  permissionGranted: boolean;
  canAskAgain: boolean;
  audioPackageLoaded: boolean;
  recorderApiAvailable: boolean;
  audioModeConfigured: boolean;
  recorderCreated: boolean;
  recorderPrepared: boolean;
  failureStage: VoiceRecorderFailureStage;
  errorName?: string;
  sanitizedMessage?: string;
};

export type VoiceRecorderStatus = {
  canRecord: boolean;
  isRecording: boolean;
  durationMillis: number;
};

export type VoiceRecorderApi = {
  currentTime: number;
  getStatus: () => VoiceRecorderStatus;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  uri: string | null;
};

export class VoiceRecorderLifecycleError extends Error {
  readonly stage: VoiceRecorderFailureStage;

  constructor(stage: VoiceRecorderFailureStage, cause?: unknown) {
    super(readErrorMessage(cause) || stage);
    this.name = "VoiceRecorderLifecycleError";
    this.stage = stage;
  }
}

export async function prepareAndStartVoiceRecorder(input: {
  configureAudioMode: () => Promise<void>;
  recorder: VoiceRecorderApi;
}) {
  try {
    await resetPreparedVoiceRecorder(input.recorder);
  } catch (error) {
    throw new VoiceRecorderLifecycleError("prepare-recorder", error);
  }

  try {
    await input.configureAudioMode();
  } catch (error) {
    throw new VoiceRecorderLifecycleError("configure-audio-mode", error);
  }

  try {
    await input.recorder.prepareToRecordAsync();
  } catch (error) {
    throw new VoiceRecorderLifecycleError("prepare-recorder", error);
  }

  try {
    const prepared = input.recorder.getStatus();
    if (!prepared.canRecord) {
      throw new Error("Recorder did not enter the prepared state.");
    }
    input.recorder.record();
    if (!input.recorder.getStatus().isRecording) {
      throw new Error("Recorder did not enter the recording state.");
    }
  } catch (error) {
    throw new VoiceRecorderLifecycleError("start-recorder", error);
  }
}

export async function finalizeVoiceRecorder(
  recorder: VoiceRecorderApi,
  measuredDurationMilliseconds: number,
) {
  const statusBeforeStop = recorder.getStatus();
  const durationMilliseconds = Math.max(
    0,
    statusBeforeStop.durationMillis,
    Math.round(recorder.currentTime * 1000),
    measuredDurationMilliseconds,
  );

  try {
    await recorder.stop();
  } catch (error) {
    throw new VoiceRecorderLifecycleError("stop-recorder", error);
  }

  const uri = recorder.uri?.trim() ?? "";
  if (!uri) {
    throw new VoiceRecorderLifecycleError("obtain-uri", new Error("Recording URI was unavailable."));
  }

  return { durationMilliseconds, uri };
}

export async function resetPreparedVoiceRecorder(recorder: VoiceRecorderApi) {
  const status = recorder.getStatus();
  if (!status.canRecord && !status.isRecording) return;
  await recorder.stop();
}

export function createVoiceRecorderDiagnostic(
  input: Omit<VoiceRecorderDiagnostic, "errorName" | "sanitizedMessage">,
  error?: unknown,
): VoiceRecorderDiagnostic {
  const errorName = error instanceof Error ? error.name : undefined;
  const sanitizedMessage = sanitizeVoiceRecorderMessage(readErrorMessage(error));
  return {
    ...input,
    ...(errorName ? { errorName } : {}),
    ...(sanitizedMessage ? { sanitizedMessage } : {}),
  };
}

export function sanitizeVoiceRecorderMessage(message: string) {
  return message
    .replace(/\b(?:file|content|https?):\/\/\S+/gi, "[redacted-uri]")
    .replace(/\b[A-Za-z]:\\[^\s]+|\/(?:data|private|storage|var)\/[^\s]+/gi, "[redacted-path]")
    .replace(/\b(?:eyJ|ya29\.)[A-Za-z0-9._-]+/g, "[redacted-token]")
    .slice(0, 180);
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return typeof error === "string" ? error : "";
}
