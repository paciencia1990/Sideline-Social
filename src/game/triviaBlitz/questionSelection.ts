import type { TriviaQuestion } from "./types";

export const RECENT_TRIVIA_QUESTION_LIMIT = 50;

type TriviaQuestionWithAnswer = TriviaQuestion & { answer: number };
type QuestionInput = Omit<TriviaQuestionWithAnswer, "id"> & { id?: string };

type SelectTriviaQuestionsOptions = {
  category?: string;
  count: number;
  questions: QuestionInput[];
  random?: () => number;
  recentQuestionIds?: string[];
};

export function selectTriviaQuestions({
  category,
  count,
  questions,
  random = Math.random,
  recentQuestionIds = [],
}: SelectTriviaQuestionsOptions) {
  const normalizedQuestions = normalizeQuestionBank(questions);
  const knownQuestionIds = new Set(normalizedQuestions.map((question) => question.id));
  const eligibleQuestions = normalizedQuestions.filter(
    (question) => !category || question.category === category,
  );
  const recentIds = uniqueStrings(recentQuestionIds).filter((id) => knownQuestionIds.has(id));
  const recentIdSet = new Set(recentIds);
  const recentOrder = new Map(recentIds.map((id, index) => [id, index]));
  const unusedQuestions = fisherYatesShuffle(
    eligibleQuestions.filter((question) => !recentIdSet.has(question.id)),
    random,
  );
  const leastRecentlyUsedQuestions = eligibleQuestions
    .filter((question) => recentIdSet.has(question.id))
    .sort((left, right) => (recentOrder.get(left.id) ?? 0) - (recentOrder.get(right.id) ?? 0));
  const selectedQuestions = [...unusedQuestions, ...leastRecentlyUsedQuestions]
    .slice(0, Math.min(Math.max(0, count), eligibleQuestions.length));
  const selectedIdSet = new Set(selectedQuestions.map((question) => question.id));
  const nextRecentQuestionIds = [
    ...recentIds.filter((id) => !selectedIdSet.has(id)),
    ...selectedQuestions.map((question) => question.id),
  ].slice(-RECENT_TRIVIA_QUESTION_LIMIT);

  return { nextRecentQuestionIds, selectedQuestions };
}

export function normalizeQuestionBank(questions: QuestionInput[]): TriviaQuestionWithAnswer[] {
  const seenIds = new Set<string>();
  const normalized: TriviaQuestionWithAnswer[] = [];

  questions.forEach((question) => {
    const id = question.id?.trim() || createStableQuestionId(question);
    const isWellFormed = Boolean(
      id &&
      question.category?.trim() &&
      question.question_en?.trim() &&
      question.question_es?.trim() &&
      Array.isArray(question.options_en) &&
      Array.isArray(question.options_es) &&
      question.options_en.length >= 2 &&
      question.options_en.length === question.options_es.length &&
      Number.isInteger(question.answer) &&
      question.answer >= 0 &&
      question.answer < question.options_en.length,
    );

    if (!isWellFormed || seenIds.has(id)) return;
    seenIds.add(id);
    normalized.push({ ...question, id });
  });

  return normalized;
}

export function fisherYatesShuffle<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(clampRandom(random()) * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

export function createStableQuestionId(question: Pick<QuestionInput, "category" | "question_en">) {
  const identity = `${question.category.trim().toLocaleLowerCase("en-US")}::${question.question_en
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US")}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `trivia_${(hash >>> 0).toString(36)}`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (typeof value !== "string" || !value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function clampRandom(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 0.9999999999999999);
}
