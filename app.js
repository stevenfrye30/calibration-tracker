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
      if (!raw) return { jobs: [] };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.jobs)) return { jobs: [] };
      return parsed;
    } catch {
      return { jobs: [] };
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
    };
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
    renderHome();
  }

  function topbar({ title, sub, back, rightIcon, rightLabel, onRight }) {
    return `
      <div class="topbar">
        ${back ? `<button class="icon-btn" data-action="back" aria-label="Back">‹</button>` : ""}
        <h1>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</h1>
        ${rightIcon ? `<button class="icon-btn" data-action="${onRight}" aria-label="${esc(rightLabel || "")}">${rightIcon}</button>` : ""}
      </div>`;
  }

  function renderHome() {
    const jobs = [...db.jobs].sort((a, b) => b.updatedAt - a.updatedAt);
    app.innerHTML = `
      ${topbar({ title: "Calibration Jobs", rightIcon: "📏", rightLabel: "Reference", onRight: "open-reference" })}
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

  function renderReference() {
    app.innerHTML = `
      ${topbar({ title: "Tolerance Reference", back: true })}
      <div class="screen">
        <p class="hint">Transcribed from a photo of the printed form — confirm against your official copy before relying on it.</p>

        <div class="section-heading">Maintenance Tolerance — Class I</div>
        <p class="hint" style="margin-top:0">e = greater of 1d and 1 mg</p>
        <table class="ref-table">
          <tr><th>Range</th><th>Tolerance</th></tr>
          <tr><td>0 – 50,000d</td><td>1e</td></tr>
          <tr><td>50,001 – 200,000d</td><td>2e</td></tr>
          <tr><td>200,001d and over</td><td>3e</td></tr>
        </table>

        <div class="section-heading">Maintenance Tolerance — Class II</div>
        <p class="hint" style="margin-top:0">d = 1 scale division</p>
        <table class="ref-table">
          <tr><th>Range</th><th>Tolerance</th></tr>
          <tr><td>0 – 5,000d</td><td>1d</td></tr>
          <tr><td>5,001 – 50,000d</td><td>2d</td></tr>
          <tr><td>50,001d and over</td><td>3d</td></tr>
        </table>

        <div class="section-heading">Notes on the form</div>
        <table class="ref-table">
          <tr><td>Traceability</td><td>Handbook 44</td></tr>
          <tr><td>Test method</td><td>Certified test weights</td></tr>
        </table>
      </div>
    `;
  }

  // ---------- actions ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "back") { history.back(); return; }
    if (action === "open-reference") { navigate("reference"); return; }

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
