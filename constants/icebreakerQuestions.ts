export type IcebreakerCategory = "playful" | "interests" | "warm" | "sideline";

export type IcebreakerQuestion = {
  id: string;
  category: IcebreakerCategory;
  translationKey: string;
};

function question(id: number, category: IcebreakerCategory): IcebreakerQuestion {
  const stableId = String(id).padStart(2, "0");
  return {
    id: `icebreaker-${stableId}`,
    category,
    translationKey: `icebreaker.questions.q${stableId}`,
  };
}

export const ICEBREAKER_QUESTIONS: readonly IcebreakerQuestion[] = [
  ...Array.from({ length: 20 }, (_, index) => question(index + 1, "playful")),
  ...Array.from({ length: 20 }, (_, index) => question(index + 21, "interests")),
  ...Array.from({ length: 20 }, (_, index) => question(index + 41, "warm")),
  ...Array.from({ length: 20 }, (_, index) => question(index + 61, "sideline")),
];

export type IcebreakerRotation = {
  getCurrent: () => IcebreakerQuestion;
  next: () => IcebreakerQuestion;
};

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createIcebreakerRotation(random: () => number = Math.random): IcebreakerRotation {
  let current: IcebreakerQuestion | null = null;
  let remaining: IcebreakerQuestion[] = [];

  const refill = () => {
    remaining = shuffled(ICEBREAKER_QUESTIONS, random);
  };

  const takeQuestion = (preferLowPressure: boolean): IcebreakerQuestion => {
    if (remaining.length === 0) refill();

    const differentQuestionIndexes = remaining
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.id !== current?.id);
    const differentCategoryIndexes = differentQuestionIndexes.filter(
      ({ candidate }) => candidate.category !== current?.category,
    );
    const categoryCandidates = differentCategoryIndexes.length > 0
      ? differentCategoryIndexes
      : differentQuestionIndexes;
    const lowPressureCandidates = preferLowPressure
      ? categoryCandidates.filter(({ candidate }) => candidate.category !== "warm")
      : [];
    const candidates = lowPressureCandidates.length > 0 ? lowPressureCandidates : categoryCandidates;
    const selected = candidates[Math.floor(random() * candidates.length)] ?? { index: 0 };
    const [nextQuestion] = remaining.splice(selected.index, 1);
    current = nextQuestion;
    return nextQuestion;
  };

  return {
    getCurrent: () => current ?? takeQuestion(true),
    next: () => takeQuestion(false),
  };
}

// Module scope intentionally keeps the current prompt stable while the app process is running.
// No answers, child data, location data, or question text are persisted.
export const icebreakerSessionRotation = createIcebreakerRotation();