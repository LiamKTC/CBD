// curveModels.js
// Breaker models produce:
// - timeAt(I): trip time at current I (seconds)
// - plotTraces(displayName): Plotly trace(s) to render

function linspaceLog(xMin, xMax, n) {
  const a = Math.log10(xMin);
  const b = Math.log10(xMax);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(Math.pow(10, a + (b - a) * t));
  }
  return out;
}

function clampTime(t) {
  if (!Number.isFinite(t)) return 1e9;
  return Math.max(0.001, Math.min(t, 1e6));
}

// Inverse-time thermal approximation.
function thermalTime(I, Ir, p, tRef = 40, multRef = 1.5) {
  const K = tRef * Math.pow(multRef, p);
  return K * Math.pow(I / Ir, -p);
}

// ---- CSV helpers ----
function sortByCurrent(points) {
  return (points || [])
    .filter(p => Number.isFinite(p.I) && Number.isFinite(p.t) && p.I > 0 && p.t > 0)
    .sort((a, b) => a.I - b.I);
}

// Log–log interpolation of t across I.
function interpLogLog(points, I) {
  if (!points.length) return 1e9;

  if (I <= points[0].I) return points[0].t;
  if (I >= points[points.length - 1].I) return points[points.length - 1].t;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    if (I >= a.I && I <= b.I) {
      const x0 = Math.log10(a.I), x1 = Math.log10(b.I);
      const y0 = Math.log10(a.t), y1 = Math.log10(b.t);
      const x = Math.log10(I);

      const u = (x - x0) / (x1 - x0);
      const y = y0 + u * (y1 - y0);
      return Math.pow(10, y);
    }
  }

  return points[points.length - 1].t;
}

// ===== MCB =====
export function makeMCB({ name, tag, In, mcbType }) {
  const instBand = { B: [3, 5], C: [5, 10], D: [10, 20] }[mcbType] || [5, 10];
  const instLower = instBand[0] * In;
  const instUpper = instBand[1] * In;

  function timeAt(I) {
    if (!Number.isFinite(I) || I <= 0) return 1e9;

    let t = thermalTime(I, In, 2.0, 30, 1.5);
    if (I >= instUpper) t = Math.min(t, 0.01);
    else if (I >= instLower) t = Math.min(t, 0.03);

    return clampTime(t);
  }

  function plotTraces(displayName) {
    const Imin = 1.05 * In;
    const Imax = 50 * In;
    const Igrid = linspaceLog(Imin, Imax, 260);
    const tgrid = Igrid.map(timeAt);

    return [{
      x: Igrid, y: tgrid,
      mode: "lines",
      name: displayName,
      hovertemplate: "I=%{x:.3g} A<br>t=%{y:.3g} s<extra></extra>",
    }];
  }

  return { kind: "mcb", name, tag, In, mcbType, timeAt, plotTraces };
}

// ===== MCCB/ACB =====
export function makeMCCB({ name, tag, In, Ir, p, Isd, tsd, stdMode, Ii }) {
  const IrUse = (Number.isFinite(Ir) && Ir > 0) ? Ir : In;
  const pUse  = (Number.isFinite(p)  && p  > 0) ? p  : 2.0;

  const IsdUse = (Number.isFinite(Isd) && Isd > 0) ? Isd : 0;
  const tsdUse = (Number.isFinite(tsd) && tsd > 0) ? tsd : 0;
  const IiUse  = (Number.isFinite(Ii)  && Ii  > 0) ? Ii  : 0;

  function timeAt(I) {
    if (!Number.isFinite(I) || I <= 0) return 1e9;

    let t = thermalTime(I, IrUse, pUse, 40, 1.5);

    if (IsdUse && tsdUse && I >= IsdUse) {
      if (stdMode === "i2t") {
        const tI2t = tsdUse * Math.pow(IsdUse / I, 2);
        t = Math.min(t, Math.max(tI2t, 0.02));
      } else {
        t = Math.min(t, tsdUse);
      }
    }

    if (IiUse && I >= IiUse) t = Math.min(t, 0.01);

    return clampTime(t);
  }

  function plotTraces(displayName) {
    const Imin = 1.05 * IrUse;
    const Imax = Math.max(50 * IrUse, (IiUse || 0) * 2, (IsdUse || 0) * 2, 1000);
    const Igrid = linspaceLog(Imin, Imax, 320);
    const tgrid = Igrid.map(timeAt);

    return [{
      x: Igrid, y: tgrid,
      mode: "lines",
      name: displayName,
      hovertemplate: "I=%{x:.3g} A<br>t=%{y:.3g} s<extra></extra>",
    }];
  }

  return {
    kind: "mccb",
    name, tag, In,
    Ir: IrUse, p: pUse, Isd: IsdUse, tsd: tsdUse, stdMode, Ii: IiUse,
    timeAt, plotTraces,
  };
}

// ===== CSV Breaker =====
export function makeCSVBreaker({ name, tag, In, pointsMin, pointsMax, pointsSingle }) {
  const minPts = sortByCurrent(pointsMin);
  const maxPts = sortByCurrent(pointsMax);
  const singlePts = sortByCurrent(pointsSingle);

  const hasBand = (minPts.length >= 2 && maxPts.length >= 2);
  const hasSingle = (singlePts.length >= 2);

  if (!hasBand && !hasSingle) {
    throw new Error("CSV breaker needs at least 2 points for single curve, or 2 min + 2 max points.");
  }

  function timeAtMin(I) {
    if (!Number.isFinite(I) || I <= 0) return 1e9;
    if (hasBand) return clampTime(interpLogLog(minPts, I));
    return clampTime(interpLogLog(singlePts, I));
  }

  function timeAtMax(I) {
    if (!Number.isFinite(I) || I <= 0) return 1e9;
    if (hasBand) return clampTime(interpLogLog(maxPts, I));
    return clampTime(interpLogLog(singlePts, I));
  }

  // Keep timeAt() for compatibility: use MIN as conservative for “could trip first”
  function timeAt(I) {
    return timeAtMin(I);
  }

  function plotTraces(displayName) {
    if (hasBand) {
      const Imin = Math.min(minPts[0].I, maxPts[0].I);
      const Imax = Math.max(minPts[minPts.length - 1].I, maxPts[maxPts.length - 1].I);
      const Igrid = linspaceLog(Imin, Imax, 280);

      const yMin = Igrid.map(timeAtMin);
      const yMax = Igrid.map(timeAtMax);

      return [
        {
          x: Igrid, y: yMax,
          mode: "lines",
          name: `${displayName} (max)`,
          line: { width: 1 },
          hovertemplate: "I=%{x:.3g} A<br>t(max)=%{y:.3g} s<extra></extra>",
          showlegend: false,
        },
        {
          x: Igrid, y: yMin,
          mode: "lines",
          name: `${displayName} (min/max band)`,
          fill: "tonexty",
          hovertemplate: "I=%{x:.3g} A<br>t(min)=%{y:.3g} s<extra></extra>",
        }
      ];
    }

    const Imin = singlePts[0].I;
    const Imax = singlePts[singlePts.length - 1].I;
    const Igrid = linspaceLog(Imin, Imax, 260);
    const y = Igrid.map(timeAtMin);

    return [{
      x: Igrid,
      y,
      mode: "lines",
      name: `${displayName} (CSV)`,
      hovertemplate: "I=%{x:.3g} A<br>t=%{y:.3g} s<extra></extra>",
    }];
  }

  return {
    kind: "csv",
    name, tag, In,
    hasBand,
    timeAt,
    timeAtMin,
    timeAtMax,
    plotTraces,
  };
}