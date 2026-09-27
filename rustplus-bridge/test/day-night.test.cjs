const test = require('node:test');
const assert = require('node:assert/strict');
const { DayNightClock, formatRemaining } = require('../src/day-night.cjs');

const clock = time => ({ time, sunrise: 6, sunset: 19 });

test('learns real-time day speed and counts down to night', () => {
  const watch = new DayNightClock();
  assert.equal(watch.observe(clock(18), 1_000_000).remainingMinutes, null);
  const forecast = watch.observe(clock(18.4), 1_060_000);
  assert.equal(forecast.kind, 'night');
  assert.ok(Math.abs(forecast.remainingMinutes - 1.5) < 0.01);
  assert.equal(formatRemaining(forecast.remainingMinutes), 'примерно 2 мин');
  assert.equal(watch.shouldRemind(forecast, 'team'), true);
  watch.markReminded(forecast, 'team');
  assert.equal(watch.shouldRemind(forecast, 'team'), false);
  assert.equal(watch.shouldRemind(forecast, 'clan'), true);
});

test('tracks accelerated night across midnight and resets next-cycle reminders', () => {
  const watch = new DayNightClock({ phase: 'day', sent: { night: { team: true, clan: true } } });
  assert.equal(watch.observe(clock(23.5), 1_000_000).remainingMinutes, null);
  const forecast = watch.observe(clock(0.5), 1_060_000);
  assert.equal(forecast.kind, 'morning');
  assert.ok(Math.abs(forecast.remainingMinutes - 5.5) < 0.01);
  assert.equal(watch.shouldRemind(forecast, 'team'), false);
  const close = watch.observe(clock(1.5), 1_120_000);
  assert.equal(watch.shouldRemind(close, 'team'), true);
  watch.markReminded(close, 'team');
  const saved = new DayNightClock(watch.snapshot());
  assert.equal(saved.shouldRemind(close, 'team'), false);
  saved.observe(clock(6.1), 1_180_000);
  assert.equal(saved.snapshot().sent.night.team, false);
});

test('rejects clock jumps and invalid sunrise/sunset data', () => {
  const watch = new DayNightClock();
  assert.equal(watch.observe({ time: 8, sunrise: 20, sunset: 6 }, 1_000_000), null);
  watch.observe(clock(12), 1_000_000);
  const jumped = watch.observe(clock(18), 1_060_000);
  assert.equal(jumped.remainingMinutes, null);
});
