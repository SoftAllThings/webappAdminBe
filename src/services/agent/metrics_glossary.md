# PoopCheck Metrics Glossary

This document defines the canonical meaning of every business term the Analyst
agent may encounter. When a user's question uses one of these terms, interpret
it according to the definition below — do not guess.

If a question uses a term that is NOT in this glossary, ask a clarifying
question before running any tool, or state the assumption you're making.

---

## Premium

A user is **premium** if they currently hold a RevenueCat entitlement that is
active or in trial. This includes both paying subscribers and trial users.

- **Trial premium**: RevenueCat status `in_trial`.
- **Paying premium**: RevenueCat status `active` (not in trial).
- **Has ever been premium**: at any point had `in_trial` OR `active` status.
  This is what the user means when they say "people who have HAD premium" —
  it includes everyone who started a trial, even if they never converted.

Tools to use: `revenuecat_subscriber_state` (one user), `drill_user_sample`
(filter by `subscriptionStatus`), `revenuecat_events` (event-stream view).

## Unsubscribed

A user is **unsubscribed** if their RevenueCat subscription transitioned out
of an active/trial state. Specifically:

- **Cancellation event** (`CANCELLATION`): the user explicitly canceled. The
  subscription may still be active until period end — they have not yet
  *lost access*, but they have unsubscribed.
- **Expiration event** (`EXPIRATION`): subscription ended without renewal.
  This is the moment access is lost.
- **Refund** (`REFUND`): a refund was issued — treat as unsubscribed.

When the user asks "how many unsubscribed," default to **CANCELLATION events**
in the period unless they specify otherwise. State your choice explicitly in
the answer.

Tools: `revenuecat_events` with `eventType: "CANCELLATION"` (or other), then
join against user activity for follow-up questions.

## Active user / Still using the app

A user is **still using the app** if they have ≥ 1 PoopCheck app event in the
last 14 days. The 14-day window is the default; if the question implies a
different window (e.g., "still using this week"), use that instead.

Common app event names start with `pc_` (e.g., `pc_scan_analyze_request_started`,
`pc_scan_analysis_completed`). Treat ANY `pc_*` event as activity.

Tools: BigQuery `events_*` table via `query_event_funnel`, or `drill_user_sample`
for cohort counts.

## Churned

**Churned** = was premium, is no longer premium, AND not still using the app.
This is the strict definition. If a user has unsubscribed but is still using
the free tier, they are NOT churned — they are "downgraded but engaged."

## Disagrees with analysis

**No event for this exists yet.** There is no telemetry capturing when a user
disagrees with the AI's poop analysis. The "I disagree" chip in the codebase
(`ImageViewerModal`) is for community photo voting, not personal analyses.

If a user asks "how many disagree with an analysis," say so plainly: the
event isn't instrumented. Do not silently substitute community votes.

The closest available signal is `section_feedback` (insights brief feedback,
verdict: `useful` / `noise` / `wrong`) — use it only when the user is asking
about feedback on briefs/insights, not about scan analyses.

## Trial-to-paid conversion

A user **converted** if they had a `TRIAL_STARTED` event followed by either
an `INITIAL_PURCHASE` or `RENEWAL` event without an intervening
`CANCELLATION` during the trial.

Tools: `revenuecat_events` filtered by event type, then sequence analysis.

## Cohort

A **cohort** is a group of users defined by a shared property. Common ones:

- **Signup cohort**: users who first registered in a given week/month.
- **Plan cohort**: users on a specific RevenueCat product (`productId`).
- **Store cohort**: `app_store` (iOS) vs `play_store` (Android).
- **Tier cohort**: free vs trial vs paying.

Tools: `cohort_breakdown` slices any metric by these dimensions.

---

## Style for the answer

- Give a single, direct number when possible: "1,247 users unsubscribed in
  the last 30 days, of which 312 (25%) are still active."
- State assumptions inline: "(treating 'unsubscribed' as RevenueCat
  CANCELLATION events; let me know if you meant EXPIRATION instead.)"
- If a tool fails or data is missing, say so — don't fabricate a number.
- Keep responses tight. The user is fast-paced and reads a number, not prose.
