// app.js
import { makeMCB, makeMCCB, makeCSVBreaker } from "./curveModels.js";

const breakers = [];
const faults = [];
const el = (id) => document.getElementById(id);

function toggleBreakerFields() {
  const model = el("b_model").value;
  el("mcb_fields").classList.toggle("hidden", model !== "mcb");
  el("mccb_fields").classList.toggle("hidden", model !== "mccb");
  el("csv_fields").classList.toggle("hidden", model !== "csv");
}
el("b_model").addEventListener("change", toggleBreakerFields);

// ---------- CSV helpers ----------
function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  if (lines.length < 2) throw new Error("CSV must include a header row and at least one data row.");

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
      const c = (cols[idxCurve] || "").toLowerCase();
      if (c === "min") pointsMin.push({ I, t });
      else if (c === "max") pointsMax.push({ I, t });
      else pointsSingle.push({ I, t }); // allow “other” to fall back
    } else {
      pointsSingle.push({ I, t });
    }
  }

  return { pointsMin, pointsMax, pointsSingle };
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file."));
    r.readAsText(file);
  });
}

// ---------- Breaker list UI ----------
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

    const tag = b.tag ? `<span class="badge">${b.tag}</span>` : "";
    return `
      <div class="item">
        <div class="itemHead">
          <strong>${i + 1}. ${b.name}</strong>
          <div>
            ${tag}
            <button class="btn btnGhost" data-remove-breaker="${i}">Remove</button>
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

async function addBreakerFromForm() {
  const name = el("b_name").value.trim() || `Breaker ${breakers.length + 1}`;
  const tag = el("b_tag").value.trim();
  const model = el("b_model").value;
  const In = Number(el("b_In").value);

  if (!In || In <= 0) {
    alert("In must be > 0");
    return;
  }

  try {
    if (model === "mcb") {
      const mcbType = el("b_mcbType").value;
      breakers.push(makeMCB({ name, tag, In, mcbType }));
    } else if (model === "mccb") {
      breakers.push(
        makeMCCB({
          name,
          tag,
          In,
          Ir: Number(el("b_Ir").value),
          p: Number(el("b_p").value),
          Isd: Number(el("b_Isd").value),
          tsd: Number(el("b_tsd").value),
          stdMode: el("b_stdMode").value,
          Ii: Number(el("b_Ii").value),
        })
      );
    } else {
      // CSV
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
    alert(e.message || String(e));
  }
}

el("btn_add_breaker").addEventListener("click", () => { addBreakerFromForm(); });

el("btn_clear_breakers").addEventListener("click", () => {
  breakers.length = 0;
  rerenderAll();
});

// ---------- Fault marker UI ----------
function renderFaults() {
  const wrap = el("fault_list");
  if (!faults.length) {
    wrap.innerHTML = `<div class="small"><em>No fault markers added</em></div>`;
    return;
  }

  wrap.innerHTML = faults.map((f, i) => `
    <div class="item">
      <div class="itemHead">
        <strong>${i + 1}. ${f.label}</strong>
        <button class="btn btnGhost" data-remove-fault="${i}">Remove</button>
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

function addFaultFromForm() {
  const label = el("f_label").value.trim() || `Fault ${faults.length + 1}`;
  const I = Number(el("f_I").value);
  if (!I || I <= 0) { alert("Fault current must be > 0"); return; }
  faults.push({ label, I });
  rerenderAll();
}

el("btn_add_fault").addEventListener("click", addFaultFromForm);

el("btn_clear_faults").addEventListener("click", () => {
  faults.length = 0;
  rerenderAll();
});

// ---------- Plotting ----------
function formatAmps(A) {
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
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: f.I,
      x1: f.I,
      y0: 0,
      y1: 1,
      line: { width: 1, dash: "dot" },
    });

    annotations.push({
      x: f.I,
      y: 1,
      xref: "x",
      yref: "paper",
      text: `${idx + 1}: ${f.label} (${formatAmps(f.I)})`,
      showarrow: false,
      yanchor: "bottom",
      xanchor: "left",
      font: { size: 11 },
    });
  });

  return { shapes, annotations };
}

function plotAll() {
  const traces = buildTraces();
  const { shapes, annotations } = buildFaultAnnotationsAndShapes();

  const layout = {
    title: "Time–Current Curves (log–log)",
    xaxis: { title: "Current (A)", type: "log", autorange: true },
    yaxis: { title: "Trip time (s)", type: "log", autorange: true },
    legend: { orientation: "h" },
    margin: { l: 70, r: 30, t: 60, b: 60 },
    shapes,
    annotations,
  };

  Plotly.newPlot("plot", traces, layout, { responsive: true });
}

// ---------- Report ----------
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
      const t = b.timeAt(f.I);
      return { name: b.name, tag: b.tag || "", kind: b.kind, t };
    });

    rows.sort((a, b) => a.t - b.t);
    const winner = rows[0];

    const tableRows = rows.map((r, i) => {
      const rank = i + 1;
      const isWinner = i === 0;
      const tag = r.tag ? ` <span class="badge">${r.tag}</span>` : "";
      return `
        <tr>
          <td>${rank}</td>
          <td><strong>${r.name}</strong>${tag}</td>
          <td>${r.kind.toUpperCase()}</td>
          <td>${formatSeconds(r.t)}</td>
          <td>${isWinner ? "Trips first" : ""}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="item">
        <div class="itemHead">
          <strong>${fi + 1}. ${f.label}</strong>
          <span class="badge">${formatAmps(f.I)}</span>
        </div>
        <div class="small">
          Winner: <strong>${winner.name}</strong>${winner.tag ? ` (${winner.tag})` : ""} at ${formatSeconds(winner.t)}
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
          Tip: If an upstream breaker wins at a downstream fault, you likely need more separation (higher Ii, add short-time delay, or validate with selectivity tables).
        </div>
      </div>
    `;
  });

  wrap.innerHTML = sections.join("");
}

// ---------- Rerender ----------
function rerenderAll() {
  renderBreakers();
  renderFaults();
  plotAll();
  buildReportHtml();
}

// Init
toggleBreakerFields();
rerenderAll();