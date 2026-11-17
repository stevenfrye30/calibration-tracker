(() => {
  "use strict";

  const STORAGE_KEY = "calTracker.v1";
  const app = document.getElementById("app");

  const CLASS_OPTIONS = ["I", "II", "III"];

  const METER_TYPE_OPTIONS = ["Liquid", "Mass Flow", "Water"];
  const ACCURACY_CLASS_OPTIONS_BY_METER_TYPE = {
    "Liquid": ["0.3", "0.3A", "0.5", "1.1"],
    "Mass Flow": ["0.3", "0.3A", "0.5", "1.0", "2.0", "2.5"],
    "Water": [],
  };

  const JOB_FIELDS = [
    ["customer", "Customer", "text"],
    ["location", "Location", "text"],
    ["phone", "Phone", "text"],
    ["contact", "Contact", "text"],
    ["email", "Email", "email"],
    ["jobNumber", "Job #", "text"],
    ["date", "Date", "date"],
    ["calibrationSchedule", "Calibration Schedule", "text"],
    ["nextDueBy", "Next Calibration Due By", "date"],
  ];

  const CSV_COLUMNS = [
    ["customer", "Customer"], ["location", "Location"], ["phone", "Phone"],
    ["contact", "Contact"], ["email", "Email"], ["jobNumber", "Job #"], ["date", "Date"],
    ["calibrationSchedule", "Calibration Schedule"], ["nextDueBy", "Next Calibration Due By"],
    ["tripOutStart", "Left For Job"], ["tripArrived", "Arrived On Site"],
    ["tripLeftSite", "Left Site"], ["tripBack", "Back"],
    ["driveThereMin", "Drive There (min)"], ["onSiteMin", "On Site (min)"], ["driveBackMin", "Drive Back (min)"],
    ["milesOut", "Miles There"], ["milesBack", "Miles Back"],
    ["deviceType", "Device Type"],
    ["class", "Class"], ["scaleType", "Scale Type"], ["unitNumber", "Unit #"], ["scaleLocation", "Scale Location"],
    ["makeModel", "Make & Model #"], ["serial", "Serial #"],
    ["capacityByDivision", "Capacity by Division"], ["shiftTest", "Shift Test"],
    ["meterType", "Meter Type"], ["accuracyClass", "Accuracy Class"], ["meterLocation", "Meter Location"],
    ["ratedCapacity", "Rated Capacity / Flow"],
    ["asFoundTest1", "As Found Error Test #1"], ["asFoundTest2", "As Found Error Test #2"],
    ["asFoundTest3", "As Found Error Test #3"], ["adjusted", "Adjusted"],
    ["asLeftTest1", "As Left Test #1"], ["asLeftTest2", "As Left Test #2"],
    ["passFail", "Pass/Fail"], ["note", "Note"],
  ];

  // ---------- storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { jobs: [], settings: { homeAddress: "", mapsApiKey: "" } };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.jobs)) parsed.jobs = [];
      if (!parsed.settings) parsed.settings = { homeAddress: "", mapsApiKey: "" };
      return parsed;
    } catch {
      return { jobs: [], settings: { homeAddress: "", mapsApiKey: "" } };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      toast("Could not save — storage may be full");
    }
  }

  const db = load();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- photo storage (IndexedDB) ----------
  const IMG_DB_NAME = "calTrackerImages";
  const IMG_STORE = "images";
  let imgDBPromise = null;
  function imgDB() {
    if (!imgDBPromise) {
      imgDBPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IMG_DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IMG_STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return imgDBPromise;
  }
  async function saveImageBlob(id, blob) {
    const dbi = await imgDB();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction(IMG_STORE, "readwrite");
      tx.objectStore(IMG_STORE).put({ id, blob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getImageBlob(id) {
    const dbi = await imgDB();
    return new Promise((resolve, reject) => {
      const req = dbi.transaction(IMG_STORE, "readonly").objectStore(IMG_STORE).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }
  async function deleteImageBlob(id) {
    const dbi = await imgDB();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction(IMG_STORE, "readwrite");
      tx.objectStore(IMG_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function compressImage(file, maxDim = 1600, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error("toBlob failed"));
        }, "image/jpeg", quality);
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  let activePhotoURLs = [];
  async function renderPhotoGrid(s) {
    const grid = app.querySelector("[data-photo-grid]");
    if (!grid) return;
    activePhotoURLs.forEach((u) => URL.revokeObjectURL(u));
    activePhotoURLs = [];
    if (!s.images || s.images.length === 0) {
      grid.innerHTML = "";
      return;
    }
    const thumbs = await Promise.all(s.images.map(async (id) => {
      const blob = await getImageBlob(id);
      if (!blob) return "";
      const url = URL.createObjectURL(blob);
      activePhotoURLs.push(url);
      return `<div class="photo-thumb">
        <img src="${url}" data-action="view-photo" data-photo-id="${id}" alt="Scale photo">
        <button type="button" class="photo-del" data-action="delete-photo" data-photo-id="${id}" aria-label="Delete photo">×</button>
      </div>`;
    }));
    if (!grid.isConnected) return;
    grid.innerHTML = thumbs.join("");
  }

  let activeDocURLs = [];
  async function renderDocList(m) {
    const list = app.querySelector("[data-doc-list]");
    if (!list) return;
    activeDocURLs.forEach((u) => URL.revokeObjectURL(u));
    activeDocURLs = [];
    if (!m.docs || m.docs.length === 0) {
      list.innerHTML = "";
      return;
    }
    const rows = await Promise.all(m.docs.map(async (d) => {
      const blob = await getImageBlob(d.id);
      if (!blob) return "";
      const url = URL.createObjectURL(blob);
      activeDocURLs.push(url);
      return `<div class="doc-row">
        <a class="doc-name" href="${url}" target="_blank" rel="noopener">${esc(d.name)}</a>
        <button type="button" class="doc-del" data-action="delete-doc" data-doc-id="${d.id}" aria-label="Delete ${esc(d.name)}">×</button>
      </div>`;
    }));
    if (!list.isConnected) return;
    list.innerHTML = rows.join("");
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function newJob() {
    return {
      id: uid(),
      customer: "", location: "", phone: "", contact: "", email: "",
      jobNumber: "", date: todayISO(), calibrationSchedule: "", nextDueBy: "",
      notes: "", createdAt: Date.now(), updatedAt: Date.now(),
      scales: [], meters: [],
      trip: { outStart: null, outEnd: null, backStart: null, backEnd: null, milesOut: "", milesBack: "" },
    };
  }

  function ensureTrip(job) {
    if (!job.trip) job.trip = { outStart: null, outEnd: null, backStart: null, backEnd: null, milesOut: "", milesBack: "" };
    return job.trip;
  }

  function ensureMeters(job) {
    if (!Array.isArray(job.meters)) job.meters = [];
    return job.meters;
  }

  const SCALE_TYPE_OPTIONS = ["General", "Crane/Hopper"];

  function newScale() {
    return {
      id: uid(), class: "", scaleType: "",
      unitNumber: "", scaleLocation: "", makeModel: "", serial: "", capacityByDivision: "",
      shiftTest: "",
      asFoundTest1: "", asFoundTest2: "", asFoundTest3: "",
      adjusted: "",
      asLeftTest1: "", asLeftTest2: "",
      passFail: "", note: "",
      images: [],
    };
  }

  function newMeter() {
    return {
      id: uid(), meterType: "", accuracyClass: "",
      unitNumber: "", meterLocation: "", makeModel: "", serial: "", ratedCapacity: "",
      asFoundTest1: "", asFoundTest2: "", asFoundTest3: "",
      adjusted: "",
      asLeftTest1: "", asLeftTest2: "",
      passFail: "", note: "",
      images: [],
    };
  }

  function findJob(id) { return db.jobs.find(j => j.id === id); }
  function findScale(job, id) { return job.scales.find(s => s.id === id); }
  function findMeter(job, id) { return ensureMeters(job).find(m => m.id === id); }

  function isScaleEmpty(s) {
    const fields = ["class", "scaleType", "unitNumber", "scaleLocation", "makeModel", "serial",
      "capacityByDivision", "shiftTest", "asFoundTest1", "asFoundTest2", "asFoundTest3",
      "adjusted", "asLeftTest1", "asLeftTest2", "passFail", "note"];
    return fields.every(f => !s[f]) && (!s.images || s.images.length === 0);
  }

  function isMeterEmpty(m) {
    const fields = ["meterType", "accuracyClass", "unitNumber", "meterLocation", "makeModel", "serial",
      "ratedCapacity", "asFoundTest1", "asFoundTest2", "asFoundTest3",
      "adjusted", "asLeftTest1", "asLeftTest2", "passFail", "note"];
    return fields.every(f => !m[f]) && (!m.images || m.images.length === 0);
  }

  // ---------- routing ----------
  let route = history.state || { view: "home" };

  function navigate(view, params = {}, replace = false) {
    route = { view, ...params };
    if (replace) history.replaceState(route, "", "#" + view);
    else history.pushState(route, "", "#" + view);
    render();
  }

  window.addEventListener("popstate", (e) => {
    route = e.state || { view: "home" };
    render();
  });

  // ---------- helpers ----------
  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function jobToRows(job) {
    const base = {};
    JOB_FIELDS.forEach(([key]) => { base[key] = job[key]; });
    const t = ensureTrip(job);
    base.tripOutStart = t.outStart ? new Date(t.outStart).toLocaleString() : "";
    base.tripArrived = t.outEnd ? new Date(t.outEnd).toLocaleString() : "";
    base.tripLeftSite = t.backStart ? new Date(t.backStart).toLocaleString() : "";
    base.tripBack = t.backEnd ? new Date(t.backEnd).toLocaleString() : "";
    base.driveThereMin = (t.outStart && t.outEnd) ? Math.round((t.outEnd - t.outStart) / 60000) : "";
    base.onSiteMin = (t.outEnd && t.backStart) ? Math.round((t.backStart - t.outEnd) / 60000) : "";
    base.driveBackMin = (t.backStart && t.backEnd) ? Math.round((t.backEnd - t.backStart) / 60000) : "";
    base.milesOut = t.milesOut || "";
    base.milesBack = t.milesBack || "";
    const scaleRows = job.scales.map(s => ({ ...base, deviceType: "Scale", ...s }));
    const meterRows = ensureMeters(job).map(m => ({ ...base, deviceType: m.meterType ? `${m.meterType} Meter` : "Meter", ...m }));
    const rows = [...scaleRows, ...meterRows];
    return rows.length === 0 ? [base] : rows;
  }

  function rowsToCSV(rows) {
    const header = CSV_COLUMNS.map(c => c[1]).join(",");
    const lines = rows.map(row => CSV_COLUMNS.map(c => csvEscape(row[c[0]])).join(","));
    return [header, ...lines].join("\r\n");
  }

  function downloadCSV(filename, content) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("CSV downloaded");
  }

  async function shareCSV(filename, content) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    try {
      const file = new File([blob], filename, { type: "text/csv" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    downloadCSV(filename, content);
  }

  function safeName(s) {
    return String(s || "").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    if (!y) return iso;
    return `${m}/${d}/${y}`;
  }

  function toDatetimeLocal(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocal(str) {
    if (!str) return null;
    const t = new Date(str).getTime();
    return Number.isNaN(t) ? null : t;
  }

  function fmtDuration(ms) {
    if (ms == null || ms < 0) return "";
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h === 0 ? `${m} min` : `${h}h ${m}m`;
  }

  // ---------- rendering ----------
  function render() {
    if (route.view === "job" && !findJob(route.jobId)) route = { view: "home" };
    if (route.view === "scaleForm") {
      const job = findJob(route.jobId);
      if (!job || !findScale(job, route.scaleId)) route = { view: "home" };
    }
    if (route.view === "meterForm") {
      const job = findJob(route.jobId);
      if (!job || !findMeter(job, route.meterId)) route = { view: "home" };
    }

    if (route.view === "home") return renderHome();
    if (route.view === "job") return renderJobScreen(route.jobId);
    if (route.view === "scaleForm") return renderScaleForm(route.jobId, route.scaleId);
    if (route.view === "meterForm") return renderMeterForm(route.jobId, route.meterId);
    if (route.view === "reference") return renderReference();
    if (route.view === "settings") return renderSettings();
    renderHome();
  }

  function topbar({ title, sub, back, rightIcon, rightLabel, onRight, right2Icon, right2Label, onRight2 }) {
    return `
      <div class="topbar">
        ${back ? `<button class="icon-btn" data-action="back" aria-label="Back">‹</button>` : ""}
        <h1>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</h1>
        ${right2Icon ? `<button class="icon-btn" data-action="${onRight2}" aria-label="${esc(right2Label || "")}">${right2Icon}</button>` : ""}
        ${rightIcon ? `<button class="icon-btn" data-action="${onRight}" aria-label="${esc(rightLabel || "")}">${rightIcon}</button>` : ""}
      </div>`;
  }

  function renderHome() {
    const jobs = [...db.jobs].sort((a, b) => b.updatedAt - a.updatedAt);
    app.innerHTML = `
      ${topbar({ title: "Calibration Jobs", right2Icon: "⚙", right2Label: "Settings", onRight2: "open-settings", rightIcon: "📏", rightLabel: "Reference", onRight: "open-reference" })}
      <div class="screen">
        ${jobs.length === 0 ? `
          <div class="empty-state">
            <span class="big">🧾</span>
            No jobs yet.<br>Tap "New Job" to start recording.
          </div>` : `
          <div class="card-list">
            ${jobs.map(j => `
              <button class="card job-card" data-action="open-job" data-job="${j.id}">
                <div class="title">${esc(j.customer || "Untitled Job")}</div>
                <div class="meta">
                  ${j.jobNumber ? `<span>Job #${esc(j.jobNumber)}</span>` : ""}
                  <span>${esc(fmtDate(j.date)) || "No date"}</span>
                  <span>${j.scales.length} scale${j.scales.length === 1 ? "" : "s"}</span>
                </div>
              </button>`).join("")}
          </div>`}
      </div>
      <div class="action-bar"><div class="action-bar-inner">
        ${jobs.length > 0 ? `<button class="btn" data-action="export-all">Export All (CSV)</button>` : ""}
        <button class="btn btn-primary" data-action="new-job">+ New Job</button>
      </div></div>
    `;
  }

  function fieldHTML(value, key, label, type) {
    if (type === "date") {
      return `<div class="field"><label>${esc(label)}</label>
        <input type="date" value="${esc(value)}" data-field="${key}"></div>`;
    }
    if (type === "email") {
      return `<div class="field"><label>${esc(label)}</label>
        <input type="email" inputmode="email" value="${esc(value)}" data-field="${key}" autocomplete="off"></div>`;
    }
    return `<div class="field"><label>${esc(label)}</label>
      <input type="text" value="${esc(value)}" data-field="${key}" autocomplete="off"></div>`;
  }

  function renderJobScreen(jobId) {
    const job = findJob(jobId);
    const byClass = CLASS_OPTIONS.map(c => [c, job.scales.filter(s => s.class === c)]);
    const unclassified = job.scales.filter(s => !CLASS_OPTIONS.includes(s.class));
    const meters = ensureMeters(job);

    function scaleCard(s) {
      const title = [s.unitNumber, s.makeModel].filter(Boolean).join(" · ") || "Scale";
      const meta = [s.serial ? `SN ${s.serial}` : "", s.capacityByDivision].filter(Boolean).join(" · ");
      const badge = s.passFail === "Pass" ? `<span class="badge pass">PASS</span>`
        : s.passFail === "Fail" ? `<span class="badge fail">FAIL</span>`
        : `<span class="badge neutral">—</span>`;
      return `
        <button class="card scale-card" data-action="open-scale" data-job="${job.id}" data-scale="${s.id}">
          <div class="info">
            <div class="title">${esc(title)}</div>
            <div class="meta">${esc(meta)}</div>
          </div>
          ${badge}
        </button>`;
    }

    function meterCard(m) {
      const title = [m.unitNumber, m.makeModel].filter(Boolean).join(" · ") || "Meter";
      const meta = [m.meterType, m.accuracyClass ? `Class ${m.accuracyClass}` : "", m.serial ? `SN ${m.serial}` : ""].filter(Boolean).join(" · ");
      const badge = m.passFail === "Pass" ? `<span class="badge pass">PASS</span>`
        : m.passFail === "Fail" ? `<span class="badge fail">FAIL</span>`
        : `<span class="badge neutral">—</span>`;
      return `
        <button class="card scale-card" data-action="open-meter" data-job="${job.id}" data-meter="${m.id}">
          <div class="info">
            <div class="title">${esc(title)}</div>
            <div class="meta">${esc(meta)}</div>
          </div>
          ${badge}
        </button>`;
    }

    function section(label, list) {
      if (list.length === 0) return "";
      return `<div class="section-heading">${esc(label)}</div><div class="card-list">${list.map(scaleCard).join("")}</div>`;
    }

    app.innerHTML = `
      ${topbar({ title: job.customer || "New Job", sub: [job.jobNumber ? "Job #" + job.jobNumber : "", fmtDate(job.date)].filter(Boolean).join(" · "), back: true, right2Icon: "🖨", right2Label: "Print", onRight2: "print-job", rightIcon: "🗑", rightLabel: "Delete job", onRight: "delete-job" })}
      <div class="screen">
        <div class="card">
          ${JOB_FIELDS.map(([k, label, type]) => fieldHTML(job[k], k, label, type)).join("")}
        </div>

        ${tripSectionHTML(job)}

        ${byClass.map(([c, list]) => section(`Class ${c} Scales`, list)).join("")}
        ${section("Unclassified", unclassified)}
        ${job.scales.length === 0 ? `<div class="empty-state">No scales added yet.</div>` : ""}

        ${meters.length > 0 ? `<div class="section-heading">Meters</div><div class="card-list">${meters.map(meterCard).join("")}</div>` : ""}

        <div class="field" style="margin-top:22px">
          <label>Notes</label>
          <textarea data-field="notes" rows="3">${esc(job.notes)}</textarea>
        </div>
      </div>
      <div class="action-bar"><div class="action-bar-inner">
        <button class="btn" data-action="export-job" data-job="${job.id}">Download CSV</button>
        <button class="btn btn-icon-square" data-action="share-job" data-job="${job.id}" aria-label="Share CSV">↗</button>
        <button class="btn" data-action="add-meter" data-job="${job.id}">+ Add Meter</button>
        <button class="btn btn-primary" data-action="add-scale" data-job="${job.id}">+ Add Scale</button>
      </div></div>
    `;

    app.querySelectorAll("[data-field]").forEach(el => {
      el.addEventListener("input", () => {
        job[el.dataset.field] = el.value;
        job.updatedAt = Date.now();
        save();
      });
    });

    app.querySelectorAll("[data-trip-field]").forEach(el => {
      el.addEventListener("input", () => {
        const t = ensureTrip(job);
        const key = el.dataset.tripField;
        t[key] = el.type === "datetime-local" ? fromDatetimeLocal(el.value) : el.value;
        job.updatedAt = Date.now();
        save();
        if (el.type === "datetime-local") refreshTripUI(job);
      });
    });
  }

  function segHTML(field, options, current) {
    return `<div class="seg" data-seg="${field}">
      ${options.map(o => `<button type="button" data-val="${esc(o)}" class="${current === o ? "active" : ""}">${esc(o)}</button>`).join("")}
    </div>`;
  }

  function numericField(key, label, value, opts = {}) {
    const mode = opts.decimal ? "decimal" : "numeric";
    const placeholder = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : "";
    return `<div class="field"><label>${esc(label)}</label>
      <div class="field-inline">
        <input type="text" inputmode="${mode}" data-field="${key}" data-numeric-mode="${mode}"${placeholder} value="${esc(value)}">
        <button type="button" class="kbd-toggle" data-kbd-toggle="${key}" aria-label="Toggle letters">ABC</button>
      </div>
    </div>`;
  }

  function atField(key, label, value) {
    return `<div class="field"><label>${esc(label)}</label>
      <div class="field-inline">
        <input type="text" inputmode="decimal" data-field="${key}" value="${esc(value)}">
        <button type="button" class="at-btn" data-at-insert="${key}" aria-label="Insert @">@</button>
      </div>
    </div>`;
  }

  const TRIP_STAMPS = [
    ["outStart", "Start driving", "🚗"],
    ["outEnd", "Arrived on site", "📍"],
    ["backStart", "Leaving site", "🚪"],
    ["backEnd", "Back / done driving", "🏠"],
  ];

  function tripLegs(t) {
    const legs = [];
    if (t.outStart && t.outEnd) legs.push(`Drove ${fmtDuration(t.outEnd - t.outStart)} to site`);
    if (t.outEnd && t.backStart) legs.push(`On site ${fmtDuration(t.backStart - t.outEnd)}`);
    if (t.backStart && t.backEnd) legs.push(`Drove ${fmtDuration(t.backEnd - t.backStart)} back`);
    return legs;
  }

  function mileageFieldHTML(key, label, value, canEstimate) {
    return `<div class="field"><label>${esc(label)}</label>
      <div class="field-inline">
        <input type="text" inputmode="decimal" data-trip-field="${key}" value="${esc(value)}">
        ${canEstimate ? `<button type="button" data-action="estimate-miles" data-trip="${key}" aria-label="Estimate via Maps">Est.</button>` : ""}
      </div>
    </div>`;
  }

  function tripSectionHTML(job) {
    const t = ensureTrip(job);
    const rows = TRIP_STAMPS.map(([key, label, icon]) => `
      <div class="trip-row" data-trip-row="${key}">
        <button type="button" class="trip-now" data-action="trip-now" data-trip="${key}" aria-label="${esc(label)} now">${icon}</button>
        <div class="trip-row-main">
          <label>${esc(label)}</label>
          <input type="datetime-local" data-trip-field="${key}" value="${toDatetimeLocal(t[key])}">
        </div>
        <button type="button" class="trip-clear ${t[key] ? "" : "is-hidden"}" data-action="trip-clear" data-trip="${key}" aria-label="Clear ${esc(label)}">×</button>
      </div>`).join("");

    const legs = tripLegs(t);
    const canEstimate = !!(db.settings.homeAddress && db.settings.mapsApiKey && job.location);

    return `
      <fieldset>
        <legend>Trip</legend>
        <div class="trip-stamps">${rows}</div>
        <div class="trip-summary${legs.length ? "" : " is-hidden"}">${esc(legs.join(" · "))}</div>
        <div class="field-row" style="margin-top:14px">
          ${mileageFieldHTML("milesOut", "Miles there", t.milesOut, canEstimate)}
          ${mileageFieldHTML("milesBack", "Miles back", t.milesBack, canEstimate)}
        </div>
        ${!canEstimate ? `<p class="hint">Set a home base address and Google Maps API key in Settings to auto-estimate miles — or just type them in.</p>` : ""}
      </fieldset>`;
  }

  function refreshTripUI(job) {
    const t = ensureTrip(job);
    TRIP_STAMPS.forEach(([key]) => {
      const row = app.querySelector(`[data-trip-row="${key}"]`);
      if (!row) return;
      const input = row.querySelector("input[data-trip-field]");
      if (input) input.value = toDatetimeLocal(t[key]);
      const clearBtn = row.querySelector(".trip-clear");
      if (clearBtn) clearBtn.classList.toggle("is-hidden", !t[key]);
    });
    const summaryEl = app.querySelector(".trip-summary");
    if (summaryEl) {
      const legs = tripLegs(t);
      summaryEl.textContent = legs.join(" · ");
      summaryEl.classList.toggle("is-hidden", legs.length === 0);
    }
  }

  let mapsScriptPromise = null;
  function loadMapsScript(apiKey) {
    if (window.google && window.google.maps && window.google.maps.DistanceMatrixService) {
      return Promise.resolve();
    }
    if (mapsScriptPromise) return mapsScriptPromise;
    mapsScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { mapsScriptPromise = null; reject(new Error("maps-load-failed")); };
      document.head.appendChild(script);
    });
    return mapsScriptPromise;
  }

  function distanceMiles(origin, destination) {
    return new Promise((resolve, reject) => {
      const service = new google.maps.DistanceMatrixService();
      service.getDistanceMatrix({
        origins: [origin],
        destinations: [destination],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
      }, (response, status) => {
        if (status !== "OK") return reject(new Error(status));
        const el = response && response.rows && response.rows[0] && response.rows[0].elements && response.rows[0].elements[0];
        if (!el || el.status !== "OK") return reject(new Error((el && el.status) || "NO_ROUTE"));
        resolve(Math.round((el.distance.value / 1609.344) * 10) / 10);
      });
    });
  }

  async function estimateMiles(job, legKey, btn) {
    if (!job) return;
    if (!db.settings.homeAddress || !db.settings.mapsApiKey) {
      toast("Set a home address and Maps API key in Settings first");
      return;
    }
    if (!job.location) {
      toast("Add a job Location first");
      return;
    }
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    try {
      await loadMapsScript(db.settings.mapsApiKey);
      const origin = legKey === "milesOut" ? db.settings.homeAddress : job.location;
      const destination = legKey === "milesOut" ? job.location : db.settings.homeAddress;
      const miles = await Promise.race([
        distanceMiles(origin, destination),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]);
      const t = ensureTrip(job);
      t[legKey] = String(miles);
      job.updatedAt = Date.now();
      save();
      const input = app.querySelector(`input[data-trip-field="${legKey}"]`);
      if (input) input.value = String(miles);
      toast(`Estimated ${miles} mi`);
    } catch {
      toast("Couldn't estimate miles — check connection and API key");
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  }

  function renderScaleForm(jobId, scaleId) {
    const job = findJob(jobId);
    const s = findScale(job, scaleId);

    app.innerHTML = `
      ${topbar({ title: "Scale Details", back: true, rightIcon: "🗑", rightLabel: "Delete scale", onRight: "delete-scale" })}
      <div class="screen">
        <fieldset>
          <legend>Identification</legend>
          <div class="field"><label>Unit #</label><input type="text" data-field="unitNumber" value="${esc(s.unitNumber)}"></div>
          ${numericField("serial", "Serial #", s.serial)}
          <div class="field"><label>Scale Location</label><input type="text" data-field="scaleLocation" value="${esc(s.scaleLocation)}"></div>
          <div class="field"><label>Class</label>${segHTML("class", CLASS_OPTIONS, s.class)}</div>
          <div class="field"><label>Type</label>${segHTML("scaleType", SCALE_TYPE_OPTIONS, s.scaleType)}</div>
          <div class="field"><label>Make &amp; Model #</label><input type="text" data-field="makeModel" value="${esc(s.makeModel)}"></div>
          ${numericField("capacityByDivision", "Capacity by Division", s.capacityByDivision, { decimal: true, placeholder: "e.g. 500 lb x 0.1 lb" })}
          <div class="field">
            <label>Photos</label>
            <div class="photo-grid" data-photo-grid></div>
            <button type="button" class="btn" data-action="add-photo">+ Add Photo</button>
            <input type="file" accept="image/*" multiple data-photo-input style="display:none">
          </div>
        </fieldset>

        <fieldset>
          <legend>Handbook 44 Tolerance</legend>
          <div data-tolerance-box>${toleranceBoxHTML(s)}</div>
        </fieldset>

        <fieldset>
          <legend>Shift Test</legend>
          <div class="field">${segHTML("shiftTest", ["Pass", "Fail"], s.shiftTest)}</div>
        </fieldset>

        <fieldset>
          <legend>As Found Error @ Weight</legend>
          <div class="field-row3">
            ${atField("asFoundTest1", "Test #1", s.asFoundTest1)}
            ${atField("asFoundTest2", "Test #2", s.asFoundTest2)}
            ${atField("asFoundTest3", "Test #3", s.asFoundTest3)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Adjusted</legend>
          <div class="field">${segHTML("adjusted", ["Yes", "No"], s.adjusted)}</div>
        </fieldset>

        <fieldset>
          <legend>As Left</legend>
          <div class="field-row">
            ${atField("asLeftTest1", "Test #1", s.asLeftTest1)}
            ${atField("asLeftTest2", "Test #2", s.asLeftTest2)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Result</legend>
          <div class="field">${segHTML("passFail", ["Pass", "Fail"], s.passFail)}</div>
        </fieldset>

        <div class="field"><label>Note</label><textarea data-field="note" rows="2">${esc(s.note)}</textarea></div>
      </div>
      <div class="action-bar"><div class="action-bar-inner">
        <button class="btn btn-primary" data-action="done-scale">Done</button>
      </div></div>
    `;

    app.querySelectorAll("[data-field]").forEach(el => {
      el.addEventListener("input", () => {
        s[el.dataset.field] = el.value;
        job.updatedAt = Date.now();
        save();
      });
    });

    app.querySelectorAll("[data-seg]").forEach(group => {
      const field = group.dataset.seg;
      group.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          s[field] = btn.dataset.val;
          job.updatedAt = Date.now();
          save();
          group.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
          if (field === "class" || field === "scaleType") {
            const box = app.querySelector("[data-tolerance-box]");
            if (box) box.innerHTML = toleranceBoxHTML(s);
          }
        });
      });
    });

    app.querySelectorAll("[data-kbd-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = app.querySelector(`input[data-field="${btn.dataset.kbdToggle}"]`);
        const numericMode = input.dataset.numericMode;
        const letters = input.inputMode === "text";
        input.inputMode = letters ? numericMode : "text";
        btn.classList.toggle("active", !letters);
        input.focus();
      });
    });

    app.querySelectorAll("[data-at-insert]").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = app.querySelector(`input[data-field="${btn.dataset.atInsert}"]`);
        const pos = input.selectionStart ?? input.value.length;
        input.focus();
        input.setRangeText("@", pos, input.selectionEnd ?? pos, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    app.querySelectorAll("[data-photo-input]").forEach(input => {
      input.addEventListener("change", async () => {
        const files = [...input.files];
        input.value = "";
        if (files.length === 0) return;
        for (const file of files) {
          try {
            const blob = await compressImage(file);
            const id = uid();
            await saveImageBlob(id, blob);
            s.images = s.images || [];
            s.images.push(id);
          } catch {
            toast("Couldn't add a photo");
          }
        }
        job.updatedAt = Date.now();
        save();
        renderPhotoGrid(s);
      });
    });

    renderPhotoGrid(s);
  }

  function renderMeterForm(jobId, meterId) {
    const job = findJob(jobId);
    const m = findMeter(job, meterId);
    const classOptions = m.meterType ? (ACCURACY_CLASS_OPTIONS_BY_METER_TYPE[m.meterType] || []) : [];

    app.innerHTML = `
      ${topbar({ title: "Meter Details", back: true, rightIcon: "🗑", rightLabel: "Delete meter", onRight: "delete-meter" })}
      <div class="screen">
        <fieldset>
          <legend>Identification</legend>
          <div class="field"><label>Unit #</label><input type="text" data-field="unitNumber" value="${esc(m.unitNumber)}"></div>
          ${numericField("serial", "Serial #", m.serial)}
          <div class="field"><label>Meter Location</label><input type="text" data-field="meterLocation" value="${esc(m.meterLocation)}"></div>
          <div class="field"><label>Meter Type</label>${segHTML("meterType", METER_TYPE_OPTIONS, m.meterType)}</div>
          ${classOptions.length > 0 ? `<div class="field"><label>Accuracy Class</label>${segHTML("accuracyClass", classOptions, m.accuracyClass)}</div>` : ""}
          <div class="field"><label>Make &amp; Model #</label><input type="text" data-field="makeModel" value="${esc(m.makeModel)}"></div>
          ${numericField("ratedCapacity", "Rated Capacity / Flow", m.ratedCapacity, { decimal: true, placeholder: "e.g. 30 gpm max" })}
          <div class="field">
            <label>Photos</label>
            <div class="photo-grid" data-photo-grid></div>
            <button type="button" class="btn" data-action="add-photo">+ Add Photo</button>
            <input type="file" accept="image/*" multiple data-photo-input style="display:none">
          </div>
          <div class="field">
            <label>Documents</label>
            <div class="doc-list" data-doc-list></div>
            <button type="button" class="btn" data-action="add-document">+ Add Document</button>
            <input type="file" accept="application/pdf,.doc,.docx,image/*" multiple data-doc-input style="display:none">
          </div>
        </fieldset>

        <fieldset>
          <legend>Handbook 44 Tolerance</legend>
          <div data-tolerance-box>${meterToleranceBoxHTML(m)}</div>
        </fieldset>

        <fieldset>
          <legend>As Found Error @ Test Draft</legend>
          <div class="field-row3">
            ${atField("asFoundTest1", "Test #1", m.asFoundTest1)}
            ${atField("asFoundTest2", "Test #2", m.asFoundTest2)}
            ${atField("asFoundTest3", "Test #3", m.asFoundTest3)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Adjusted</legend>
          <div class="field">${segHTML("adjusted", ["Yes", "No"], m.adjusted)}</div>
        </fieldset>

        <fieldset>
          <legend>As Left</legend>
          <div class="field-row">
            ${atField("asLeftTest1", "Test #1", m.asLeftTest1)}
            ${atField("asLeftTest2", "Test #2", m.asLeftTest2)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Result</legend>
          <div class="field">${segHTML("passFail", ["Pass", "Fail"], m.passFail)}</div>
        </fieldset>

        <div class="field"><label>Note</label><textarea data-field="note" rows="2">${esc(m.note)}</textarea></div>
      </div>
      <div class="action-bar"><div class="action-bar-inner">
        <button class="btn btn-primary" data-action="done-meter">Done</button>
      </div></div>
    `;

    app.querySelectorAll("[data-field]").forEach(el => {
      el.addEventListener("input", () => {
        m[el.dataset.field] = el.value;
        job.updatedAt = Date.now();
        save();
      });
    });

    app.querySelectorAll("[data-seg]").forEach(group => {
      const field = group.dataset.seg;
      group.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          m[field] = btn.dataset.val;
          if (field === "meterType") {
            m.accuracyClass = (btn.dataset.val === "Water") ? "1.5" : "";
          }
          job.updatedAt = Date.now();
          save();
          if (field === "meterType") {
            renderMeterForm(job.id, m.id);
            return;
          }
          group.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
          if (field === "accuracyClass") {
            const box = app.querySelector("[data-tolerance-box]");
            if (box) box.innerHTML = meterToleranceBoxHTML(m);
          }
        });
      });
    });

    app.querySelectorAll("[data-kbd-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = app.querySelector(`input[data-field="${btn.dataset.kbdToggle}"]`);
        const numericMode = input.dataset.numericMode;
        const letters = input.inputMode === "text";
        input.inputMode = letters ? numericMode : "text";
        btn.classList.toggle("active", !letters);
        input.focus();
      });
    });

    app.querySelectorAll("[data-at-insert]").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = app.querySelector(`input[data-field="${btn.dataset.atInsert}"]`);
        const pos = input.selectionStart ?? input.value.length;
        input.focus();
        input.setRangeText("@", pos, input.selectionEnd ?? pos, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    app.querySelectorAll("[data-photo-input]").forEach(input => {
      input.addEventListener("change", async () => {
        const files = [...input.files];
        input.value = "";
        if (files.length === 0) return;
        for (const file of files) {
          try {
            const blob = await compressImage(file);
            const id = uid();
            await saveImageBlob(id, blob);
            m.images = m.images || [];
            m.images.push(id);
          } catch {
            toast("Couldn't add a photo");
          }
        }
        job.updatedAt = Date.now();
        save();
        renderPhotoGrid(m);
      });
    });

    app.querySelectorAll("[data-doc-input]").forEach(input => {
      input.addEventListener("change", async () => {
        const files = [...input.files];
        input.value = "";
        if (files.length === 0) return;
        for (const file of files) {
          try {
            const id = uid();
            await saveImageBlob(id, file);
            m.docs = m.docs || [];
            m.docs.push({ id, name: file.name, type: file.type });
          } catch {
            toast("Couldn't add a document");
          }
        }
        job.updatedAt = Date.now();
        save();
        renderDocList(m);
      });
    });

    renderPhotoGrid(m);
    renderDocList(m);
  }

  // Verbatim text below is quoted directly from NIST Handbook 44 (2026 Ed.), a U.S.
  // federal government publication (17 U.S.C. §105 — not subject to copyright).
  // Source: Section 2.20 Scales — S.1.2.2.1, S.1.2.2.2, T.N.3.1, T.N.3.2, Table 6.
  // Maintenance Tolerances. All tolerance values are in multiples of the verification
  // scale interval "e" (for Class III, e = d, the scale division marked on the device,
  // e.g. the "0.1 lb" in "500 lb x 0.1 lb").
  // Note: the official 2026 PDF's Table 6 prints the 4th Class III/IIII tolerance-tier
  // column header as "5" (should read "4" — 1-2-3-4 is the table's own numbering
  // pattern, confirmed against the rendered PDF page); treated here as a publication
  // typo in NIST's document and corrected to 4e.
  const TOLERANCE_TABLE = {
    I: { quote: `S.1.2.2.1. "The value of 'e' shall be greater than 'd' and less than or equal to 10 'd' (d < e ≤ 10 d)... The requirement in subpart (a) does not apply to a Class I device with e = 1 mg, where d shall be less than 'e' (d < e)."`,
      rows: [
        ["0 – 50,000 e", "1e", "0.5e"],
        ["50,001 – 200,000 e", "2e", "1e"],
        ["200,001+ e", "3e", "1.5e"],
      ] },
    II: { quote: `S.1.2.2.1. "The value of 'e' shall be greater than 'd' and less than or equal to 10 'd' (d < e ≤ 10 d)."`,
      rows: [
        ["0 – 5,000 e", "1e", "0.5e"],
        ["5,001 – 20,000 e", "2e", "1e"],
        ["20,001+ e", "3e", "1.5e"],
      ] },
    III: { quote: `S.1.2.2.2. "The value of 'e' is specified by the manufacturer as marked on the device. Except for dynamic monorail scales, 'e' must be equal to 'd'."`,
      rows: [
        ["0 – 500 e", "1e", "0.5e"],
        ["501 – 2,000 e", "2e", "1e"],
        ["2,001 – 4,000 e", "3e", "1.5e"],
        ["4,001+ e", "4e", "2e"],
      ] },
    // T.N.3.4: crane/hopper scales use the Class III L row of Table 6 instead of the
    // Class III row, regardless of the device's own marked class, plus a tolerance
    // floor. The "1,001+" acceptance figure is derived (T.N.3.2: half of maintenance)
    // — Table 6 itself only spells out the maintenance-side formula verbatim.
    "III_CRANE_HOPPER": { quote: `T.N.3.4. "The maintenance and acceptance tolerances shall be as specified in T.N.3.1. Maintenance Tolerance Values and T.N.3.2. Acceptance Tolerance Values for Class III L, except that the tolerance for crane and construction materials hopper scales shall not be less than 1 e or 0.1% of the scale capacity, whichever is less."`,
      rows: [
        ["0 – 500 e", "1e", "0.5e"],
        ["501 – 1,000 e", "2e", "1e"],
        ["1,001+ e", "+1e per additional 500e (or fraction)", "+0.5e per additional 500e (or fraction, derived)"],
      ],
      floor: "Floor: tolerance not less than 1e or 0.1% of scale capacity, whichever is less." },
  };

  function toleranceEntryFor(s) {
    if (!s.class) return null;
    if (s.class === "III" && s.scaleType === "Crane/Hopper") return TOLERANCE_TABLE["III_CRANE_HOPPER"];
    return TOLERANCE_TABLE[s.class] || null;
  }

  function toleranceBoxHTML(s) {
    const t = toleranceEntryFor(s);
    if (!t) {
      return `<p class="hint" style="margin-top:0">Select a Class above to see the applicable Handbook 44 tolerance.</p>`;
    }
    return `
      <p class="hint" style="margin-top:0">${esc(t.quote)}</p>
      <table class="ref-table">
        <tr><th>Test load</th><th>Maintenance</th><th>Acceptance</th></tr>
        ${t.rows.map(([range, maint, acc]) => `<tr><td>${esc(range)}</td><td>${esc(maint)}</td><td>${esc(acc)}</td></tr>`).join("")}
      </table>
      ${t.floor ? `<p class="hint">${esc(t.floor)}</p>` : ""}
      <a class="btn" href="handbook/section-2.20-scales.pdf#page=44" target="_blank" rel="noopener" style="margin-top:8px">Open Table 6 in Handbook (PDF)</a>`;
  }

  // Verbatim-sourced, same basis as TOLERANCE_TABLE above. Flow meters don't use
  // I/II/III accuracy classes — each device type has its own class scheme and the
  // tolerance is a flat percentage of the test draft, not a multiple of e.
  // Source: Sec. 3.30 Liquid-Measuring Devices T.2 (Table T.2); Sec. 3.37 Mass Flow
  // Meters T.2 (Table T.2); Sec. 3.36 Water Meters T.1 (Table T.1). All three tables
  // were checked against the rendered PDF page (no transcription typos found, unlike
  // Table 6 in Scales).
  const METER_TOLERANCE_TABLE = {
    "Liquid": {
      "0.3": { app: "Large capacity (>115 L/min or 30 gpm) devices incl. motor-fuel; heated products (other than asphalt) >50°C (122°F); asphalt ≤50°C; other liquids not shown where typical delivery is over 200 L (50 gal)", acceptance: "0.2%", maintenance: "0.3%", special: "0.5%" },
      "0.3A": { app: "Asphalt at temperatures greater than 50°C (122°F)", acceptance: "0.3%", maintenance: "0.3%", special: "0.5%" },
      "0.5": { app: "Small capacity (4–115 L/min or 1–30 gpm) motor-fuel devices; agri-chemical liquids; other applications not shown where typical delivery is ≤200 L (50 gal)", acceptance: "0.3%", maintenance: "0.5%", special: "0.5%",
        note: "* For test drafts ≤40 L or 10 gal: maintenance tolerance = 20 mL + 4 mL per indicated liter (or 1 in³ + 1 in³ per indicated gallon); acceptance = half of that." },
      "1.1": { app: "Petroleum products and other normal liquids from devices with flow rates less than 1 gpm; devices designed to deliver less than 1 gal", acceptance: "0.75%", maintenance: "1.0%", special: "1.25%" },
    },
    "Mass Flow": {
      "0.3": { app: "Large capacity motor-fuel dispensers (>100 L/min or 25 gpm); heated products (other than asphalt) >50°C; asphalt ≤50°C; loading rack meters; vehicle-tank meters; home heating oil; milk & other food products; other liquids where minimum delivery is ≥700 kg (1,500 lb)", acceptance: "0.2%", maintenance: "0.3%", special: "0.5%" },
      "0.3A": { app: "Asphalt at temperatures greater than 50°C (122°F)", acceptance: "0.3%", maintenance: "0.3%", special: "0.5%" },
      "0.5": { app: "Small capacity (retail) motor-fuel dispensers; agri-chemical liquids; other liquids where minimum delivery is less than 700 kg (1,500 lb)", acceptance: "0.3%", maintenance: "0.5%", special: "0.5%" },
      "1.0": { app: "Anhydrous ammonia; LP Gas (including vehicle-tank meters)", acceptance: "0.6%", maintenance: "1.0%", special: "1.0%" },
      "2.0": { app: "Compressed natural gas as a motor-fuel; other hydrocarbon gases and hydrocarbon gas/air mix applications", acceptance: "1.5%", maintenance: "2.0%", special: "2.0%" },
      "2.5": { app: "Cryogenic liquid meters; liquefied compressed gases other than LP Gas", acceptance: "1.5%", maintenance: "2.5%", special: "2.5%" },
    },
  };

  const WATER_METER_TABLE = {
    quote: `T.1. "Maintenance and acceptance tolerances shall be as shown in Table T.1. Accuracy Classes and Tolerances for Water Meters." (Single Accuracy Class: 1.5)`,
    rows: [
      ["Other than Multi-Jet", "Overregistration", "1.5%", "1.5%", "1.5%"],
      ["Other than Multi-Jet", "Underregistration", "1.5%", "1.5%", "5.0%"],
      ["Multi-Jet", "Overregistration", "1.5%", "1.5%", "3.0%"],
      ["Multi-Jet", "Underregistration", "1.5%", "1.5%", "3.0%"],
    ],
  };

  const METER_PDF = {
    "Liquid": { href: "handbook/section-3.30-liquid-measuring-devices.pdf#page=21", label: "Open Sec. 3.30 Liquid-Measuring Devices (PDF)" },
    "Mass Flow": { href: "handbook/section-3.37-mass-flow-meters.pdf#page=13", label: "Open Sec. 3.37 Mass Flow Meters (PDF)" },
    "Water": { href: "handbook/section-3.36-water-meters.pdf#page=8", label: "Open Sec. 3.36 Water Meters (PDF)" },
  };

  function meterToleranceBoxHTML(m) {
    if (!m.meterType) {
      return `<p class="hint" style="margin-top:0">Select a Meter Type above to see the applicable Handbook 44 tolerance.</p>`;
    }
    const pdf = METER_PDF[m.meterType];
    if (m.meterType === "Water") {
      return `
        <p class="hint" style="margin-top:0">${esc(WATER_METER_TABLE.quote)}</p>
        <table class="ref-table">
          <tr><th>Style</th><th>Direction</th><th>Acceptance</th><th>Maintenance</th><th>Special (min. flow)</th></tr>
          ${WATER_METER_TABLE.rows.map(([style, dir, acc, maint, spec]) => `<tr><td>${esc(style)}</td><td>${esc(dir)}</td><td>${esc(acc)}</td><td>${esc(maint)}</td><td>${esc(spec)}</td></tr>`).join("")}
        </table>
        <a class="btn" href="${pdf.href}" target="_blank" rel="noopener" style="margin-top:8px">${esc(pdf.label)}</a>`;
    }
    const entry = (METER_TOLERANCE_TABLE[m.meterType] || {})[m.accuracyClass];
    if (!entry) {
      return `<p class="hint" style="margin-top:0">Select an Accuracy Class above to see the applicable tolerance.</p>`;
    }
    return `
      <p class="hint" style="margin-top:0">${esc(entry.app)}</p>
      <table class="ref-table">
        <tr><th>Acceptance</th><th>Maintenance</th><th>Special Test</th></tr>
        <tr><td>${esc(entry.acceptance)}</td><td>${esc(entry.maintenance)}</td><td>${esc(entry.special)}</td></tr>
      </table>
      ${entry.note ? `<p class="hint">${esc(entry.note)}</p>` : ""}
      <a class="btn" href="${pdf.href}" target="_blank" rel="noopener" style="margin-top:8px">${esc(pdf.label)}</a>`;
  }

  function tolTableHTML(label, t) {
    return `
      <div class="section-heading">${esc(label)}</div>
      <p class="hint" style="margin-top:0">${esc(t.quote)}</p>
      <table class="ref-table">
        <tr><th>Test load</th><th>Maintenance</th><th>Acceptance</th></tr>
        ${t.rows.map(([range, maint, acc]) => `<tr><td>${esc(range)}</td><td>${esc(maint)}</td><td>${esc(acc)}</td></tr>`).join("")}
      </table>
      ${t.floor ? `<p class="hint">${esc(t.floor)}</p>` : ""}`;
  }

  function renderReference() {
    const classTables = CLASS_OPTIONS.map((c) => {
      const t = TOLERANCE_TABLE[c];
      return t ? tolTableHTML(`Class ${c} Tolerances`, t) : "";
    }).join("") + tolTableHTML("Class III — Crane/Hopper Tolerances", TOLERANCE_TABLE["III_CRANE_HOPPER"]);

    app.innerHTML = `
      ${topbar({ title: "Tolerance Reference", back: true })}
      <div class="screen">
        <p class="hint">NIST Handbook 44 (2026 Ed.), Sec. 2.20 Scales. <b>T.N.3.1.</b> "The maintenance
        tolerance values are as specified in Table 6. Maintenance Tolerances." <b>T.N.3.2.</b> "The acceptance
        tolerance values shall be one-half the maintenance tolerance values."</p>
        <p class="hint">Find e (the scale's marked division value), compute n = test load ÷ e, then read the
        tolerance off the matching row below — it's that many multiples of e. Use <b>Maintenance</b> for As Found
        readings on an in-service scale; use the tighter <b>Acceptance</b> for As Left readings after an
        adjustment, or for a new/just-serviced scale.</p>

        ${classTables}

        <div class="section-heading">Full text</div>
        <a class="btn" href="handbook/section-2.20-scales.pdf#page=44" target="_blank" rel="noopener">Open Sec. 2.20 Scales (PDF)</a>
        <a class="btn" href="handbook/section-1.10-general-code.pdf" target="_blank" rel="noopener" style="margin-top:8px">Open Sec. 1.10 General Code (PDF)</a>
        <p class="hint">Bundled with the app — opens offline. The Scales PDF link jumps to Table 6 (Tolerances); General Code covers terms like tare, zero, and acceptance vs. maintenance that apply to every device.</p>
      </div>
    `;
  }

  function renderSettings() {
    const s = db.settings;
    app.innerHTML = `
      ${topbar({ title: "Settings", back: true })}
      <div class="screen">
        <div class="field">
          <label>Home Base Address</label>
          <input type="text" data-setting="homeAddress" value="${esc(s.homeAddress)}" placeholder="e.g. 123 Main St, Anytown, IN" autocomplete="off">
          <p class="hint">Used as the start/end point for the Trip section's mileage estimates.</p>
        </div>
        <div class="field">
          <label>Google Maps API Key</label>
          <input type="text" data-setting="mapsApiKey" value="${esc(s.mapsApiKey)}" placeholder="AIza..." autocomplete="off">
          <p class="hint">From Google Cloud Console (Maps JavaScript API + Distance Matrix API enabled), restricted by HTTP referrer to this app's domain. Leave blank to type mileage in by hand.</p>
        </div>
      </div>
    `;
    app.querySelectorAll("[data-setting]").forEach(el => {
      el.addEventListener("input", () => {
        db.settings[el.dataset.setting] = el.value;
        save();
      });
    });
  }

  // ---------- print ----------
  function printFieldRow(label, value) {
    return value ? `<div class="pr-row"><span class="pr-label">${esc(label)}</span><span class="pr-value">${esc(value)}</span></div>` : "";
  }

  function printScaleHTML(s) {
    const title = [s.unitNumber, s.makeModel].filter(Boolean).join(" · ") || "Scale";
    return `
      <div class="pr-scale">
        <div class="pr-scale-title">${esc(title)}${s.class ? ` (Class ${esc(s.class)})` : ""}${s.passFail ? ` — ${esc(s.passFail)}` : ""}</div>
        <div class="pr-grid">
          ${printFieldRow("Serial #", s.serial)}
          ${printFieldRow("Scale Location", s.scaleLocation)}
          ${printFieldRow("Capacity by Division", s.capacityByDivision)}
          ${printFieldRow("Shift Test", s.shiftTest)}
          ${printFieldRow("As Found #1", s.asFoundTest1)}
          ${printFieldRow("As Found #2", s.asFoundTest2)}
          ${printFieldRow("As Found #3", s.asFoundTest3)}
          ${printFieldRow("Adjusted", s.adjusted)}
          ${printFieldRow("As Left #1", s.asLeftTest1)}
          ${printFieldRow("As Left #2", s.asLeftTest2)}
        </div>
        ${s.note ? `<div class="pr-note"><em>Note:</em> ${esc(s.note)}</div>` : ""}
      </div>`;
  }

  function printMeterHTML(m) {
    const title = [m.unitNumber, m.makeModel].filter(Boolean).join(" · ") || "Meter";
    const typeLabel = [m.meterType, m.accuracyClass ? `Class ${m.accuracyClass}` : ""].filter(Boolean).join(" · ");
    return `
      <div class="pr-scale">
        <div class="pr-scale-title">${esc(title)}${typeLabel ? ` (${esc(typeLabel)})` : ""}${m.passFail ? ` — ${esc(m.passFail)}` : ""}</div>
        <div class="pr-grid">
          ${printFieldRow("Serial #", m.serial)}
          ${printFieldRow("Meter Location", m.meterLocation)}
          ${printFieldRow("Rated Capacity / Flow", m.ratedCapacity)}
          ${printFieldRow("As Found #1", m.asFoundTest1)}
          ${printFieldRow("As Found #2", m.asFoundTest2)}
          ${printFieldRow("As Found #3", m.asFoundTest3)}
          ${printFieldRow("Adjusted", m.adjusted)}
          ${printFieldRow("As Left #1", m.asLeftTest1)}
          ${printFieldRow("As Left #2", m.asLeftTest2)}
        </div>
        ${m.note ? `<div class="pr-note"><em>Note:</em> ${esc(m.note)}</div>` : ""}
      </div>`;
  }

  function printJob(job) {
    const t = ensureTrip(job);
    const tripRows = [
      t.outStart ? printFieldRow("Left for job", new Date(t.outStart).toLocaleString()) : "",
      t.outEnd ? printFieldRow("Arrived on site", new Date(t.outEnd).toLocaleString()) : "",
      t.backStart ? printFieldRow("Left site", new Date(t.backStart).toLocaleString()) : "",
      t.backEnd ? printFieldRow("Back", new Date(t.backEnd).toLocaleString()) : "",
      t.milesOut ? printFieldRow("Miles there", t.milesOut) : "",
      t.milesBack ? printFieldRow("Miles back", t.milesBack) : "",
    ].join("");
    const legs = tripLegs(t);

    const byClass = CLASS_OPTIONS.map(c => [c, job.scales.filter(s => s.class === c)]);
    const unclassified = job.scales.filter(s => !CLASS_OPTIONS.includes(s.class));

    const area = document.getElementById("printArea");
    area.innerHTML = `
      <div class="pr-header">
        <h1>${esc(job.customer || "Calibration Job")}</h1>
        <div class="pr-sub">${esc([job.jobNumber ? "Job #" + job.jobNumber : "", fmtDate(job.date)].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="pr-section">
        ${printFieldRow("Location", job.location)}
        ${printFieldRow("Phone", job.phone)}
        ${printFieldRow("Contact", job.contact)}
        ${printFieldRow("Email", job.email)}
        ${printFieldRow("Calibration Schedule", job.calibrationSchedule)}
        ${printFieldRow("Next Calibration Due By", fmtDate(job.nextDueBy))}
      </div>
      ${tripRows ? `
        <div class="pr-section">
          <div class="pr-section-title">Trip</div>
          ${tripRows}
          ${legs.length ? printFieldRow("Summary", legs.join(" · ")) : ""}
        </div>` : ""}
      ${byClass.map(([c, list]) => list.length ? `<div class="pr-section-title">Class ${esc(c)} Scales</div>${list.map(printScaleHTML).join("")}` : "").join("")}
      ${unclassified.length ? `<div class="pr-section-title">Unclassified Scales</div>${unclassified.map(printScaleHTML).join("")}` : ""}
      ${ensureMeters(job).length ? `<div class="pr-section-title">Meters</div>${ensureMeters(job).map(printMeterHTML).join("")}` : ""}
      ${job.notes ? `<div class="pr-section"><div class="pr-section-title">Notes</div><div class="pr-note">${esc(job.notes)}</div></div>` : ""}
      <div class="pr-footer">Printed ${esc(new Date().toLocaleString())}</div>
    `;
  }

  function currentDevice() {
    const job = findJob(route.jobId);
    if (!job) return null;
    if (route.view === "scaleForm") return findScale(job, route.scaleId);
    if (route.view === "meterForm") return findMeter(job, route.meterId);
    return null;
  }

  // ---------- actions ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "back") { history.back(); return; }
    if (action === "open-reference") { navigate("reference"); return; }
    if (action === "open-settings") { navigate("settings"); return; }

    if (action === "print-job") {
      const job = findJob(route.jobId);
      if (!job) return;
      printJob(job);
      window.print();
      return;
    }

    if (action === "trip-now") {
      const job = findJob(route.jobId);
      if (!job) return;
      const t = ensureTrip(job);
      t[el.dataset.trip] = Date.now();
      job.updatedAt = Date.now();
      save();
      refreshTripUI(job);
      return;
    }

    if (action === "trip-clear") {
      const job = findJob(route.jobId);
      if (!job) return;
      const t = ensureTrip(job);
      t[el.dataset.trip] = null;
      job.updatedAt = Date.now();
      save();
      refreshTripUI(job);
      return;
    }

    if (action === "estimate-miles") {
      estimateMiles(findJob(route.jobId), el.dataset.trip, el);
      return;
    }

    if (action === "new-job") {
      const job = newJob();
      db.jobs.push(job);
      save();
      navigate("job", { jobId: job.id });
      return;
    }

    if (action === "open-job") { navigate("job", { jobId: el.dataset.job }); return; }

    if (action === "delete-job") {
      const job = findJob(route.jobId);
      if (!job) return;
      if (confirm(`Delete the job for "${job.customer || "this job"}"? This can't be undone.`)) {
        job.scales.forEach(s => (s.images || []).forEach(id => deleteImageBlob(id).catch(() => {})));
        ensureMeters(job).forEach(m => {
          (m.images || []).forEach(id => deleteImageBlob(id).catch(() => {}));
          (m.docs || []).forEach(d => deleteImageBlob(d.id).catch(() => {}));
        });
        db.jobs = db.jobs.filter(j => j.id !== job.id);
        save();
        navigate("home", {}, true);
      }
      return;
    }

    if (action === "add-scale") {
      const job = findJob(el.dataset.job);
      const s = newScale();
      job.scales.push(s);
      job.updatedAt = Date.now();
      save();
      navigate("scaleForm", { jobId: job.id, scaleId: s.id });
      return;
    }

    if (action === "open-scale") { navigate("scaleForm", { jobId: el.dataset.job, scaleId: el.dataset.scale }); return; }

    if (action === "add-document") {
      app.querySelector("[data-doc-input]")?.click();
      return;
    }

    if (action === "delete-doc") {
      const job = findJob(route.jobId);
      const d = currentDevice();
      if (!d) return;
      const id = el.dataset.docId;
      d.docs = (d.docs || []).filter(x => x.id !== id);
      job.updatedAt = Date.now();
      save();
      deleteImageBlob(id).catch(() => {});
      renderDocList(d);
      return;
    }

    if (action === "done-scale") {
      const job = findJob(route.jobId);
      const s = findScale(job, route.scaleId);
      if (s && isScaleEmpty(s)) {
        job.scales = job.scales.filter(x => x.id !== s.id);
        save();
      }
      history.back();
      return;
    }

    if (action === "delete-scale") {
      const job = findJob(route.jobId);
      const s = findScale(job, route.scaleId);
      if (!s) return;
      if (confirm("Delete this scale entry?")) {
        (s.images || []).forEach(id => deleteImageBlob(id).catch(() => {}));
        job.scales = job.scales.filter(x => x.id !== s.id);
        save();
        navigate("job", { jobId: job.id }, true);
      }
      return;
    }

    if (action === "add-meter") {
      const job = findJob(el.dataset.job);
      const m = newMeter();
      ensureMeters(job).push(m);
      job.updatedAt = Date.now();
      save();
      navigate("meterForm", { jobId: job.id, meterId: m.id });
      return;
    }

    if (action === "open-meter") { navigate("meterForm", { jobId: el.dataset.job, meterId: el.dataset.meter }); return; }

    if (action === "done-meter") {
      const job = findJob(route.jobId);
      const m = findMeter(job, route.meterId);
      if (m && isMeterEmpty(m)) {
        job.meters = ensureMeters(job).filter(x => x.id !== m.id);
        save();
      }
      history.back();
      return;
    }

    if (action === "delete-meter") {
      const job = findJob(route.jobId);
      const m = findMeter(job, route.meterId);
      if (!m) return;
      if (confirm("Delete this meter entry?")) {
        (m.images || []).forEach(id => deleteImageBlob(id).catch(() => {}));
        (m.docs || []).forEach(d => deleteImageBlob(d.id).catch(() => {}));
        job.meters = ensureMeters(job).filter(x => x.id !== m.id);
        save();
        navigate("job", { jobId: job.id }, true);
      }
      return;
    }

    if (action === "add-photo") {
      app.querySelector("[data-photo-input]")?.click();
      return;
    }

    if (action === "view-photo") {
      const overlay = document.createElement("div");
      overlay.className = "photo-lightbox";
      overlay.innerHTML = `<img src="${el.src}" alt="Scale photo">`;
      overlay.addEventListener("click", () => overlay.remove());
      document.body.appendChild(overlay);
      return;
    }

    if (action === "delete-photo") {
      const job = findJob(route.jobId);
      const s = currentDevice();
      if (!s) return;
      const id = el.dataset.photoId;
      s.images = (s.images || []).filter(i => i !== id);
      job.updatedAt = Date.now();
      save();
      deleteImageBlob(id).catch(() => {});
      renderPhotoGrid(s);
      return;
    }

    if (action === "export-job") {
      const job = findJob(el.dataset.job);
      const csv = rowsToCSV(jobToRows(job));
      downloadCSV(`calibration_${safeName(job.jobNumber || job.customer || job.id.slice(0, 6))}_${job.date || "nodate"}.csv`, csv);
      return;
    }

    if (action === "share-job") {
      const job = findJob(el.dataset.job);
      const csv = rowsToCSV(jobToRows(job));
      shareCSV(`calibration_${safeName(job.jobNumber || job.customer || job.id.slice(0, 6))}_${job.date || "nodate"}.csv`, csv);
      return;
    }

    if (action === "export-all") {
      const rows = db.jobs.flatMap(jobToRows);
      downloadCSV(`calibration_all_${todayISO()}.csv`, rowsToCSV(rows));
      return;
    }
  });

  // ---------- init ----------
  history.replaceState(route, "", "#" + route.view);
  render();
})();
