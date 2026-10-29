// The published metric definitions (spec "Metrics", analytics epic). The dashboard's Analytics tab
// shows them, and the docs page `/reference/analytics` shows the same strings verbatim, so keep the
// wording here and nowhere else.

/** The docs page with the definitions, the event table, the privacy section and the opt-out. */
export const ANALYTICS_DEFINITIONS_PATH = '/reference/analytics';

/** The metrics of the Analytics tab, in the order its tiles show them. */
export const ANALYTICS_METRIC_DEFINITIONS = {
  impressions: {
    label: 'Impressions',
    definition: 'Number of impression events.',
  },
  reach: {
    label: 'Reach',
    definition: 'Distinct visitors with at least one impression in the period.',
  },
  opens: {
    label: 'Opens',
    definition: 'Number of open events.',
  },
  taleViews: {
    label: 'Tale views',
    definition: 'Number of view events.',
  },
  clicks: {
    label: 'Clicks',
    definition: 'Number of click events.',
  },
  engagementRate: {
    label: 'Engagement rate',
    definition:
      "Engaged visitors ÷ Reach, as a percentage, one decimal, where engaged visitors are the distinct visitors with at least one impression AND at least one open in the period (the same group, for a group's row). Engaged visitors are part of Reach, so the rate never exceeds 100. 0 when Reach is 0.",
  },
  ctr: {
    label: 'CTR (click-through rate)',
    definition: 'Clicks ÷ Tale views, as a percentage, one decimal. 0 when there are no views.',
  },
} as const;

/** Said under the tables: Reach is counted per row, so a total is not the sum of its rows. */
export const ANALYTICS_REACH_NOTE = 'Reach is distinct per row: the Reach of a total is not the sum of its rows.';

/** The period note under the picker: UTC days, today included. */
export const ANALYTICS_PERIOD_NOTE = 'UTC days, today included.';
