import { randomUUID } from 'node:crypto';

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {
  CoachAiGatewayError,
  executeCoachAiClaudeGateway,
  parseAndAuthorizeCoachAiGatewayRequest,
  safeGatewayErrorBody,
  type CoachAiGatewayTelemetry,
} from './coachAiClaudeGatewayCore';
import { requireCoachAiRuntimeEnabled } from './coachAiRuntime';

const gatewayFunctions = functions.region('us-central1').runWith({
  secrets: ['ANTHROPIC_API_KEY', 'COACH_AI_API_KEY'],
  timeoutSeconds: 25,
  memory: '256MB',
});

export const coachAiClaudeGateway = gatewayFunctions.https.onRequest(async (request, response) => {
  const correlationId = randomUUID();
  response.set('Cache-Control', 'no-store');
  response.set('X-Content-Type-Options', 'nosniff');

  try {
    const validatedRequest = parseAndAuthorizeCoachAiGatewayRequest({
      method: request.method,
      contentType: request.get('content-type') ?? undefined,
      authorization: request.headers.authorization,
      declaredContentLength: request.get('content-length') ?? undefined,
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? null), 'utf8'),
    }, process.env.COACH_AI_API_KEY ?? '', correlationId);
    if (process.env.COACH_AI_TESTING_ENABLED !== 'true') {
      throw controlledFailure(correlationId, 503, 'server_testing_disabled');
    }
    if (!await requireCoachAiRuntimeEnabled(admin.firestore())) {
      throw controlledFailure(correlationId, 503, 'coach_ai_disabled');
    }
    const outcome = await executeCoachAiClaudeGateway({
      request: validatedRequest,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
      correlationId,
    });
    logTelemetry(outcome.telemetry);
    response.status(200).json({ result: outcome.result });
  } catch (error) {
    const failure = error instanceof CoachAiGatewayError
      ? error
      : controlledFailure(correlationId, 500, 'gateway_internal_failure');
    logTelemetry(failure.telemetry);
    if (failure.retryAfterSeconds != null) response.set('Retry-After', String(failure.retryAfterSeconds));
    if (failure.status === 405) response.set('Allow', 'POST');
    response.status(failure.status).json(safeGatewayErrorBody(failure));
  }
});

function controlledFailure(correlationId: string, status: number, code: string) {
  return new CoachAiGatewayError({
    status,
    code,
    telemetry: {
      correlationId,
      providerRequestId: null,
      modelIdentifier: 'claude-sonnet-5',
      durationMs: 0,
      outcome: code,
      status,
      inputTokens: null,
      outputTokens: null,
    },
  });
}

function logTelemetry(telemetry: CoachAiGatewayTelemetry) {
  const fields = {
    correlationId: telemetry.correlationId,
    providerRequestId: telemetry.providerRequestId,
    modelIdentifier: telemetry.modelIdentifier,
    durationMs: telemetry.durationMs,
    outcome: telemetry.outcome,
    status: telemetry.status,
    inputTokens: telemetry.inputTokens,
    outputTokens: telemetry.outputTokens,
  };
  if (telemetry.status >= 400) functions.logger.warn('coach_ai_gateway_completed', fields);
  else functions.logger.info('coach_ai_gateway_completed', fields);
}
