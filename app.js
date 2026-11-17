(() => {
  "use strict";

  const STORAGE_KEY = "calTracker.v1";
  const app = document.getElementById("app");

  const CLASS_OPTIONS = ["I", "II", "III"];

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
    ["class", "Class"], ["unitNumber", "Unit #"], ["scaleLocation", "Scale Location"],
    ["makeModel", "Make & Model #"], ["serial", "Serial #"],
    ["capacityByDivision", "Capacity by Division"], ["shiftTest", "Shift Test"],
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
      scales: [],
      trip: { outStart: null, outEnd: null, backStart: null, backEnd: null, milesOut: "", milesBack: "" },
    };
  }

  function ensureTrip(job) {
    if (!job.trip) job.trip = { outStart: null, outEnd: null, backStart: null, backEnd: null, milesOut: "", milesBack: "" };
    return job.trip;
  }

  function newScale() {
    return {
      id: uid(), class: "",
      unitNumber: "", scaleLocation: "", makeModel: "", serial: "", capacityByDivision: "",
      shiftTest: "",
      asFoundTest1: "", asFoundTest2: "", asFoundTest3: "",
      adjusted: "",
      asLeftTest1: "", asLeftTest2: "",
      passFail: "", note: "",
      images: [],
    };
  }

  function findJob(id) { return db.jobs.find(j => j.id === id); }
  function findScale(job, id) { return job.scales.find(s => s.id === id); }

  function isScaleEmpty(s) {
    const fields = ["class", "unitNumber", "scaleLocation", "makeModel", "serial",
      "capacityByDivision", "shiftTest", "asFoundTest1", "asFoundTest2", "asFoundTest3",
      "adjusted", "asLeftTest1", "asLeftTest2", "passFail", "note"];
    return fields.every(f => !s[f]) && (!s.images || s.images.length === 0);
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
    if (job.scales.length === 0) return [base];
    return job.scales.map(s => ({ ...base, ...s }));
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

    if (route.view === "home") return renderHome();
    if (route.view === "job") return renderJobScreen(route.jobId);
    if (route.view === "scaleForm") return renderScaleForm(route.jobId, route.scaleId);
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

    function section(label, list) {
      if (list.length === 0) return "";
      return `<div class="section-heading">${esc(label)}</div><div class="card-list">${list.map(scaleCard).join("")}</div>`;
    }

    app.innerHTML = `
      ${topbar({ title: job.customer || "New Job", sub: [job.jobNumber ? "Job #" + job.jobNumber : "", fmtDate(job.date)].filter(Boolean).join(" · "), back: true, rightIcon: "🗑", rightLabel: "Delete job", onRight: "delete-job" })}
      <div class="screen">
        <div class="card">
          ${JOB_FIELDS.map(([k, label, type]) => fieldHTML(job[k], k, label, type)).join("")}
        </div>

        ${tripSectionHTML(job)}

        ${byClass.map(([c, list]) => section(`Class ${c} Scales`, list)).join("")}
        ${section("Unclassified", unclassified)}
        ${job.scales.length === 0 ? `<div class="empty-state">No scales added yet.</div>` : ""}

        <div class="field" style="margin-top:22px">
          <label>Notes</label>
          <textarea data-field="notes" rows="3">${esc(job.notes)}</textarea>
        </div>
      </div>
      <div class="action-bar"><div class="action-bar-inner">
        <button class="btn" data-action="export-job" data-job="${job.id}">Download CSV</button>
        <button class="btn btn-icon-square" data-action="share-job" data-job="${job.id}" aria-label="Share CSV">↗</button>
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

  // Source: NIST Handbook 44 (2026 Ed.), Section 2.20 Scales — T.N.3.1 (Table 6.
  // Maintenance Tolerances), T.N.3.2 (Acceptance = 1/2 Maintenance), S.1.2.2.2 (for
  // Class III, e is marked by the manufacturer and e = d). All tolerance values below
  // are in multiples of the verification scale interval "e" (= the scale division "d"
  // printed on a Class III scale, e.g. the "0.1 lb" in "500 lb x 0.1 lb").
  // Note: the official 2026 PDF's Table 6 prints the 4th Class III/IIII tolerance-tier
  // column header as "5" (should read "4", 1-2-3-4 is the table's own numbering
  // pattern); treated here as a publication typo and corrected to 4e.
  const TOLERANCE_TABLE = {
    I: { eLabel: "Class I — e set by device marking (auxiliary indication allowed, d < e ≤ 10d, or d < e at e = 1 mg)",
      rows: [
        ["0 – 50,000 e", "1e", "0.5e"],
        ["50,001 – 200,000 e", "2e", "1e"],
        ["200,001+ e", "3e", "1.5e"],
      ] },
    II: { eLabel: "Class II — e set by device marking (auxiliary indication allowed, d < e ≤ 10d)",
      rows: [
        ["0 – 5,000 e", "1e", "0.5e"],
        ["5,001 – 20,000 e", "2e", "1e"],
        ["20,001+ e", "3e", "1.5e"],
      ] },
    III: { eLabel: "Class III — e = d (the marked scale division; ordinary commercial/retail scales)",
      rows: [
        ["0 – 500 e", "1e", "0.5e"],
        ["501 – 2,000 e", "2e", "1e"],
        ["2,001 – 4,000 e", "3e", "1.5e"],
        ["4,001+ e", "4e", "2e"],
      ] },
  };

  function renderReference() {
    const classTables = CLASS_OPTIONS.map((c) => {
      const t = TOLERANCE_TABLE[c];
      if (!t) return "";
      return `
        <div class="section-heading">Class ${esc(c)} Tolerances</div>
        <p class="hint" style="margin-top:0">${esc(t.eLabel)}</p>
        <table class="ref-table">
          <tr><th>Test load</th><th>Maintenance</th><th>Acceptance</th></tr>
          ${t.rows.map(([range, maint, acc]) => `<tr><td>${esc(range)}</td><td>${esc(maint)}</td><td>${esc(acc)}</td></tr>`).join("")}
        </table>`;
    }).join("");

    app.innerHTML = `
      ${topbar({ title: "Tolerance Reference", back: true })}
      <div class="screen">
        <p class="hint">NIST Handbook 44 (2026 Ed.), Sec. 2.20 Scales, T.N.3.1–T.N.3.2 (Table 6). Find e (the
        scale's marked division value), compute n = test load ÷ e, then read the tolerance off the matching row —
        it's that many multiples of e.</p>
        <p class="hint">Use <b>Maintenance</b> tolerance for As Found readings on an in-service scale.
        Use the tighter <b>Acceptance</b> tolerance for As Left readings after an adjustment, or for a new/just-serviced scale.</p>

        ${classTables}
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

  // ---------- actions ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "back") { history.back(); return; }
    if (action === "open-reference") { navigate("reference"); return; }
    if (action === "open-settings") { navigate("settings"); return; }

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
      const s = findScale(job, route.scaleId);
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
