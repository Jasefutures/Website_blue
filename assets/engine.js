(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EvalEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RULESETS = {
    apex_intraday: {
      label: "Apex — Intraday Trail",
      lastVerified: "2026-07-19",
      note: "One-time fee (Apex runs ~90% promos near-constantly). Intraday trail follows unrealized peaks — the tightest floor here, no daily loss limit. 30-day window. +$79 PA activation fee after you pass.",
      ddType: "intraday", lockAtStart: true, dll: null, dllHard: false,
      minDays: 1, maxDays: 22,
      sizes: {
        "25K":  { start: 25000,  target: 1500, dd: 1000, fee: 12, maxMinis: 4 },
        "50K":  { start: 50000,  target: 3000, dd: 2000, fee: 18, maxMinis: 6 },
        "100K": { start: 100000, target: 6000, dd: 3000, fee: 25, maxMinis: 8 },
        "150K": { start: 150000, target: 9000, dd: 4000, fee: 35, maxMinis: 12 }
      }
    },
    apex_eod: {
      label: "Apex — EOD Trail",
      lastVerified: "2026-07-19",
      note: "One-time fee (~90% promos near-constant). EOD trail recalcs at close — more forgiving than intraday. DLL pauses the day (soft breach), not the eval. 30-day window. +$99 PA activation fee after you pass.",
      ddType: "eod", lockAtStart: true, dllHard: false,
      minDays: 1, maxDays: 22,
      sizes: {
        "25K":  { start: 25000,  target: 1500, dd: 1000, dll: 500,  fee: 17, maxMinis: 4 },
        "50K":  { start: 50000,  target: 3000, dd: 2000, dll: 1000, fee: 25, maxMinis: 6 },
        "100K": { start: 100000, target: 6000, dd: 3000, dll: 1500, fee: 35, maxMinis: 8 },
        "150K": { start: 150000, target: 9000, dd: 4000, dll: 2000, fee: 45, maxMinis: 12 }
      }
    },
    tradeify: {
      label: "Tradeify — Growth (EOD)",
      lastVerified: "2026-07-19",
      note: "One-time fee, no time limit. EOD trailing drawdown. DLL is a soft breach (ends the day, not the eval). Fees are approximate — verify current promo on tradeify.co.",
      ddType: "eod", lockAtStart: true, dllHard: false,
      minDays: 1, maxDays: null,
      sizes: {
        "25K":  { start: 25000,  target: 1500, dd: 1000, dll: 600,  fee: 65,  maxMinis: 1 },
        "50K":  { start: 50000,  target: 3000, dd: 2000, dll: 1250, fee: 90,  maxMinis: 4 },
        "100K": { start: 100000, target: 6000, dd: 3500, dll: 2500, fee: 130, maxMinis: 8 },
        "150K": { start: 150000, target: 9000, dd: 5000, dll: 3750, fee: 170, maxMinis: 12 }
      }
    },
    topstep: {
      label: "Topstep — Trading Combine (EOD)",
      lastVerified: "2026-07-19",
      note: "Monthly subscription, no time limit. EOD trailing Max Loss Limit. No daily loss limit by default on TopstepX. Min 2 trading days to pass.",
      ddType: "eod", lockAtStart: true, dll: null, dllHard: false,
      minDays: 2, maxDays: null,
      sizes: {
        "50K":  { start: 50000,  target: 3000, dd: 2000, fee: 49,  feePer: "month", maxMinis: 5 },
        "100K": { start: 100000, target: 6000, dd: 3000, fee: 99,  feePer: "month", maxMinis: 10 },
        "150K": { start: 150000, target: 9000, dd: 4500, fee: 149, feePer: "month", maxMinis: 15 }
      }
    },
    custom: {
      label: "Custom rules",
      lastVerified: null, note: null,
      ddType: "eod", lockAtStart: true, dll: null, dllHard: false,
      minDays: 1, maxDays: null,
      sizes: { "—": { start: 50000, target: 3000, dd: 2000, fee: 0, maxMinis: 99 } }
    }
  };

  const CONTRACTS = {
    NQ:  { label: "NQ — E-mini Nasdaq-100",       pointValue: 20, tick: 0.25 },
    MNQ: { label: "MNQ — Micro E-mini Nasdaq-100", pointValue: 2,  tick: 0.25 }
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SIM_DAY_CAP = 250;

  function simulateOne(cfg, rng) {
    let bal = cfg.start;
    let peak = cfg.start;
    let floor = cfg.start - cfg.dd;
    const goal = cfg.start + cfg.target;
    const cap = cfg.maxDays || SIM_DAY_CAP;
    let days = 0;

    while (days < cap) {
      days++;
      let dayPnl = 0;
      for (let t = 0; t < cfg.tradesPerDay; t++) {
        const pnl = rng() < cfg.winRate ? cfg.rr * cfg.riskPerTrade : -cfg.riskPerTrade;
        bal += pnl;
        dayPnl += pnl;
        if (cfg.ddType === "intraday" && bal > peak) {
          peak = bal;
          floor = cfg.lockAtStart ? Math.min(peak - cfg.dd, cfg.start) : peak - cfg.dd;
        }
        if (bal <= floor) return { outcome: "bust", days };
        if (cfg.dll && dayPnl <= -cfg.dll) {
          if (cfg.dllHard) return { outcome: "bust", days };
          break;
        }
      }
      if (cfg.ddType === "eod" && bal > peak) {
        peak = bal;
        floor = cfg.lockAtStart ? Math.min(peak - cfg.dd, cfg.start) : peak - cfg.dd;
      }
      if (bal >= goal && days >= cfg.minDays) return { outcome: "pass", days };
    }
    return { outcome: cfg.maxDays ? "timeout" : "grind", days };
  }

  function simulate(cfg, runs, seed) {
    runs = runs || 10000;
    const rng = mulberry32(seed == null ? (Math.random() * 1e9) | 0 : seed);
    let pass = 0, bust = 0, timeout = 0;
    const passDays = [];
    for (let i = 0; i < runs; i++) {
      const r = simulateOne(cfg, rng);
      if (r.outcome === "pass") { pass++; passDays.push(r.days); }
      else if (r.outcome === "bust") bust++;
      else timeout++;
    }
    passDays.sort((a, b) => a - b);
    const median = passDays.length ? passDays[Math.floor(passDays.length / 2)] : null;
    const p = pass / runs;
    return {
      runs,
      passProb: p,
      bustProb: bust / runs,
      timeoutProb: timeout / runs,
      medianDaysToPass: median,
      expectedAttempts: p > 0 ? 1 / p : Infinity
    };
  }

  function riskSweep(cfg, points, runsPer, seed) {
    points = points || 13;
    runsPer = runsPer || 2000;
    const lo = cfg.dd * 0.02, hi = cfg.dd * 0.5;
    const out = [];
    for (let i = 0; i < points; i++) {
      const risk = lo + (hi - lo) * (i / (points - 1));
      const r = simulate(Object.assign({}, cfg, { riskPerTrade: risk }), runsPer, seed == null ? 1234 + i : seed + i);
      out.push({ risk, passProb: r.passProb });
    }
    return out;
  }

  function samplePath(cfg, seed) {
    const rng = mulberry32(seed == null ? (Math.random() * 1e9) | 0 : seed);
    let bal = cfg.start, peak = cfg.start, floor = cfg.start - cfg.dd;
    const goal = cfg.start + cfg.target;
    const cap = cfg.maxDays || SIM_DAY_CAP;
    const pts = [{ trade: 0, bal, floor, day: 0 }];
    let outcome = "grind", n = 0;

    for (let day = 1; day <= cap; day++) {
      for (let t = 0; t < cfg.tradesPerDay; t++) {
        n++;
        bal += rng() < cfg.winRate ? cfg.rr * cfg.riskPerTrade : -cfg.riskPerTrade;
        if (cfg.ddType === "intraday" && bal > peak) {
          peak = bal;
          floor = cfg.lockAtStart ? Math.min(peak - cfg.dd, cfg.start) : peak - cfg.dd;
        }
        pts.push({ trade: n, bal, floor, day });
        if (bal <= floor) return { points: pts, outcome: "bust" };
      }
      if (cfg.ddType === "eod" && bal > peak) {
        peak = bal;
        floor = cfg.lockAtStart ? Math.min(peak - cfg.dd, cfg.start) : peak - cfg.dd;
        pts.push({ trade: n, bal, floor, day });
      }
      if (bal >= goal && day >= cfg.minDays) return { points: pts, outcome: "pass" };
    }
    return { points: pts, outcome };
  }

  function contractsFor(riskDollars, stopPoints, pointValue) {
    const perContract = stopPoints * pointValue;
    if (perContract <= 0) return { contracts: 0, perContract: 0, actualRisk: 0 };
    const contracts = Math.floor(riskDollars / perContract);
    return { contracts, perContract, actualRisk: contracts * perContract };
  }

  return { RULESETS, CONTRACTS, simulate, simulateOne, riskSweep, samplePath, contractsFor, mulberry32 };
});

