/**
 * Scoring is server-authoritative. This module remains as a narrow import
 * boundary for existing callers while exposing no Firestore mutation API.
 */
export { submitTriviaAnswer } from "./gameState";
export type { ScoreResult } from "./types";
