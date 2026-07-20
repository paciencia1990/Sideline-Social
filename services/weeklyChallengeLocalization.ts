type WeeklyChallengeDisplay = {
  challengeId?: string | null;
  title?: string | null;
  description?: string | null;
};

type Translate = (key: string, options?: { defaultValue?: string }) => string;

export function localizeWeeklyChallenge<T extends WeeklyChallengeDisplay>(challenge: T, translate: Translate): T & { title: string; description: string } {
  const fallbackTitle = cleanText(challenge.title) || translate("weeklyChallenges.fallbackTitle");
  const fallbackDescription = cleanText(challenge.description) || translate("weeklyChallenges.fallbackDescription");
  const challengeId = cleanText(challenge.challengeId);

  if (!challengeId) {
    return { ...challenge, title: fallbackTitle, description: fallbackDescription };
  }

  return {
    ...challenge,
    title: translate(`weeklyChallenges.catalog.${challengeId}.title`, { defaultValue: fallbackTitle }),
    description: translate(`weeklyChallenges.catalog.${challengeId}.description`, { defaultValue: fallbackDescription }),
  };
}

function cleanText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}
