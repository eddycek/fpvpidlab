# Pro Version Strategy & 10-Year Financial Plan

> **Status**: Proposed

## Executive Summary

FPVPIDlab uses an **open-core freemium model**: all tuning functionality is free, Pro unlocks multi-drone profiles and diagnostic reports. Revenue comes from two streams: **lifetime licenses ($35-$59)** and **annual subscriptions ($15-$19)**, with an optional **Premium tier ($39/year)** from year 2.

**Key projections:**
- Break-even: Month 1 (costs are negligible)
- 5-year cumulative profit: **$134K**
- 10-year cumulative profit: **$600K**
- Year 10 annual recurring revenue: **$85K**

## 1. Pricing Architecture

### Tier Structure

| Feature | Free | Pro Lifetime | Pro Annual | Premium Annual |
|---------|------|-------------|------------|----------------|
| **Price** | $0 | $35→$49→$59 | $15→$19/yr | $39/yr |
| **Available from** | Day 1 | Day 1 | Day 1 | Year 2 |
| Drone profiles | 1 | Unlimited | Unlimited | Unlimited |
| Filter Tune | Yes | Yes | Yes | Yes |
| PID Tune | Yes | Yes | Yes | Yes |
| Flash Tune | Yes | Yes | Yes | Yes |
| Analysis overview | Yes | Yes | Yes | Yes |
| Tuning history | Yes | Yes | Yes | Yes |
| Snapshots & restore | Yes | Yes | Yes | Yes |
| Diagnostic reports | — | Yes | Yes | Yes |
| Cloud backup & sync | — | — | — | Yes |
| Preset marketplace | — | — | — | Yes |
| Priority support | — | — | — | Yes |

### Price Escalation Schedule

| Period | Lifetime | Annual Sub | Premium |
|--------|----------|------------|---------|
| Year 1 (launch) | $35 | $15/yr | — |
| Year 2 | $49 | $15/yr | $39/yr |
| Year 3+ | $59 | $19/yr | $39/yr |

**Rationale:** Early adopters get the best deal (reward for risk). Price increases are justified by feature additions and proven value. Lifetime stays expensive enough to push users toward subscriptions.

### Target Ratios

| Period | Lifetime % | Standard Sub % | Premium % |
|--------|-----------|----------------|-----------|
| Year 1 | 40% | 60% | — |
| Year 2 | 35% | 50% | 15% |
| Year 3+ | 30% | 55% | 15% |

## 2. Open Source Strategy

**Decision: Stay public (open-core model).**

### Why Open Source

| Factor | Impact |
|--------|--------|
| **Certum Open Source OV** | Requires public repo. Private = $200-400/yr regular OV cert |
| **Hardware trust** | Users need to verify USB/MSP code before connecting $500+ FC |
| **Community** | FPV community values openness; builds word-of-mouth |
| **Discovery** | GitHub stars, search indexing, blog mentions |
| **Contributions** | Bug reports, translations, edge-case testing from community |

### What's Protected

- License keys are Ed25519 signed — can't be generated without private key
- Cloud sync backend is proprietary (CF Workers, not in repo)
- Premium features require server-side validation
- Brand, UX, and update velocity are the real moat

### License Choice

**GPL-3.0-only** — prevents proprietary forks (must share modifications under GPL) while allowing personal use and community contributions. Chosen over BSL 1.1 (too restrictive for community trust) and AGPL-3.0 (unnecessary for desktop app with no network interaction).

## 3. Operating Costs

### Annual Cost Breakdown

| Item | Year 1 | Year 2+ | Notes |
|------|--------|---------|-------|
| Cloudflare Workers + R2 + D1 | $85 | $85 | Telemetry, license API, diagnostics |
| Domain (fpvpidlab.app) | $15 | $15 | Google Domains / Cloudflare |
| Apple Developer Program | $99 | $99 | macOS code signing + notarization |
| Certum Open Source OV | $50 | $29 | Windows code signing (renewal cheaper) |
| GitHub (public repo) | $0 | $0 | Free for public repos |
| Stripe fees (~2% avg) | ~$49 | ~$177+ | Blended EU/non-EU rate on revenue |
| Resend (transactional email) | $0 | $0 | Free tier (3K/month) |
| Trivi (invoicing) | $0 | $0 | Existing accounting subscription |
| **Total fixed** | **$249** | **$228** |
| **Total with Stripe fees** | **$298** | **$405+** | Stripe scales with revenue |

### Cost Scaling Model

Stripe is the only cost that scales with revenue. At 2% blended rate:

| Annual Revenue | Stripe Fee | Fixed Costs | Total Costs | Cost % |
|----------------|-----------|-------------|-------------|--------|
| $2,400 | $48 | $249 | $297 | 12.4% |
| $10,000 | $200 | $228 | $428 | 4.3% |
| $50,000 | $1,000 | $228 | $1,228 | 2.5% |
| $100,000 | $2,000 | $228 | $2,228 | 2.2% |

**Insight:** Margins improve dramatically with scale. At $50K+ revenue, costs are <3%.

## 4. Market Sizing

### FPV Drone Market (TAM → SAM → SOM)

| Level | Size | Basis |
|-------|------|-------|
| **TAM** (Total Addressable) | ~500K | Active Betaflight users worldwide (GitHub downloads, configurator telemetry) |
| **SAM** (Serviceable Available) | ~150K | BF 4.3+ users who tune PIDs (not just flash-and-fly) |
| **SOM** (Serviceable Obtainable) | ~25K | Realistic 5-year download base with organic + influencer marketing |

### User Acquisition Assumptions

| Year | New Downloads | Basis |
|------|--------------|-------|
| 1 | 3,000 | Reddit, RCGroups, word-of-mouth |
| 2 | 7,500 | First influencer reviews, GitHub trending |
| 3 | 15,000 | Established reputation, multiple reviews |
| 4 | 20,000 | Community standard tool |
| 5-10 | 25,000/yr | Mature market, steady state |

### Conversion Assumptions

| Metric | Year 1 | Year 3 | Year 5 | Year 10 |
|--------|--------|--------|--------|---------|
| Free→Paid conversion | 3.0% | 4.0% | 5.0% | 6.0% |
| Subscription retention | 75% | 75% | 75% | 75% |
| Premium retention | 80% | 80% | 80% | 80% |
| Active user retention | 60% | 60% | 60% | 60% |

**Conversion rationale:** Desktop developer tools typically see 2-5% conversion. FPVPIDlab targets a passionate niche (FPV pilots spend $1000+ on gear), so 3-6% is conservative.

## 5. Revenue Model — 10-Year Projection

### Detailed Annual Breakdown

| Metric | **Y1** | **Y2** | **Y3** | **Y4** | **Y5** | **Y6** | **Y7** | **Y8** | **Y9** | **Y10** |
|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|---------|
| **New free users** | 3,000 | 7,500 | 15,000 | 20,000 | 25,000 | 25,000 | 25,000 | 25,000 | 25,000 | 25,000 |
| Cumulative free | 3,000 | 10,500 | 25,500 | 45,500 | 70,500 | 95,500 | 120,500 | 145,500 | 170,500 | 195,500 |
| Active free (60% ret.) | 3,000 | 6,300 | 12,300 | 17,400 | 22,500 | 25,200 | 27,300 | 28,800 | 29,700 | 30,000 |
| | | | | | | | | | | |
| **Conversion rate** | 3.0% | 3.5% | 4.0% | 4.5% | 5.0% | 5.5% | 5.5% | 5.5% | 6.0% | 6.0% |
| **New paid total** | 90 | 263 | 600 | 900 | 1,250 | 1,375 | 1,375 | 1,375 | 1,500 | 1,500 |
| | | | | | | | | | | |
| *New lifetime* | 36 | 92 | 180 | 270 | 375 | 413 | 413 | 413 | 450 | 450 |
| *Lifetime price* | $35 | $49 | $59 | $59 | $59 | $59 | $59 | $59 | $59 | $59 |
| *New std sub* | 54 | 132 | 330 | 495 | 688 | 756 | 756 | 756 | 825 | 825 |
| *Std sub price* | $15 | $15 | $19 | $19 | $19 | $19 | $19 | $19 | $19 | $19 |
| *New premium* | 0 | 39 | 90 | 135 | 187 | 206 | 206 | 206 | 225 | 225 |
| *Premium price* | — | $39 | $39 | $39 | $39 | $39 | $39 | $39 | $39 | $39 |
| | | | | | | | | | | |
| **Renewing std sub** | 0 | 41 | 130 | 345 | 630 | 989 | 1,309 | 1,549 | 1,729 | 1,916 |
| **Renewing premium** | 0 | 0 | 31 | 97 | 186 | 298 | 403 | 487 | 554 | 623 |
| **Active std subs** | 54 | 173 | 460 | 840 | 1,318 | 1,745 | 2,065 | 2,305 | 2,554 | 2,741 |
| **Active premium** | 0 | 39 | 121 | 232 | 373 | 504 | 609 | 693 | 779 | 848 |
| **Cumul. lifetime** | 36 | 128 | 308 | 578 | 953 | 1,366 | 1,779 | 2,192 | 2,642 | 3,092 |
| | | | | | | | | | | |
| **Revenue: lifetime** | $1,260 | $4,508 | $10,620 | $15,930 | $22,125 | $24,367 | $24,367 | $24,367 | $26,550 | $26,550 |
| **Revenue: std sub** | $810 | $2,595 | $8,740 | $15,960 | $25,042 | $33,155 | $39,235 | $43,795 | $48,526 | $52,079 |
| **Revenue: premium** | $0 | $1,521 | $4,719 | $9,048 | $14,547 | $19,656 | $23,751 | $27,027 | $30,381 | $33,072 |
| **Gross revenue** | **$2,070** | **$8,624** | **$24,079** | **$40,938** | **$61,714** | **$77,178** | **$87,353** | **$95,189** | **$105,457** | **$111,701** |
| | | | | | | | | | | |
| **Fixed costs** | $249 | $228 | $228 | $228 | $228 | $228 | $228 | $228 | $228 | $228 |
| **Stripe fees (2%)** | $41 | $172 | $482 | $819 | $1,234 | $1,544 | $1,747 | $1,904 | $2,109 | $2,234 |
| **Total costs** | **$290** | **$400** | **$710** | **$1,047** | **$1,462** | **$1,772** | **$1,975** | **$2,132** | **$2,337** | **$2,462** |
| | | | | | | | | | | |
| **Net profit** | **$1,780** | **$8,224** | **$23,369** | **$39,891** | **$60,252** | **$75,406** | **$85,378** | **$93,057** | **$103,120** | **$109,239** |
| **Cumulative profit** | $1,780 | $10,004 | $33,373 | $73,264 | $133,516 | $208,922 | $294,300 | $387,357 | $490,477 | **$599,716** |

### Revenue Composition Over Time

| Year | Lifetime % | Recurring % | Recurring ARR |
|------|-----------|-------------|---------------|
| 1 | 61% | 39% | $810 |
| 3 | 44% | 56% | $13,459 |
| 5 | 36% | 64% | $39,589 |
| 7 | 28% | 72% | $62,986 |
| 10 | 24% | 76% | $85,151 |

**Key insight:** By year 5, recurring revenue dominates. By year 10, the business generates **$85K ARR** from subscriptions alone — this continues even with zero new customers.

## 6. User Base Composition

| Year | Active Free | Active Paid | Paid % | Lifetime | Std Sub | Premium |
|------|------------|-------------|--------|----------|---------|---------|
| 1 | 3,000 | 90 | 2.9% | 36 | 54 | 0 |
| 3 | 12,300 | 889 | 6.7% | 308 | 460 | 121 |
| 5 | 22,500 | 2,644 | 10.5% | 953 | 1,318 | 373 |
| 7 | 27,300 | 4,453 | 14.0% | 1,779 | 2,065 | 609 |
| 10 | 30,000 | 6,681 | 18.2% | 3,092 | 2,741 | 848 |

## 7. Implementation Roadmap

### Phase 1: Launch Foundation (Month 1-2)

**Goal:** Accept payments, deliver licenses.

| # | Task | Effort | Dependency |
|---|------|--------|------------|
| 1.1 | Stripe account setup + product configuration | 1 day | — |
| 1.2 | Stripe Checkout session endpoint (CF Worker) | 2 days | 1.1 |
| 1.3 | Stripe webhook handler (payment → license key) | 2 days | 1.2 |
| 1.4 | Success page on fpvpidlab.app (display license key) | 1 day | 1.2 |
| 1.5 | Resend email integration (license delivery) | 1 day | 1.3 |
| 1.6 | Trivi invoice generation (async from webhook) | 2 days | 1.3 |
| 1.7 | Failed delivery retry cron (hourly) | 1 day | 1.5, 1.6 |
| 1.8 | Pricing page on fpvpidlab.app | 2 days | 1.2 |

**Deliverable:** Users can buy FPVPIDlab Pro ($35 lifetime or $15/year) and receive key via email.

### Phase 2: Launch Marketing (Month 2-3)

| # | Task | Effort | Dependency |
|---|------|--------|------------|
| 2.1 | Landing page optimization (fpvpidlab.app) | 3 days | 1.8 |
| 2.2 | Demo video (3-min YouTube) showing full tuning cycle | 2 days | — |
| 2.3 | Reddit announcement (r/fpv, r/Multicopter, r/betaflight) | 1 day | 2.1 |
| 2.4 | RCGroups thread | 1 day | 2.1 |
| 2.5 | Reach out to Joshua Bardwell / Oscar Liang / Chris Rosser | 1 day | 2.2 |
| 2.6 | GitHub README badges + screenshots | 1 day | — |

**Deliverable:** Initial user acquisition pipeline active.

### Phase 3: Price Escalation (Month 12)

| # | Task | Effort |
|---|------|--------|
| 3.1 | Update Stripe products: lifetime $35→$49 | 30 min |
| 3.2 | Update pricing page: show "was $35" crossed out | 1 hour |
| 3.3 | Email existing free users: "price going up" campaign | 1 day |

### Phase 4: Premium Tier (Month 12-15)

| # | Task | Effort | Dependency |
|---|------|--------|------------|
| 4.1 | Cloud backup API (CF Worker + R2 storage) | 5 days | — |
| 4.2 | Sync client in Electron app | 5 days | 4.1 |
| 4.3 | Preset marketplace backend | 5 days | — |
| 4.4 | Premium license type in LicenseManager | 1 day | — |
| 4.5 | Stripe subscription product for Premium | 1 day | 4.4 |
| 4.6 | UI for cloud sync + marketplace | 5 days | 4.2, 4.3 |

**Deliverable:** Premium tier ($39/yr) with cloud sync and preset marketplace.

### Phase 5: Second Price Escalation (Month 24)

| # | Task | Effort |
|---|------|--------|
| 5.1 | Update Stripe: lifetime $49→$59, annual $15→$19 | 30 min |
| 5.2 | "Lock in old price" email campaign to free users | 1 day |

### Phase 6: VAT Threshold (When EU cross-border > €10K)

| # | Task | Effort |
|---|------|--------|
| 6.1 | Register for EU One-Stop-Shop (OSS) VAT | 1 week (bureaucracy) |
| 6.2 | Enable Stripe Tax add-on | 1 day |
| 6.3 | Update Trivi invoice templates for per-country VAT | 1 day |

**Estimated trigger:** Year 3-4 (when EU B2C revenue exceeds €10K).

## 8. Key Performance Indicators

### Monthly Dashboard Metrics

| KPI | Target Y1 | Target Y3 | Target Y5 |
|-----|-----------|-----------|-----------|
| Monthly downloads | 250 | 1,250 | 2,083 |
| Free→Paid conversion | 3.0% | 4.0% | 5.0% |
| Subscription retention (annual) | 75% | 75% | 75% |
| Monthly revenue | $173 | $2,007 | $5,143 |
| Monthly recurring revenue (MRR) | $68 | $1,122 | $3,299 |
| NPS score | >40 | >50 | >50 |
| Telemetry: verification improvement rate | >60% | >70% | >75% |

### Decision Triggers

| Signal | Action |
|--------|--------|
| Conversion < 2% after 6 months | Revisit free tier limits (add 2-profile cap or time-limited trial) |
| Conversion > 6% | Raise prices sooner |
| Lifetime:Sub ratio > 50:50 | Increase lifetime price or remove lifetime option |
| Subscription churn > 35% | Add retention features (cloud sync, annual discount) |
| >500 GitHub stars | Time for ProductHunt launch |
| Influencer review published | Run time-limited discount campaign |

## 9. Risk Analysis

### Downside Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| BF adds built-in PID analysis | Medium (3yr) | -30-50% TAM | Differentiate on UX, multi-drone workflow, history |
| EU drone regulation kills hobby FPV | Low | -50% market | Expand to commercial drone tuning |
| No influencer pickup in Y1 | Medium | -50% Y1 revenue | Direct community engagement, YouTube content |
| Open source fork competitor | Very Low | -10% | Brand, update speed, cloud features are moat |
| Stripe account suspension | Very Low | Temporary 0 revenue | Keep LemonSqueezy as backup processor |

### Upside Opportunities

| Opportunity | Probability | Impact | Action Trigger |
|-------------|-------------|--------|----------------|
| Joshua Bardwell review | Medium | 3-5x spike (months) | Active outreach in Phase 2 |
| ProductHunt launch | High (self-driven) | 2-3x spike (weeks) | After >500 GitHub stars |
| Corporate/team license | Low-Medium | +$20K/yr | When >3 inquiries from same org |
| BF official partnership | Low | Massive credibility | After >5K active users |
| Mobile companion app | Medium | New revenue stream | Year 3+, if Premium successful |

## 10. Scenario Analysis (10-Year Cumulative)

| Scenario | Assumptions | 10-Year Profit |
|----------|-------------|----------------|
| **Bear case** | 50% of projected users, 2% conversion, no Premium | $148K |
| **Base case** | As modeled | $600K |
| **Bull case** | 150% users, 7% conversion, corporate tier | $1.2M |
| **Disaster** | BF adds analysis in Y2, 70% user loss | $45K |

Even the disaster scenario covers costs and provides meaningful side income.

## 11. Tax & Legal Considerations

### Czech Republic (OSVČ/s.r.o.)

| Item | Detail |
|------|--------|
| **Business form** | OSVČ (sole trader) initially, s.r.o. when revenue > 2M CZK/yr (~$85K) |
| **Income tax (OSVČ)** | 15% flat rate, 60% expense lump sum for software |
| **VAT registration** | Mandatory at 2M CZK/yr turnover (~$85K), voluntary earlier |
| **VAT rate** | 21% on EU B2C sales |
| **OSS registration** | Required when EU cross-border B2C > €10K |
| **Stripe payouts** | SEPA to Czech bank account, weekly |
| **Accounting** | Trivi (automated) + annual tax return |

### Effective Tax Rate Estimate

| Annual Revenue | OSVČ Tax (15% on 40%) | Effective Rate |
|----------------|----------------------|----------------|
| $10,000 | $600 | 6% |
| $50,000 | $3,000 | 6% |
| $85,000+ (switch to s.r.o.) | Varies | 15-19% |

**Note:** With 60% lump sum deduction (software category), effective OSVČ tax rate is ~6%. This is one of the most tax-efficient setups in the EU.

## 12. Summary & Recommendation

### The Numbers

| Metric | Year 1 | Year 5 | Year 10 |
|--------|--------|--------|---------|
| Active free users | 3,000 | 22,500 | 30,000 |
| Active paid users | 90 | 2,644 | 6,681 |
| Annual revenue | $2,070 | $61,714 | $111,701 |
| Annual profit | $1,780 | $60,252 | $109,239 |
| Cumulative profit | $1,780 | $133,516 | $599,716 |
| MRR | $68 | $3,299 | $7,096 |

### Strategic Priorities (Ranked)

1. **Distribution > Features** — One good YouTube review = 6 months of coding. Invest in outreach.
2. **Recurring > Lifetime** — Push subscriptions via pricing. Lifetime is the "expensive comfort option."
3. **Stay open source** — Trust, community, Certum cert savings, and discovery outweigh piracy risk.
4. **Premium tier in Year 2** — Cloud sync is expected by users, pure recurring, and creates switching cost.
5. **Price escalation is free money** — Zero effort, significant impact. Do it on schedule.
6. **Keep costs near zero** — Cloudflare free tiers are the foundation. Don't add AWS/GCP.

### Go/No-Go Checklist for Launch

- [x] License system (Ed25519, offline-first)
- [x] Free tier enforcement (1 profile limit)
- [x] License activation UI
- [x] CF Worker license API (activate, validate, reset)
- [x] D1 database schema
- [ ] Stripe Checkout integration
- [ ] Stripe webhook → license key generation
- [ ] Trivi invoice generation
- [ ] Resend license delivery email
- [ ] Pricing page on fpvpidlab.app
- [ ] Landing page with demo video
- [ ] Community announcement (Reddit, RCGroups)

**Estimated time to launch: 2-3 weeks of focused development.**

---

*This document is the single source of truth for FPVPIDlab's monetization strategy. Update projections annually based on actual metrics.*
