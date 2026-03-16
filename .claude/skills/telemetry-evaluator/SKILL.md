---
name: telemetry-evaluator
description: >
  Evaluates PIDlab telemetry data against target KPIs. Analyzes rule effectiveness,
  verification success rates, metric distributions, and quality score convergence.
  Use to assess whether the app is actually improving users' flights.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash
---

# Telemetry Evaluator

You evaluate PIDlab's telemetry data to determine whether the application is meeting its
goals: improving users' flight performance through automated PID and filter tuning.

## Argument Parsing

Parse `$ARGUMENTS` for **environment** and **mode**. Arguments can appear in any order.

- **Environment**: `dev` or `prod` — defaults to **`prod`**
- **Mode**: `evaluate`, `rules`, `convergence`, `compare` — defaults to **`evaluate`**

Examples:
- `/telemetry-evaluator` → prod + evaluate
- `/telemetry-evaluator dev` → dev + evaluate
- `/telemetry-evaluator rules` → prod + rules
- `/telemetry-evaluator dev rules` → dev + rules
- `/telemetry-evaluator convergence prod` → prod + convergence

## Data Access

All data comes from the telemetry admin API. You MUST set `PIDLAB_ENV` before sourcing `_env.sh`
because it prompts interactively (which Claude Code cannot answer).

```bash
# Set environment BEFORE sourcing (avoids interactive prompt)
export PIDLAB_ENV=prod   # or "dev" — determined from $ARGUMENTS above
source infrastructure/scripts/_env.sh
```

Then use curl to fetch data:
```bash
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/stats/<endpoint>" | jq .
```

Available endpoints:
- `/admin/stats` — overview (installs, active users, mode distribution)
- `/admin/stats/rules` — rule fire/apply counts, avg delta, avg improvement
- `/admin/stats/metrics` — noise floor, overshoot, bandwidth, phase margin distributions
- `/admin/stats/verification` — verification success rates by mode
- `/admin/stats/convergence` — quality score trends across sessions
- `/admin/stats/quality` — quality score histogram
- `/admin/stats/sessions` — session counts by mode
- `/admin/stats/full` — everything in one call

## Modes

Determine the mode from parsed `$ARGUMENTS` (see above):

### Mode: `evaluate` (default)

Full KPI evaluation report.

1. Fetch all data (use environment parsed from arguments):
   ```bash
   export PIDLAB_ENV=<env>   # "prod" or "dev" from argument parsing
   source infrastructure/scripts/_env.sh
   curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" "$PIDLAB_TELEMETRY_API_URL/admin/stats/full" | jq . > /tmp/telemetry-full.json
   curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" "$PIDLAB_TELEMETRY_API_URL/admin/stats/rules" | jq . > /tmp/telemetry-rules.json
   curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" "$PIDLAB_TELEMETRY_API_URL/admin/stats/verification" | jq . > /tmp/telemetry-verification.json
   curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" "$PIDLAB_TELEMETRY_API_URL/admin/stats/convergence" | jq . > /tmp/telemetry-convergence.json
   curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" "$PIDLAB_TELEMETRY_API_URL/admin/stats/metrics" | jq . > /tmp/telemetry-metrics.json
   ```

2. Read all fetched files and evaluate against KPIs (see below)

3. Generate report in this format:

```markdown
# PIDlab Telemetry Evaluation Report
Generated: <date> | Environment: <DEV/PROD>

## Overall Score: XX/100 (<tier>)

## KPI Dashboard
| KPI | Target | Actual | Status |
|-----|--------|--------|--------|
| Recommendation Apply Rate | >70% | XX% | PASS/FAIL |
| Verification Improvement Rate | >60% | XX% | PASS/FAIL |
| Mean Noise Floor Improvement | -2 dB+ | XX dB | PASS/FAIL |
| Mean Overshoot Reduction | -5%+ | XX% | PASS/FAIL |
| Quality Score Convergence | N+1 > N | XX% | PASS/FAIL |
| Rule Positive Delta Rate | >50%/rule | XX% avg | PASS/FAIL |
| Data Quality Distribution | >50% good+ | XX% | PASS/FAIL |

## Rule Effectiveness (Top 10 / Bottom 10)
<table of best and worst performing rules>

## Improvement Recommendations
<numbered list of specific, actionable improvements>
```

### Mode: `rules`

Deep dive into rule effectiveness.

1. Fetch rules data: `/admin/stats/rules`
2. For each rule, analyze:
   - Fire rate (how often it triggers)
   - Apply rate (how often users accept it)
   - Average delta (magnitude of changes)
   - Average improvement when verified
3. Identify:
   - Rules with low apply rate (users don't trust them)
   - Rules with negative improvement (making things worse)
   - Rules that never fire (dead code?)
4. Cross-reference with code: read `src/main/analysis/FilterRecommender.ts`, `PIDRecommender.ts`
5. Suggest threshold adjustments or rule modifications

### Mode: `convergence`

Track quality improvement over time.

1. Fetch convergence data: `/admin/stats/convergence`
2. Analyze:
   - Do users improve across sessions?
   - Which session number sees the biggest jump?
   - What percentage of users are converging?
3. Compare against target: 73% convergence rate
4. If below target, analyze why (data quality? rule effectiveness? user behavior?)

### Mode: `compare`

Compare metrics across segments.

1. Fetch full data: `/admin/stats/full`
2. Break down by available dimensions:
   - By mode (filter vs pid vs quick)
   - By drone size (if available)
   - By BF version (if available)
3. Identify outliers and patterns:
   - Which mode has best improvement rate?
   - Which drone sizes are under-served?
   - Do certain BF versions correlate with issues?

## Target KPIs

| KPI | Target | Description |
|-----|--------|-------------|
| Recommendation apply rate | >70% | Users trust our recommendations |
| Verification improvement rate | >60% | Verification flights show improvement |
| Mean noise floor improvement | -2 dB+ | Filter Tune reduces noise |
| Mean overshoot reduction | -5%+ | PID Tune reduces overshoot |
| Quality score convergence | Session N+1 > N | Users improve over time |
| Rule positive delta rate | >50% per rule | Each rule helps more than it hurts |
| Data quality distribution | >50% good+ | Users fly quality data flights |

## Scoring

Calculate overall score (0-100):
- Each KPI contributes equally (100/7 = ~14.3 points)
- PASS = full points, PARTIAL (within 80% of target) = half points, FAIL = 0
- Tier: 80-100 Excellent, 60-79 Good, 40-59 Fair, 0-39 Poor

## Important Notes

- If endpoints return errors or empty data, report "Insufficient data" rather than failing
- Always show absolute numbers alongside percentages (context matters)
- When making recommendations, reference specific rule IDs and code locations
- Be honest about limitations — small sample sizes mean noisy metrics
