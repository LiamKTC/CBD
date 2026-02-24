import { makeMCB, makeMCCB, makeCSVBreaker } from "./curveModels.js";

const breakers = [];
const faults = [];

const el = (id) => document.getElementById(id);

// -------------------------
// Samples + download helpers
// -------------------------
const SAMPLE_CSV_SINGLE = `current_A,time_s
100,120
200,30
500,2
1000,0.2
5000,0.02
`;

const SAMPLE_CSV_BAND = `curve,current_A,time_s
min,100,140
min,200,40
min,500,2.5
min,1000,0.25
min,5000,0.025
max,100,100
max,200,25
max,500,1.6
max,1000,0.16
max,5000,0.016
`;

function downloadTextFile(filename, text, mime = "text/csv") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

el("btn_download_csv_single")?.addEventListener("click", () => {
  downloadTextFile("tcc_sample_single_curve.csv", SAMPLE_CSV_SINGLE);
});

el("btn_download_csv_band")?.addEventListener("click", () => {
  downloadTextFile("tcc_sample_min_max_band.csv", SAMPLE_CSV_BAND);
});

el("btn_load_csv_band")?.addEventListener("click", () => {
  el("b_csvText").value = SAMPLE_CSV_BAND;
});

// -------------------------
// UI: show/hide model fields
// -------------------------
function toggleBreakerFields() {
  const model = el("b_model").value;
  el("mcb_fields").classList.toggle("hidden", model !== "mcb");
  el("mccb_fields").classList.toggle("hidden", model !== "mccb");
  el("csv_fields").classList.toggle("hidden", model !== "csv");
}
el("b_model").addEventListener("change", toggleBreakerFields);

// -------------------------
// CSV parsing + file reading
// -------------------------
function parseCSV(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const idxCurve = header.indexOf("curve");
  const idxI = header.indexOf("current_a");
  const idxT = header.indexOf("time_s");

  if (idxI === -1 || idxT === -1) {
    throw new Error("CSV header must include current_A and time_s (and optional curve).");
  }

  const pointsMin = [];
  const pointsMax = [];
  const pointsSingle = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    const I = Number(cols[idxI]);
    const t = Number(cols[idxT]);

    if (!Number.isFinite(I) || !Number.isFinite(t) || I <= 0 || t <= 0) continue;

    if (idxCurve !== -1) {
      const curve = String(cols[idxCurve] || "").trim().toLowerCase();
      if (curve === "min") pointsMin.push({ I, t });
      else if (curve === "max") pointsMax.push({ I, t });
      else pointsSingle.push({ I, t });
    } else {
      pointsSingle.push({ I, t });
    }
  }

  return { pointsMin, pointsMax, pointsSingle };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file."));
    r.readAsText(file);
  });
}

// -------------------------
// Rendering: Breakers list
// -------------------------
function renderBreakers() {
  const wrap = el("breaker_list");
  if (!breakers.length) {
    wrap.innerHTML = `<div class="small"><em>No breakers added</em></div>`;
    return;
  }

  wrap.innerHTML = breakers.map((b, i) => {
    let meta = "";
    if (b.kind === "mcb") meta = `MCB Type ${b.mcbType} · In=${b.In}A`;
    else if (b.kind === "mccb") meta = `MCCB · In=${b.In}A · Ir=${b.Ir}A · Isd=${b.Isd || 0}A · tsd=${b.tsd || 0}s · Ii=${b.Ii || 0}A`;
    else meta = `CSV · ${b.hasBand ? "min/max band" : "single curve"} · In=${b.In}A`;

    const tag = b.tag ? `<span class="badge">${escapeHtml(b.tag)}</span>` : "";
    return `
      <div class="item">
        <div class="itemHead">
          <strong>${i + 1}. ${escapeHtml(b.name)}</strong>
          <div>
            ${tag}
            <button class="btn btnGhost" type="button" data-remove-breaker="${i}">Remove</button>
          </div>
        </div>
        <div class="small">${meta}</div>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll("[data-remove-breaker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-remove-breaker"));
      breakers.splice(idx, 1);
      rerenderAll();
    });
  });
}

// -------------------------
// Rendering: Fault list
// -------------------------
function renderFaults() {
  const wrap = el("fault_list");
  if (!faults.length) {
    wrap.innerHTML = `<div class="small"><em>No fault markers added</em></div>`;
    return;
  }

  wrap.innerHTML = faults.map((f, i) => `
    <div class="item">
      <div class="itemHead">
        <strong>${i + 1}. ${escapeHtml(f.label)}</strong>
        <button class="btn btnGhost" type="button" data-remove-fault="${i}">Remove</button>
      </div>
      <div class="small">Fault current: ${formatAmps(f.I)}</div>
    </div>
  `).join("");

  wrap.querySelectorAll("[data-remove-fault]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-remove-fault"));
      faults.splice(idx, 1);
      rerenderAll();
    });
  });
}

// -------------------------
// Add breaker/fault
// -------------------------
async function addBreakerFromForm() {
  const name = el("b_name").value.trim() || `Breaker ${breakers.length + 1}`;
  const tag = el("b_tag").value.trim();
  const model = el("b_model").value;

  const In = Number(el("b_In").value);
  if (!Number.isFinite(In) || In <= 0) {
    alert("In must be a positive number.");
    return;
  }

  try {
    if (model === "mcb") {
      breakers.push(makeMCB({
        name, tag, In,
        mcbType: el("b_mcbType").value
      }));
    } else if (model === "mccb") {
      breakers.push(makeMCCB({
        name,
        tag,
        In,
        Ir: Number(el("b_Ir").value),
        p: Number(el("b_p").value),
        Isd: Number(el("b_Isd").value),
        tsd: Number(el("b_tsd").value),
        stdMode: el("b_stdMode").value,
        Ii: Number(el("b_Ii").value),
      }));
    } else {
      const file = el("b_csvFile").files?.[0] || null;
      const pasted = el("b_csvText").value.trim();

      let csvText = pasted;
      if (file) csvText = await readFileAsText(file);
      if (!csvText) throw new Error("Provide a CSV file or paste CSV text.");

      const { pointsMin, pointsMax, pointsSingle } = parseCSV(csvText);
      breakers.push(makeCSVBreaker({ name, tag, In, pointsMin, pointsMax, pointsSingle }));
    }

    rerenderAll();
  } catch (e) {
    alert(e?.message || String(e));
  }
}

function addFaultFromForm() {
  const label = el("f_label").value.trim() || `Fault ${faults.length + 1}`;
  const I = Number(el("f_I").value);
  if (!Number.isFinite(I) || I <= 0) {
    alert("Fault current must be a positive number.");
    return;
  }
  faults.push({ label, I });
  rerenderAll();
}

el("btn_add_breaker").addEventListener("click", () => { addBreakerFromForm(); });
el("btn_clear_breakers").addEventListener("click", () => { breakers.length = 0; rerenderAll(); });

el("btn_add_fault").addEventListener("click", addFaultFromForm);
el("btn_clear_faults").addEventListener("click", () => { faults.length = 0; rerenderAll(); });

// -------------------------
// Plotting (robust log axes)
// -------------------------
function buildTraces() {
  const traces = [];
  breakers.forEach((b) => {
    const displayName = b.tag ? `${b.name} (${b.tag})` : b.name;
    traces.push(...b.plotTraces(displayName));
  });
  return traces;
}

function buildFaultAnnotationsAndShapes() {
  const shapes = [];
  const annotations = [];

  faults.forEach((f, idx) => {
    const I = Number(f.I);
    if (!Number.isFinite(I) || I <= 0) return;

    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: I, x1: I,
      y0: 0, y1: 1,
      line: { width: 1, dash: "dot" },
    });

    annotations.push({
      x: I,
      y: 1,
      xref: "x",
      yref: "paper",
      text: `${idx + 1}: ${escapeHtml(f.label)} (${formatAmps(I)})`,
      showarrow: false,
      yanchor: "bottom",
      xanchor: "left",
      font: { size: 11 },
    });
  });

  return { shapes, annotations };
}

function sanitizeTrace(trace) {
  if (!Array.isArray(trace.x) || !Array.isArray(trace.y)) return null;

  const x = [];
  const y = [];
  const n = Math.min(trace.x.length, trace.y.length);

  for (let i = 0; i < n; i++) {
    const xi = Number(trace.x[i]);
    const yi = Number(trace.y[i]);
    if (Number.isFinite(xi) && Number.isFinite(yi) && xi > 0 && yi > 0) {
      x.push(xi);
      y.push(yi);
    }
  }

  if (x.length < 2) return null;
  return { ...trace, x, y };
}

function log10(v) {
  return Math.log(v) / Math.LN10;
}

function computeAxisRanges(traces, faults) {
  let xmin = Infinity, xmax = -Infinity;
  let ymin = Infinity, ymax = -Infinity;

  for (const t of traces) {
    for (const xi of t.x) { xmin = Math.min(xmin, xi); xmax = Math.max(xmax, xi); }
    for (const yi of t.y) { ymin = Math.min(ymin, yi); ymax = Math.max(ymax, yi); }
  }

  for (const f of faults) {
    const I = Number(f.I);
    if (Number.isFinite(I) && I > 0) {
      xmin = Math.min(xmin, I);
      xmax = Math.max(xmax, I);
    }
  }

  if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmin <= 0 || xmax <= 0) {
    xmin = 1; xmax = 1e5;
  }
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax) || ymin <= 0 || ymax <= 0) {
    ymin = 1e-3; ymax = 1e3;
  }

  const padX = 0.15;
  const padY = 0.15;

  return {
    xRange: [log10(xmin) - padX, log10(xmax) + padX],
    yRange: [log10(ymin) - padY, log10(ymax) + padY],
  };
}

function plotAll() {
  const rawTraces = buildTraces();
  const traces = rawTraces.map(sanitizeTrace).filter(Boolean);

  const { shapes, annotations } = buildFaultAnnotationsAndShapes();
  const { xRange, yRange } = computeAxisRanges(traces, faults);

  const layout = {
    title: "Time–Current Curves (log–log)",
    xaxis: { title: "Current (A)", type: "log", autorange: false, range: xRange },
    yaxis: { title: "Trip time (s)", type: "log", autorange: false, range: yRange },
    legend: { orientation: "h" },
    margin: { l: 70, r: 30, t: 60, b: 60 },
    shapes,
    annotations,
  };

  Plotly.react("plot", traces, layout, { responsive: true });
}

// -------------------------
// Report (min/max aware)
// -------------------------
function getTimesForBreaker(b, faultI) {
  // Default: only one time
  const t = b.timeAt(faultI);
  return { tMin: t, tMax: t, hasBand: false };

  // CSV band breakers override (we’ll detect by function presence)
}

function buildReportHtml() {
  const wrap = el("report");

  if (!faults.length) {
    wrap.innerHTML = `<div class="small"><em>Add a fault marker to see “who trips first”.</em></div>`;
    return;
  }
  if (!breakers.length) {
    wrap.innerHTML = `<div class="small"><em>Add at least one breaker to generate a report.</em></div>`;
    return;
  }

  const sections = faults.map((f, fi) => {
    const rows = breakers.map((b) => {
      // If breaker has timeAtMin/timeAtMax, treat as band-aware.
      const isBandAware = typeof b.timeAtMin === "function" && typeof b.timeAtMax === "function";
      const tMin = isBandAware ? b.timeAtMin(f.I) : b.timeAt(f.I);
      const tMax = isBandAware ? b.timeAtMax(f.I) : b.timeAt(f.I);

      return {
        name: b.name,
        tag: b.tag || "",
        kind: b.kind,
        tMin,
        tMax,
        hasBand: isBandAware && b.hasBand === true,
      };
    });

    // Rank by fastest possible trip (tMin)
    rows.sort((a, b) => a.tMin - b.tMin);
    const winner = rows[0];

    // Basic overlap indicator: if winner's max is not strictly below the next min, overlap is possible.
    // More generally, you can compare downstream/upstream pairings later.
    const second = rows[1];
    const overlapPossible = second ? !(winner.tMax < second.tMin) : false;

    const warnBadge = overlapPossible
      ? `<span class="warn">⚠ possible overlap</span>`
      : "";

    const tableRows = rows.map((r, i) => {
      const rank = i + 1;
      const isWinner = i === 0;
      const tag = r.tag ? ` <span class="badge">${escapeHtml(r.tag)}</span>` : "";

      const timeCell = r.hasBand
        ? `${formatSeconds(r.tMin)} <span class="small">(min)</span><br>${formatSeconds(r.tMax)} <span class="small">(max)</span>`
        : `${formatSeconds(r.tMin)}`;

      return `
        <tr>
          <td>${rank}</td>
          <td><strong>${escapeHtml(r.name)}</strong>${tag}</td>
          <td>${String(r.kind).toUpperCase()}</td>
          <td>${timeCell}</td>
          <td>${isWinner ? "Trips first" : ""}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="item">
        <div class="itemHead">
          <strong>${fi + 1}. ${escapeHtml(f.label)}</strong>
          <span class="badge">${formatAmps(f.I)}</span>
        </div>

        <div class="small">
          Winner (fastest possible): <strong>${escapeHtml(winner.name)}</strong>
          ${winner.tag ? `(${escapeHtml(winner.tag)})` : ""}
          at ${formatSeconds(winner.tMin)} ${winner.hasBand ? "(min)" : ""} ${warnBadge}
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Breaker</th>
              <th>Type</th>
              <th>Trip time @ fault</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>

        <div class="small">
          Interpretation:
          <ul>
            <li><strong>min/max</strong> only appears for breakers imported with a CSV <code>min/max</code> band.</li>
            <li>⚠ <strong>possible overlap</strong> means the winner’s slow case could be slower than another breaker’s fast case, so coordination may be uncertain at that fault level.</li>
          </ul>
        </div>
      </div>
    `;
  });

  wrap.innerHTML = sections.join("");
}

// -------------------------
// Formatting + safety
// -------------------------
function formatAmps(A) {
  if (!Number.isFinite(A)) return "—";
  if (A >= 1000) return `${(A / 1000).toFixed(2)} kA`;
  return `${A.toFixed(0)} A`;
}

function formatSeconds(s) {
  if (!Number.isFinite(s)) return "—";
  if (s >= 10) return `${s.toFixed(2)} s`;
  if (s >= 1) return `${s.toFixed(3)} s`;
  if (s >= 0.1) return `${s.toFixed(4)} s`;
  return `${s.toFixed(5)} s`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// -------------------------
// Main rerender + init
// -------------------------
function rerenderAll() {
  renderBreakers();
  renderFaults();
  plotAll();
  buildReportHtml();
}

toggleBreakerFields();
rerenderAll();