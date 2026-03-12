# Documentation Index

Overview of all design documents in this directory. Completed documents are archived in [`complete/`](./complete/) as historical design records.

## Reference Documents

| Document | Description |
|----------|-------------|
| [PID_TUNING_KNOWLEDGE](./PID_TUNING_KNOWLEDGE.md) | FPV tuning knowledge base — PID/filter theory, quad archetypes, best practices. Used by the `/tuning-advisor` skill. |

## Active Documents

| Document | Status | Description |
|----------|--------|-------------|
| [TUNING_PRECISION_IMPROVEMENTS](./TUNING_PRECISION_IMPROVEMENTS.md) | **Active** | Research-based tuning accuracy improvements: ~~Wiener deconvolution~~ (done), ~~proportional PID scaling~~ (done), ~~data quality scoring~~ (done), ~~flight quality score~~ (done), ~~throttle spectrograms~~ (done), chirp analysis |
| [UX_IMPROVEMENT_IDEAS](./UX_IMPROVEMENT_IDEAS.md) | **Active** | Backlog of UX improvement ideas (4/7 done, rest are future work) |

## Completed Documents (`complete/`)

| Document | Description |
|----------|-------------|
| [BBL_PARSER_VALIDATION](./complete/BBL_PARSER_VALIDATION.md) | Byte-exact validation of BBL parser against BF Explorer reference implementations |
| [BF_VERSION_POLICY](./complete/BF_VERSION_POLICY.md) | Betaflight version compatibility policy (min 4.3, recommended 4.5+) |
| [COMPREHENSIVE_TESTING_PLAN](./complete/COMPREHENSIVE_TESTING_PLAN.md) | 9-phase testing plan: 2180 tests / 107 files |
| [FLASH_TUNE_RECOMMENDATION_PARITY](./complete/FLASH_TUNE_RECOMMENDATION_PARITY.md) | Unified PID pipeline, quality score parity, DC gain I-term rule, per-band TF analysis |
| [FEEDFORWARD_AWARENESS](./complete/FEEDFORWARD_AWARENESS.md) | FF detection, FF-dominated overshoot classification, FF-aware PID recommendations, MSP read |
| [FLIGHT_STYLE_PROFILES](./complete/FLIGHT_STYLE_PROFILES.md) | Smooth/Balanced/Aggressive flight style selector, style-based PID thresholds, preset defaults |
| [OFFLINE_UX_TESTING](./complete/OFFLINE_UX_TESTING.md) | Demo mode (`--demo` flag) for offline UX testing. ~30 Playwright E2E tests |
| [PROPWASH_AND_DTERM_DIAGNOSTICS](./complete/PROPWASH_AND_DTERM_DIAGNOSTICS.md) | Prop wash detection + D-term effectiveness analysis with recommendation integration |
| [PROJECT_QUALITY_REPORT_2026-02-14](./complete/PROJECT_QUALITY_REPORT_2026-02-14.md) | Point-in-time quality assessment (Feb 14, 2026) |
| [QUICK_TUNE_WIENER_DECONVOLUTION](./complete/QUICK_TUNE_WIENER_DECONVOLUTION.md) | Single-flight Flash Tune mode via Wiener deconvolution: transfer function estimation, Bode plots. (Historical: originally described dual-mode Deep Tune vs Flash Tune; Deep Tune later replaced by separate Filter Tune + PID Tune modes) |
| [RPM_FILTER_AWARENESS](./complete/RPM_FILTER_AWARENESS.md) | RPM filter detection via MSP/BBL, RPM-aware filter bounds, dynamic notch optimization |
| [SD_CARD_BLACKBOX_SUPPORT](./complete/SD_CARD_BLACKBOX_SUPPORT.md) | SD card blackbox storage via MSC mode + tuning session fixes |
| [TUNING_HISTORY_AND_COMPARISON](./complete/TUNING_HISTORY_AND_COMPARISON.md) | Tuning session history + before/after comparison on completion |
| [TUNING_WORKFLOW_FIXES](./complete/TUNING_WORKFLOW_FIXES.md) | Fix for download/analyze blocking + phase transition issues |
| [TUNING_WORKFLOW_REVISION](./complete/TUNING_WORKFLOW_REVISION.md) | Stateful tuning workflow design. (Historical: originally described Deep Tune 10-phase state machine; later evolved into 3-mode architecture: Filter Tune, PID Tune, Flash Tune) |

## Status Legend

| Status | Meaning |
|--------|---------|
| **Complete** | Fully implemented and merged. Archived in `complete/` as historical design record. |
| **Active** | Contains a mix of completed and pending items. Living document. |
