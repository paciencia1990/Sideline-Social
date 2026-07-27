export const SUPPORT_EMAIL: "joann@joinsidelinesocial.com";

export interface ProductionLegalConfigInput {
  privacyPolicyUrl: string | null | undefined;
  termsOfUseUrl: string | null | undefined;
  supportUrl: string | null | undefined;
  supportEmail: string;
}

export interface ProductionLegalConfigResult {
  errors: string[];
  valid: boolean;
}

export function normalizePublicHttpsUrl(value: string | null | undefined): string | null;
export function validateProductionLegalConfig(
  input: ProductionLegalConfigInput,
): ProductionLegalConfigResult;
export function assertProductionLegalConfig(input: ProductionLegalConfigInput): void;
