export type CoachCommunicationDraftResolution = {
  drafts: Map<string, string>;
  message: string;
};

export function resolveCoachCommunicationTeamDraft(input: {
  coachName?: string;
  currentKey: string;
  currentMessage: string;
  drafts: ReadonlyMap<string, string>;
  targetGeneratedMessage: string;
  targetKey: string;
  targetTeamName: string;
}): CoachCommunicationDraftResolution {
  const drafts = new Map(input.drafts);
  drafts.set(input.currentKey, input.currentMessage);

  const existing = drafts.get(input.targetKey);
  if (existing !== undefined) return { drafts, message: existing };

  const message = input.currentKey === ""
    ? input.currentMessage
      .replaceAll("{teamName}", input.targetTeamName)
      .replaceAll("{coachName}", input.coachName?.trim() || "{coachName}")
    : input.targetGeneratedMessage;
  drafts.set(input.targetKey, message);
  return { drafts, message };
}
