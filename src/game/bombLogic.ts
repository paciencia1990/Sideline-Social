import { ref, set, push } from "firebase/database";
import { rtdb } from "@/config/firebase";

export const STEP_TYPES = {
  CUT_WIRE: "cut_wire",
  PRESS_BUTTON: "press_button",
  ROTATE_DIAL: "rotate_dial",
  ENTER_CODE: "enter_code",
} as const;

type BombStep =
  | { type: typeof STEP_TYPES.CUT_WIRE; color: string }
  | { type: typeof STEP_TYPES.PRESS_BUTTON; label: string }
  | { type: typeof STEP_TYPES.ROTATE_DIAL; target: number }
  | { type: typeof STEP_TYPES.ENTER_CODE; code: number };

type StepInput = {
  color?: string;
  label?: string;
  target?: number;
  code?: number;
};

export const generateBombPattern = (): BombStep[] => {
  const steps: BombStep[] = [
    {
      type: STEP_TYPES.CUT_WIRE,
      color: ["red", "blue", "yellow", "green"][Math.floor(Math.random() * 4)],
    },
    {
      type: STEP_TYPES.PRESS_BUTTON,
      label: ["A", "B", "C", "D"][Math.floor(Math.random() * 4)],
    },
    {
      type: STEP_TYPES.ROTATE_DIAL,
      target: Math.floor(Math.random() * 10) + 1,
    },
    {
      type: STEP_TYPES.ENTER_CODE,
      code: Math.floor(Math.random() * 900) + 100,
    },
  ];

  return steps.sort(() => Math.random() - 0.5);
};

export const validateStep = (step: BombStep, input: StepInput, gameId: string) => {
  let correct = false;

  switch (step.type) {
    case STEP_TYPES.CUT_WIRE:
      correct = input.color === step.color;
      break;
    case STEP_TYPES.PRESS_BUTTON:
      correct = input.label === step.label;
      break;
    case STEP_TYPES.ROTATE_DIAL:
      correct = input.target === step.target;
      break;
    case STEP_TYPES.ENTER_CODE:
      correct = input.code === step.code;
      break;
  }

  const logRef = push(ref(rtdb, `bombDefusal/${gameId}/steps`));
  set(logRef, {
    stepType: step.type,
    expected: step,
    input,
    correct,
    timestamp: Date.now(),
  });

  return { correct };
};

export type { BombStep, StepInput };
