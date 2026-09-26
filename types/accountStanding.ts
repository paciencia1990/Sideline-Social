export type AccountStandingStatus =
  | "active"
  | "messagingRestricted"
  | "suspended"
  | "banned";

export type AccountStanding = {
  status: AccountStandingStatus;
  effectiveAt: string | null;
  expiresAt: string | null;
  publicReasonCode: string;
  revision: number;
  warning?: {
    pending: true;
    id: string;
    publicReasonCode: string;
    effectiveAt: string | null;
  } | null;
  appeal: {
    available: boolean;
    status: "none" | "submitted" | "resolved";
  };
};
