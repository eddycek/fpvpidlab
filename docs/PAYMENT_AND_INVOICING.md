# Payment & Invoicing System

> **Status**: Proposed

## Problem

FPVPIDlab needs a monetization layer before community release. We need to accept payments, generate invoices (Czech legal requirement), and deliver license keys — all with minimal operational overhead.

## Analysis

### Why Stripe

| Provider | EU Card Fee | Non-EU Fee | PCI Compliance | Checkout UX |
|----------|------------|------------|----------------|-------------|
| **Stripe** | 1.5% + €0.25 | 3.25% + €0.25 | Hosted Checkout (zero PCI scope) | Excellent |
| LemonSqueezy | 5% + €0.50 | 5% + €0.50 | Managed | Good |
| Paddle | 5% + €0.50 | 5% + €0.50 | Managed (MoR) | Good |

Stripe wins on fees for EU-heavy audience. No Merchant of Record needed — we handle Czech VAT ourselves (simpler under €10K threshold).

### Why Trivi

Trivi is our existing accounting service (Czech SaaS). It provides a REST API for creating and sending invoices programmatically, eliminating manual invoice generation.

- API docs: `https://api.trivi.com/docs`
- Auth: OAuth2 Bearer token (App ID + App Secret → POST /auth/token → 1h access token)
- Already integrated with our Czech accountant's workflow

### VAT Rules

| Scenario | Rate | Notes |
|----------|------|-------|
| Czech customer (B2C/B2B) | 21% | Standard Czech VAT |
| EU customer (B2C), under €10K cross-border | 21% | Czech rate applies to all |
| EU customer (B2C), over €10K cross-border | Per-country | Requires OSS registration |
| Non-EU customer | 0% | Export, no EU VAT |

**Initial phase**: We stay under €10K cross-border threshold → 21% Czech VAT on everything EU. This simplifies accounting significantly.

**Future**: Stripe Tax addon for automatic per-country VAT calculation when we exceed the threshold.

## Architecture

```
Customer → Stripe Checkout (hosted page)
                ↓ payment_intent.succeeded
         CF Worker (webhook handler)
              ├── Generate license key → D1 (see LICENSE_KEY_SYSTEM.md)
              ├── Create invoice → Trivi API
              ├── Send license email → Resend API
              └── Return success
```

### Stripe Checkout Flow

1. Customer clicks "Buy Pro" on fpvpidlab.app
2. Redirect to Stripe Checkout (hosted page) — no PCI scope for us
3. Customer pays (card, Google Pay, Apple Pay, SEPA, etc.)
4. Stripe redirects to success page with `{session_id}` parameter
5. Success page displays license key (fetched from our API via session_id)

### Stripe Webhook Processing

**Endpoint**: `POST /stripe/webhook` (CF Worker at license.fpvpidlab.app)

**Event**: `payment_intent.succeeded`

```
1. Verify webhook signature (Stripe-Signature header + webhook secret)
2. Extract: email, amount, currency, payment_intent_id
3. Check idempotency (payment_intent_id not already processed in D1)
4. Generate license key (see LICENSE_KEY_SYSTEM.md)
5. Store in D1: license_key, email, stripe_payment_id, status='active'
6. Create Trivi invoice (async, non-blocking)
7. Send license email via Resend (async, non-blocking)
8. Return 200 OK to Stripe
```

**Idempotency**: Stripe may retry webhooks. Check `payment_intent_id` in D1 before processing. If already exists, return 200 without re-processing.

**Failure handling**: If Trivi or Resend fails, log error but still return 200 to Stripe (license key is already generated and stored). Retry invoice/email via cron job.

### Trivi API Integration

**Authentication**:
```
POST https://api.trivi.com/auth/token
Content-Type: application/json

{
  "appId": "{TRIVI_APP_ID}",
  "appSecret": "{TRIVI_APP_SECRET}"
}

→ { "accessToken": "...", "expiresIn": 3600 }
```

**Create Invoice**:
```
POST https://api.trivi.com/v2/accountingdocuments
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "type": "issued_invoice",
  "currency": "EUR",
  "vatCountryType": "domestic",
  "issueDate": "2026-03-13",
  "dueDate": "2026-03-27",
  "contact": {
    "name": "Customer Name",
    "email": "customer@example.com"
  },
  "lines": [
    {
      "description": "FPVPIDlab Pro License",
      "quantity": 1,
      "unitPrice": 29.00,
      "vatRate": 21
    }
  ]
}
```

**Send Invoice to Customer**:
```
POST https://api.trivi.com/v2/accountingdocuments/{documentId}/send
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "recipientEmail": "customer@example.com",
  "subject": "FPVPIDlab Pro - Invoice",
  "message": "Thank you for your purchase."
}
```

### License Delivery (Triple Redundancy)

1. **Stripe success page** (immediate): Customer sees key on redirect after payment
2. **Resend email** (seconds): Transactional email with key + download link
3. **Trivi invoice email** (minutes): Separate invoice email from Trivi

This ensures the customer always receives their key even if one channel fails.

### Stripe Payout

- Stripe → Czech bank account via SEPA transfer
- Default schedule: weekly (configurable in Stripe Dashboard)
- Stripe holds funds for 7 days (standard for new accounts, reduces to 2 days over time)

## Implementation Tasks

### Task 1: Stripe Checkout Integration
- [ ] Create Stripe account, configure products/prices
- [ ] CF Worker endpoint: create Checkout session
- [ ] Success page on fpvpidlab.app displaying license key
- [ ] Cancel page redirect

### Task 2: Webhook Handler
- [ ] CF Worker: `POST /stripe/webhook`
- [ ] Stripe signature verification
- [ ] Idempotency check against D1
- [ ] License key generation (delegates to license system)
- [ ] Error logging + retry queue for non-critical failures

### Task 3: Trivi Invoice Generation
- [ ] Trivi API client in CF Worker (auth token caching)
- [ ] Invoice creation from payment data
- [ ] Invoice email sending via Trivi API
- [ ] Error handling: log + retry, never block license delivery

### Task 4: Resend Email Delivery
- [ ] Resend API integration in CF Worker
- [ ] License delivery email template (key + download link)
- [ ] Retry logic for failed sends

### Task 5: Failed Delivery Recovery
- [ ] CF Worker Cron Trigger (hourly): retry failed Trivi/Resend deliveries
- [ ] D1 table: `delivery_queue` (payment_id, type, status, attempts, last_error)
- [ ] Max 5 retry attempts, then alert

## Risks

| Risk | Mitigation |
|------|------------|
| Stripe webhook fails | Idempotent handler, Stripe auto-retries for 72h |
| Trivi API down | Non-blocking, retry via cron job |
| Customer doesn't receive key | Triple delivery (success page + email + invoice) |
| VAT threshold exceeded | Monitor cross-border total, register for OSS when approaching €10K |
| Stripe account review | Keep transaction volume consistent, respond to verification requests promptly |

## Cost Estimate

| Component | Cost |
|-----------|------|
| Stripe fees (EU card) | 1.5% + €0.25 per transaction |
| Stripe fees (non-EU) | 3.25% + €0.25 per transaction |
| CF Worker | Free tier (100K req/day) |
| Trivi API | Included in existing subscription |
| Resend | Free tier (100 emails/day, 3K/month) |

For a €29 product with 100 sales/month (90% EU): ~€65/month in Stripe fees.
