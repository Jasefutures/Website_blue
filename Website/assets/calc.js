(function () {
  "use strict";
  const E = window.EvalEngine;
  const $ = (id) => document.getElementById(id);

  const firmSel = $("firm"), sizeSel = $("size");
  let lastCfg = null, pathSeed = 1;

  Object.keys(E.RULESETS).forEach((key) => {
    const o = document.createElement("option");
    o.value = key; o.textContent = E.RULESETS[key].label;
    firmSel.appendChild(o);
  });

  function fillSizes() {
    const rs = E.RULESETS[firmSel.value];
    sizeSel.innerHTML = "";
    Object.keys(rs.sizes).forEach((k) => {
      const o = document.createElement("option");
      o.value = k; o.textContent = k === "—" ? "Custom" : "$" + k;
      sizeSel.appendChild(o);
    });
    if (rs.sizes["50K"]) sizeSel.value = "50K";
    $("customRules").style.display = firmSel.value === "custom" ? "" : "none";
    $("rulesNote").textContent = rs.note
      ? "⚠ " + rs.note
      : "";
  }
  firmSel.addEventListener("change", fillSizes);
  fillSizes();

  function buildCfg() {
    const rs = E.RULESETS[firmSel.value];
    let base;
    if (firmSel.value === "custom") {
      base = {
        start: +$("cStart").value || 50000,
        target: +$("cTarget").value || 3000,
        dd: +$("cDd").value || 2000,
        fee: +$("cFee").value || 0,
        maxMinis: 99
      };
      rs.ddType = $("cDdType").value;
      rs.dll = +$("cDll").value > 0 ? +$("cDll").value : null;
    } else {
      base = rs.sizes[sizeSel.value];
    }
    return {
      start: base.start, target: base.target, dd: base.dd,
      fee: base.fee, feePer: base.feePer || "attempt", maxMinis: base.maxMinis,
      ddType: rs.ddType, lockAtStart: rs.lockAtStart,
      dll: firmSel.value === "custom" ? rs.dll : (base.dll || rs.dll || null),
      dllHard: !!rs.dllHard,
      minDays: rs.minDays || 1, maxDays: rs.maxDays || null,
      winRate: Math.min(0.99, Math.max(0.01, (+$("winRate").value || 45) / 100)),
      rr: Math.max(0.1, +$("rr").value || 1.8),
      riskPerTrade: Math.max(1, +$("riskPerTrade").value || 200),
      tradesPerDay: Math.max(1, Math.round(+$("tradesPerDay").value || 3))
    };
  }

  const pct = (x) => (x * 100).toFixed(1) + "%";
  const usd = (x) => "$" + Math.round(x).toLocaleString("en-US");

  function passClass(p) { return p >= 0.65 ? "pos" : p >= 0.5 ? "warn-c" : "neg"; }

  function run() {
    const cfg = buildCfg();
    lastCfg = cfg;
    const res = E.simulate(cfg, 10000);

    $("resultsCard").style.display = "";
    const passEl = $("outPass");
    passEl.textContent = pct(res.passProb);
    passEl.className = "value " + passClass(res.passProb);
    $("outPassSub").textContent = "of 10,000 simulated evals";
    $("outBust").textContent = pct(res.bustProb);

    if (cfg.maxDays) {
      $("outTimeLabel").textContent = "Ran out of time";
      $("outTimeoutSub").textContent = "window ended before target";
    } else {
      $("outTimeLabel").textContent = "Still grinding";
      $("outTimeoutSub").textContent = "no target after 250 sim days";
    }
    $("outTimeout").textContent = pct(res.timeoutProb);
    $("outDays").textContent = res.medianDaysToPass == null ? "—" : res.medianDaysToPass;

    const att = res.expectedAttempts;
    $("outAttempts").textContent = att === Infinity ? "∞" : att.toFixed(1);
    if (cfg.feePer === "month") {
      const months = res.medianDaysToPass ? Math.max(1, Math.ceil(res.medianDaysToPass / 21)) : 1;
      const cost = att === Infinity ? null : att * months * cfg.fee;
      $("outCost").textContent = cost == null ? "—" : usd(cost);
      $("outCostSub").textContent = "attempts × months × $" + cfg.fee + "/mo";
    } else {
      $("outCost").textContent = att === Infinity ? "—" : usd(att * cfg.fee);
      $("outCostSub").textContent = "attempts × $" + cfg.fee + " fee";
    }

    const v = $("verdict");
    if (res.passProb >= 0.65) {
      v.className = "verdict good";
      v.innerHTML = "<strong>Playable.</strong> These numbers clear the eval more often than not. The remaining risk is you: revenge trades and oversizing aren't in the sim.";
    } else if (res.passProb >= 0.5) {
      v.className = "verdict mid";
      v.innerHTML = "<strong>Coin flip.</strong> Expect to pay for multiple attempts. Before buying an eval, try cutting risk per trade — check the curve below.";
    } else {
      v.className = "verdict bad";
      v.innerHTML = "<strong>Don't pay for an eval with these numbers.</strong> The drawdown will eat you before the target. Cut risk per trade, or be honest about the win rate — see the curve below for what risk level gives you the best shot.";
    }

    const mnq = E.contractsFor(cfg.riskPerTrade, +$("stopPoints").value, E.CONTRACTS.MNQ.pointValue);
    const nq = E.contractsFor(cfg.riskPerTrade, +$("stopPoints").value, E.CONTRACTS.NQ.pointValue);
    $("outMnq").textContent = mnq.contracts;
    $("outMnqSub").textContent = mnq.contracts > 0 ? "actual risk " + usd(mnq.actualRisk) : "stop too wide for this risk";
    $("outNq").textContent = nq.contracts;
    $("outNqSub").textContent = nq.contracts > 0 ? "actual risk " + usd(nq.actualRisk) : "use MNQ at this risk level";

    drawSweep(cfg);
    pathSeed = (Math.random() * 1e9) | 0;
    drawPath();
  }

  function drawSweep(cfg) {
    const svg = $("sweepChart");
    const data = E.riskSweep(cfg, 13, 2000);
    const W = 640, H = 220, padL = 46, padR = 12, padT = 14, padB = 34;
    const xs = (i) => padL + (W - padL - padR) * (i / (data.length - 1));
    const ys = (p) => padT + (H - padT - padB) * (1 - p);
    let best = 0;
    data.forEach((d, i) => { if (d.passProb > data[best].passProb) best = i; });

    const css = getComputedStyle(document.documentElement);
    const cAccent = css.getPropertyValue("--accent").trim();
    const cMuted = css.getPropertyValue("--muted").trim();
    const cPos = css.getPropertyValue("--pos").trim();
    const cBorder = css.getPropertyValue("--border").trim();

    let s = "";

    for (let g = 0; g <= 4; g++) {
      const y = ys(g / 4);
      s += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${cBorder}" stroke-width="1"/>`;
      s += `<text x="${padL - 8}" y="${y + 4}" fill="${cMuted}" font-size="11" text-anchor="end" font-family="monospace">${g * 25}%</text>`;
    }
    const line = data.map((d, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(d.passProb).toFixed(1)}`).join(" ");
    s += `<path d="${line}" fill="none" stroke="${cAccent}" stroke-width="2.5"/>`;
    data.forEach((d, i) => {
      s += `<circle cx="${xs(i)}" cy="${ys(d.passProb)}" r="${i === best ? 5 : 3}" fill="${i === best ? cPos : cAccent}"/>`;
      if (i % 3 === 0 || i === best) {
        s += `<text x="${xs(i)}" y="${H - 12}" fill="${cMuted}" font-size="11" text-anchor="middle" font-family="monospace">$${Math.round(d.risk)}</text>`;
      }
    });
    s += `<text x="${xs(best)}" y="${ys(data[best].passProb) - 10}" fill="${cPos}" font-size="12" text-anchor="middle" font-family="monospace">best: $${Math.round(data[best].risk)}</text>`;
    svg.innerHTML = s;
  }

  function drawPath() {
    if (!lastCfg) return;
    const cv = $("pathChart"), ctx = cv.getContext("2d");
    const run = E.samplePath(lastCfg, pathSeed);
    const pts = run.points;
    const W = cv.width, H = cv.height, padL = 56, padR = 10, padT = 12, padB = 22;

    const goal = lastCfg.start + lastCfg.target;
    let lo = Math.min(lastCfg.start - lastCfg.dd, ...pts.map((p) => p.bal));
    let hi = Math.max(goal, ...pts.map((p) => p.bal));
    const span = (hi - lo) || 1; lo -= span * 0.05; hi += span * 0.05;

    const X = (i) => padL + (W - padL - padR) * (i / Math.max(1, pts.length - 1));
    const Y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));

    const css = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "11px monospace";

    ctx.strokeStyle = css.getPropertyValue("--pos").trim(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(goal)); ctx.lineTo(W - padR, Y(goal)); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.fillText("target", W - padR - 44, Y(goal) - 4);

    ctx.strokeStyle = css.getPropertyValue("--neg").trim(); ctx.setLineDash([]); ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p.floor); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();

    ctx.strokeStyle = css.getPropertyValue("--accent").trim(); ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p.bal); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();

    ctx.fillStyle = css.getPropertyValue("--muted").trim();
    [lo + span * 0.05, lastCfg.start, goal].forEach((v) => {
      ctx.fillText("$" + Math.round(v / 1000) + "k", 8, Y(v) + 4);
    });

    const oc = $("pathOutcome");
    if (run.outcome === "pass") { oc.innerHTML = 'This run <span class="num pos">PASSED</span> in ' + pts[pts.length - 1].day + " days."; }
    else if (run.outcome === "bust") { oc.innerHTML = 'This run <span class="num neg">BUSTED</span> on day ' + pts[pts.length - 1].day + " — equity touched the floor."; }
    else { oc.textContent = "This run never finished."; }
  }

  $("runBtn").addEventListener("click", run);
  $("rerollBtn").addEventListener("click", () => { pathSeed = (Math.random() * 1e9) | 0; drawPath(); });
})();

