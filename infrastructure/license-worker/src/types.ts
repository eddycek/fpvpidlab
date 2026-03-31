/** Cloudflare Worker environment bindings */
export interface Env {
  LICENSE_DB: D1Database;
  ADMIN_KEY: string;
  ED25519_PRIVATE_KEY: string;
  ED25519_PUBLIC_KEY: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

/** D1 row for the licenses table */
export interface LicenseRow {
  id: string;
  license_key: string;
  email: string;
  type: 'paid' | 'tester';
  stripe_payment_id: string | null;
  trivi_document_id: string | null;
  installation_id: string | null;
  status: 'active' | 'revoked';
  note: string | null;
  created_at: string;
  activated_at: string | null;
  last_validated_at: string | null;
  reset_count: number;
  max_resets: number;
  whitelist_id: string | null;
}

/** Signed license object returned to the Electron app on activation */
export interface SignedLicense {
  payload: LicensePayload;
  signature: string;
}

/** Payload embedded in the signed license */
export interface LicensePayload {
  keyId: string;
  type: 'paid' | 'tester';
  expiresAt: string | null;
  installationId: string;
  issuedAt: string;
}

/** Request body for POST /license/activate */
export interface ActivateRequest {
  key: string;
  installationId: string;
}

/** Request body for POST /license/validate */
export interface ValidateRequest {
  key: string;
  installationId: string;
}

/** Request body for POST /license/reset */
export interface ResetRequest {
  key: string;
  email: string;
}

/** Request body for POST /admin/keys/generate */
export interface GenerateKeyRequest {
  email: string;
  type?: 'paid' | 'tester';
  note?: string;
  stripePaymentId?: string;
  triviDocumentId?: string;
}

/** Aggregate stats response */
export interface KeyStats {
  total: number;
  active: number;
  revoked: number;
  tester: number;
  activatedLast24h: number;
  activatedLast7d: number;
}

/** D1 row for the beta_whitelist table */
export interface BetaWhitelistRow {
  id: string;
  name: string;
  email: string;
  quad_count: number;
  platform: string;
  comment: string;
  status: 'pending' | 'approved' | 'rejected';
  license_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  ip_address: string | null;
}
