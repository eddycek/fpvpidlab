# Documentation Index

Overview of all design documents in this directory. Completed documents are archived in [`complete/`](./complete/) as historical design records.

## Active Documents

| Document | Status | PRs | Description |
|----------|--------|-----|-------------|
| [PROPWASH_AND_DTERM_DIAGNOSTICS](./PROPWASH_AND_DTERM_DIAGNOSTICS.md) | **Active** | #155, #160 | Prop wash detection + D-term effectiveness analysis (backend done, UI + history pending) |
| [TUNING_PRECISION_IMPROVEMENTS](./TUNING_PRECISION_IMPROVEMENTS.md) | **Active** | #119–#120, #137, #146–#152 | Research-based tuning accuracy improvements: ~~Wiener deconvolution~~ (done), ~~proportional PID scaling~~ (done), ~~data quality scoring~~ (done), ~~flight quality score~~ (done), throttle spectrograms, chirp analysis |
| [UX_IMPROVEMENT_IDEAS](./UX_IMPROVEMENT_IDEAS.md) | **Active** | — | Backlog of UX improvement ideas (4/7 done, rest are future work) |

## Completed Documents (`complete/`)

| Document | PRs | Description |
|----------|-----|-------------|
| [BBL_PARSER_VALIDATION](./complete/BBL_PARSER_VALIDATION.md) | #2–#10 | Byte-exact validation of BBL parser against BF Explorer reference implementations |
| [BF_VERSION_POLICY](./complete/BF_VERSION_POLICY.md) | #79 | Betaflight version compatibility policy (min 4.3, recommended 4.5+) |
| [COMPREHENSIVE_TESTING_PLAN](./complete/COMPREHENSIVE_TESTING_PLAN.md) | #84–#88 | 9-phase testing plan: 2180 tests / 107 files |
| [FEEDFORWARD_AWARENESS](./complete/FEEDFORWARD_AWARENESS.md) | #55–#62 | FF detection, FF-dominated overshoot classification, FF-aware PID recommendations, MSP read |
| [FLIGHT_STYLE_PROFILES](./complete/FLIGHT_STYLE_PROFILES.md) | #71–#78 | Smooth/Balanced/Aggressive flight style selector, style-based PID thresholds, preset defaults |
| [OFFLINE_UX_TESTING](./complete/OFFLINE_UX_TESTING.md) | — | Demo mode (`--demo` flag) for offline UX testing. 25 Playwright E2E tests |
| [PROJECT_QUALITY_REPORT_2026-02-14](./complete/PROJECT_QUALITY_REPORT_2026-02-14.md) | #120 | Point-in-time quality assessment (Feb 14, 2026) |
| [QUICK_TUNE_WIENER_DECONVOLUTION](./complete/QUICK_TUNE_WIENER_DECONVOLUTION.md) | #146–#152 | Single-flight Flash Tune mode via Wiener deconvolution: transfer function estimation, Bode plots, dual-mode tuning (Deep Tune vs Flash Tune) |
| [RPM_FILTER_AWARENESS](./complete/RPM_FILTER_AWARENESS.md) | #63–#69 | RPM filter detection via MSP/BBL, RPM-aware filter bounds, dynamic notch optimization |
| [SD_CARD_BLACKBOX_SUPPORT](./complete/SD_CARD_BLACKBOX_SUPPORT.md) | #105, #142 | SD card blackbox storage via MSC mode + tuning session fixes |
| [TUNING_HISTORY_AND_COMPARISON](./complete/TUNING_HISTORY_AND_COMPARISON.md) | #96–#99 | Tuning session history + before/after comparison on completion |
| [TUNING_WORKFLOW_FIXES](./complete/TUNING_WORKFLOW_FIXES.md) | #42–#45 | Fix for download/analyze blocking + phase transition issues |
| [TUNING_WORKFLOW_REVISION](./complete/TUNING_WORKFLOW_REVISION.md) | #23–#50 | Stateful two-flight tuning workflow (10-phase state machine) |

## Status Legend

| Status | Meaning |
|--------|---------|
| **Complete** | Fully implemented and merged. Archived in `complete/` as historical design record. |
| **Active** | Contains a mix of completed and pending items. Living document. |
