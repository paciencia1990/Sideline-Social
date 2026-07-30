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
  appeal: {
    available: boolean;
    status: "none" | "submitted" | "resolved";
  };
};
