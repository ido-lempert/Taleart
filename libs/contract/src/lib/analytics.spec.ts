import {
  analyticsPeriodDays,
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_PERIODS,
  ctr,
  engagementRate,
  isAnalyticsEventTimeAccepted,
  isAnalyticsEventType,
  isAnalyticsPeriod,
} from './analytics';

describe('analytics vocabulary', () => {
  it('names the four event types the SDK sends, and no answer event', () => {
    expect(ANALYTICS_EVENT_TYPES).toEqual(['impression', 'open', 'view', 'click']);
    expect(isAnalyticsEventType('view')).toBe(true);
    expect(isAnalyticsEventType('answer')).toBe(false);
    expect(isAnalyticsEventType('Impression')).toBe(false);
    expect(isAnalyticsEventType(undefined)).toBe(false);
  });

  it('has the three periods, in days', () => {
    expect(ANALYTICS_PERIODS).toEqual(['7d', '30d', '90d']);
    expect(ANALYTICS_PERIODS.map(analyticsPeriodDays)).toEqual([7, 30, 90]);
    expect(isAnalyticsPeriod('30d')).toBe(true);
    expect(isAnalyticsPeriod('365d')).toBe(false);
    expect(isAnalyticsPeriod(30)).toBe(false);
  });
});

describe('the accepted event window', () => {
  const now = new Date('2026-10-29T12:00:00.000Z');

  it('accepts times from 7 days back to 1 hour ahead, inclusive', () => {
    expect(isAnalyticsEventTimeAccepted(new Date('2026-10-22T12:00:00.000Z'), now)).toBe(true);
    expect(isAnalyticsEventTimeAccepted(new Date('2026-10-29T13:00:00.000Z'), now)).toBe(true);
    expect(isAnalyticsEventTimeAccepted(new Date(now), now)).toBe(true);
  });

  it('drops times older than 7 days or more than 1 hour ahead, and invalid dates', () => {
    expect(isAnalyticsEventTimeAccepted(new Date('2026-10-22T11:59:59.999Z'), now)).toBe(false);
    expect(isAnalyticsEventTimeAccepted(new Date('2026-10-29T13:00:00.001Z'), now)).toBe(false);
    expect(isAnalyticsEventTimeAccepted(new Date('nope'), now)).toBe(false);
  });
});

describe('engagementRate', () => {
  it('is the visitors with an open as a percentage of reach, one decimal', () => {
    expect(engagementRate(1, 3)).toBe(33.3);
    expect(engagementRate(2, 3)).toBe(66.7);
    expect(engagementRate(1, 8)).toBe(12.5);
    expect(engagementRate(1, 1)).toBe(100);
    expect(engagementRate(0, 5)).toBe(0);
  });

  it('is 0 when reach is 0', () => {
    expect(engagementRate(0, 0)).toBe(0);
    expect(engagementRate(4, 0)).toBe(0);
  });

  it('rounds half up at the first decimal', () => {
    // 1 of 16 is 6.25 percent: the second decimal rounds it up.
    expect(engagementRate(1, 16)).toBe(6.3);
    // 1 of 400 is 0.25 percent.
    expect(engagementRate(1, 400)).toBe(0.3);
  });
});

describe('ctr', () => {
  it('is clicks as a percentage of tale views, one decimal', () => {
    expect(ctr(1, 4)).toBe(25);
    expect(ctr(1, 3)).toBe(33.3);
    expect(ctr(7, 10)).toBe(70);
    expect(ctr(5, 2)).toBe(250);
  });

  it('is 0 when there are no views, whatever the clicks', () => {
    expect(ctr(0, 0)).toBe(0);
    expect(ctr(3, 0)).toBe(0);
  });
});
