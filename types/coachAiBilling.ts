export type CoachAiBillingPlan = 'monthly' | 'yearly';
export type CoachAiBillingStatus = {
  userId: string;
  enabled: boolean;
  entitled: boolean;
  plan: CoachAiBillingPlan | null;
  remaining: number;
  pending: number;
  limit: number;
  resetsAtMs: number | null;
  accessUntilMs: number | null;
  store: 'app_store' | 'play_store' | null;
  autoRenews: boolean;
};
