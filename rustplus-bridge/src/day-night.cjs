function readClock(raw) {
  const time = Number(raw?.time);
  const sunrise = Number(raw?.sunrise);
  const sunset = Number(raw?.sunset);
  if (![time, sunrise, sunset].every(Number.isFinite) || time < 0 || time >= 24 ||
      sunrise < 0 || sunset >= 24 || sunrise >= sunset) return null;
  return { time, sunrise, sunset, phase: time >= sunrise && time < sunset ? "day" : "night" };
}

function nextTransition(clock, gameHoursPerRealMinute) {
  if (!clock) return null;
  const kind = clock.phase === "day" ? "night" : "morning";
  const targetHour = kind === "night" ? clock.sunset : clock.sunrise;
  const gameHours = (targetHour - clock.time + 24) % 24;
  const remainingMinutes = gameHoursPerRealMinute > 0 ? gameHours / gameHoursPerRealMinute : null;
  return { kind, targetHour, gameHours, remainingMinutes, phase: clock.phase };
}

function formatRemaining(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return "скорость часов уточняется";
  const rounded = Math.max(1, Math.ceil(minutes - 1e-6));
  return `примерно ${rounded} мин`;
}

class DayNightClock {
  constructor(saved = {}) {
    this.previous = null;
    this.rates = { day: null, night: null };
    this.lastPhase = saved.phase === "day" || saved.phase === "night" ? saved.phase : null;
    this.sent = {
      night: { team: Boolean(saved.sent?.night?.team), clan: Boolean(saved.sent?.night?.clan) },
      morning: { team: Boolean(saved.sent?.morning?.team), clan: Boolean(saved.sent?.morning?.clan) }
    };
    this.updatedAt = Number(saved.updatedAt) || 0;
  }

  observe(raw, at = Date.now()) {
    const clock = readClock(raw);
    if (!clock) return null;
    if (this.updatedAt && at - this.updatedAt > 2 * 60 * 60 * 1000) {
      this.sent.night = { team: false, clan: false };
      this.sent.morning = { team: false, clan: false };
      this.rates = { day: null, night: null };
      this.previous = null;
    }
    if (this.lastPhase && this.lastPhase !== clock.phase) {
      if (clock.phase === "day") this.sent.night = { team: false, clan: false };
      else this.sent.morning = { team: false, clan: false };
    }
    if (this.previous?.phase === clock.phase) {
      const realMinutes = (at - this.previous.at) / 60_000;
      const gameHours = (clock.time - this.previous.time + 24) % 24;
      const rate = gameHours / realMinutes;
      if (realMinutes >= 0.04 && realMinutes <= 5 && gameHours > 0 && rate >= 0.02 && rate <= 5) {
        this.rates[clock.phase] = this.rates[clock.phase] === null ? rate : this.rates[clock.phase] * 0.35 + rate * 0.65;
      }
    }
    this.previous = { ...clock, at };
    this.lastPhase = clock.phase;
    this.updatedAt = at;
    return nextTransition(clock, this.rates[clock.phase]);
  }

  shouldRemind(forecast, channel) {
    return Boolean(forecast && ["team", "clan"].includes(channel) &&
      Number.isFinite(forecast.remainingMinutes) && forecast.remainingMinutes > 0 &&
      forecast.remainingMinutes <= 5 && !this.sent[forecast.kind][channel]);
  }

  markReminded(forecast, channel) { this.sent[forecast.kind][channel] = true; }

  snapshot() { return { phase: this.lastPhase, sent: this.sent, updatedAt: this.updatedAt }; }
}

module.exports = { readClock, nextTransition, formatRemaining, DayNightClock };
