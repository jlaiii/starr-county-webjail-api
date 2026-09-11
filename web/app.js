/* Starr County Jail Roster — live lookup app.
   Loads data.json (mirrored hourly from the county's public Webjail API by
   GitHub Actions) from the same origin — no CORS relay, no runtime county
   calls. Two views: roster cards + photo wall; every card opens an inmate
   file with charges/bond up top. See tools/mirror.py and docs/ for the API. */
"use strict";

/* ---------------------------------------------------------------- i18n */
const L = {
  en: {
    title: "Starr County Jail", hsub: "Inmate roster · Rio Grande City, TX",
    heroTitle: "Starr County Jail Roster",
    heroSub: "Live inmate & booking lookup · Rio Grande City, Texas",
    liveLabel: "Live",
    themeLabel: "Switch light / dark theme",
    clearLabel: "Clear search",
    statusInit: "Loading roster…",
    statusOk: n => `${n} in custody`,
    statusErr: "Couldn't load the roster. The mirror updates hourly — try again in a moment.",
    retry: "Try again", searchPh: "Search name, booking # or charge…",
    showing: (n, total) => n === total ? `${total} records` : `Showing ${n} of ${total}`,
    noResults: "No inmates match your search.",
    sortNewest: "Newest booking", sortName: "Name A–Z", sortDate: "Booked date",
    sortOldest: "Oldest first", sortYoungest: "Youngest first",
    sortHeaviest: "Heaviest first", sortLightest: "Lightest first",
    sortTallest: "Tallest first", sortShortest: "Shortest first",
    sexAll: "Men & women", sexMen: "Men", sexWomen: "Women",
    tileCustody: "In custody", tileMen: "Men", tileWomen: "Women", tilePhotos: "With photo",
    updatedAgo: m => m < 60 ? `Updated ${m}m ago` : `Updated ${Math.floor(m / 60)}h ${m % 60}m ago`,
    booked: "Booked", withheld: "Photo withheld",
    bToday: "Booked today", bYesterday: "Booked yesterday", bDaysAgo: n => `Booked ${n} days ago`,
    bookedOn: d => `Booked ${d}`,
    charges: "Charges", charge: "Charge", bond: "Bond", denied: "Bond denied", level: "Level",
    agency: "Agency", arrested: "Arrested", dob: "DOB", gender: "Gender", race: "Race",
    height: "Height", weight: "Weight", booking: "Booking", subject: "Subject",
    eye: "Eyes", hair: "Hair", age: "Age", stay: "In custody since",
    noCharges: "No charges listed.", totalBond: "Total bond", bondNone: "No bond set",
    tabInmates: "Inmates", tabPhotos: "Photos", viewFile: "View file",
    photosOf: n => `${n} photos`,
    footTitle: "About this site",
    footData: "Data is mirrored every hour from the Starr County jail system's public Webjail feed. Released inmates are removed from the feed automatically, so they disappear from this roster too.",
    footNote: "Not an official county website. Verify with the Starr County Sheriff's Office at (956) 487-5571 before acting on this information.",
    footDocs: "Field guide, recipes & live test suite for developers and AI agents",
    footDocs2: "API documentation",
    live: "Hourly mirror ·"
  },
  es: {
    title: "Cárcel del Condado de Starr", hsub: "Lista de presos · Rio Grande City, TX",
    heroTitle: "Lista de la Cárcel del Condado de Starr",
    heroSub: "Consulta de presos e ingresos en vivo · Rio Grande City, Texas",
    liveLabel: "En vivo",
    themeLabel: "Cambiar tema claro / oscuro",
    clearLabel: "Borrar búsqueda",
    statusInit: "Cargando lista…",
    statusOk: n => `${n} en custodia`,
    statusErr: "No se pudo cargar la lista. El espejo se actualiza cada hora — intenta de nuevo en un momento.",
    retry: "Reintentar", searchPh: "Buscar nombre, # de ingreso o cargo…",
    showing: (n, total) => n === total ? `${total} registros` : `Mostrando ${n} de ${total}`,
    noResults: "Ningún preso coincide con tu búsqueda.",
    sortNewest: "Ingreso más reciente", sortName: "Nombre A–Z", sortDate: "Fecha de ingreso",
    sortOldest: "Mayores primero", sortYoungest: "Menores primero",
    sortHeaviest: "Más pesados primero", sortLightest: "Más ligeros primero",
    sortTallest: "Más altos primero", sortShortest: "Más bajos primero",
    sexAll: "Hombres y mujeres", sexMen: "Hombres", sexWomen: "Mujeres",
    tileCustody: "En custodia", tileMen: "Hombres", tileWomen: "Mujeres", tilePhotos: "Con foto",
    updatedAgo: m => m < 60 ? `Actualizado hace ${m} min` : `Actualizado hace ${Math.floor(m / 60)}h ${m % 60} min`,
    booked: "Ingresado", withheld: "Foto no publicada",
    bToday: "Ingresado hoy", bYesterday: "Ingresado ayer", bDaysAgo: n => `Ingresado hace ${n} días`,
    bookedOn: d => `Ingresado ${d}`,
    charges: "Cargos", charge: "Cargo", bond: "Fianza", denied: "Fianza denegada", level: "Nivel",
    agency: "Agencia", arrested: "Arrestado", dob: "Nacimiento", gender: "Género", race: "Raza",
    height: "Estatura", weight: "Peso", booking: "Ingreso", subject: "Sujeto",
    eye: "Ojos", hair: "Cabello", age: "Edad", stay: "En custodia desde",
    noCharges: "No hay cargos registrados.", totalBond: "Fianza total", bondNone: "Sin fianza",
    tabInmates: "Presos", tabPhotos: "Fotos", viewFile: "Ver ficha",
    photosOf: n => `${n} fotos`,
    footTitle: "Acerca de este sitio",
    footData: "Los datos se reflejan cada hora desde el sistema público Webjail del condado de Starr. Los liberados se eliminan automáticamente del sistema, así que desaparecen de esta lista también.",
    footNote: "Este no es un sitio oficial del condado. Verifica con la Oficina del Sheriff del Condado de Starr al (956) 487-5571 antes de actuar con esta información.",
    footDocs: "Guía de la API, recetas y pruebas en vivo para desarrolladores y agentes de IA",
    footDocs2: "Documentación de la API",
    live: "Espejo horario ·"
  }
};
let lang = (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
const t = k => typeof L[lang][k] === "function" ? L[lang][k] : (L[lang][k] || k);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const state = { records: [], loadedAt: null, q: "", err: false, view: "inmates" };

/* ---------------------------------------------------------------- helpers */
function nameOf(r) { return r.name || [r.FirstName, r.MiddleName, r.LastName].filter(Boolean).join(" "); }
function initials(name) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "—";
  const a = w[0][0] || "";
  const b = w.length > 1 ? (w[w.length - 1][0] || "") : (w[0][1] || "");
  return (a + b).toUpperCase();
}
function avFail(img) {
  const s = document.createElement("span");
  s.className = "cav";
  s.textContent = img.dataset.init || "—";
  s.setAttribute("aria-hidden", "true");
  img.replaceWith(s);
}
function parseDate(s) {
  if (s == null || s === "") return null;
  s = String(s).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { y: m[1], mo, d };
    return null;                       // sentinel dates like 0000-00-00 -> unknown
  }
  const dt = new Date(s);
  if (!isNaN(dt)) return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate() };
  return null;
}
function dateOnly(s) {
  const p = parseDate(s);
  if (!p) return String(s ?? "").slice(0, 10) || "—";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(p.mo)}/${pad(p.d)}/${p.y}`;
}
function age(dob) {
  const p = parseDate(dob);
  if (!p) return null;
  const n = new Date();
  let a = n.getFullYear() - +p.y;
  if (n.getMonth() + 1 < p.mo || (n.getMonth() + 1 === p.mo && n.getDate() < p.d)) a--;
  return a >= 0 ? a : null;
}
/* "Booked today / yesterday / 3 days ago" — absolute date past 6 days.
   Reference = the viewer's local calendar (the jail's day is the user's day).
   County labels are date-only and can sit one day AHEAD of a Texas evening
   (UTC-midnight serialization), so a negative difference clamps to "today". */
function bookedPhrase(s) {
  const p = parseDate(s);
  if (!p) return dateOnly(s);
  const now = new Date();
  const ref = { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() };
  let days = Math.round((Date.UTC(+ref.y, ref.mo - 1, ref.d) - Date.UTC(+p.y, p.mo - 1, p.d)) / 864e5);
  if (days < 0) days = 0;                       // future-looking county label -> same-day booking
  if (days === 0) return t("bToday");
  if (days === 1) return t("bYesterday");
  if (days <= 6) return t("bDaysAgo")(days);
  return t("bookedOn")(dateOnly(s));
}
function money(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? "$" + n.toLocaleString("en-US") : null;
}
function chargeText(r) {
  return (r.charges || []).map(c => [c.desc, c.level, c.agency].filter(Boolean).join(" ")).join(" ");
}
function totalBond(r) {
  const ch = r.charges || [];
  if (!ch.some(c => c.bond != null && c.bond !== "")) return null;   // no bonds set at all
  return ch.reduce((s, c) => s + (Number(c.bond) || 0), 0);
}

/* ---------------------------------------------------------------- data */
async function load() {
  state.err = false;
  setStatus("statusInit");
  skeletons(8);
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const doc = await res.json();
    state.records = doc.inmates || [];
    state.loadedAt = new Date(doc.updated || Date.now());
    applyFilters();
  } catch (e) {
    state.err = true;
    setStatus("statusErr", 0, "err");
    $("#grid").innerHTML = "";
    const p = $("#progress");
    p.innerHTML = `<button class="btn" id="retryBtn" type="button">${esc(t("retry"))}</button>`;
    $("#retryBtn").onclick = () => { p.innerHTML = ""; load(); };
  }
}
function tickClock() {
  if (!state.loadedAt) return;
  const m = Math.max(0, Math.round((Date.now() - state.loadedAt.getTime()) / 60000));
  const el = $("#updated");
  if (el) el.textContent = `${t("live")} ${t("updatedAgo")(m)}`;
}

/* ------------------------------------- filtering / sorting (client-side) */
function haystack(r) {
  return (nameOf(r) + " " + (r.bookingID || "") + " " + (r.ptsBookingID ?? "") + " " +
    chargeText(r)).toLowerCase();
}
function heightInches(h) {
  if (!h) return null;
  const m = String(h).match(/(\d+)'?\s*(\d{1,2})?/);
  if (!m) return null;
  return +m[1] * 12 + (+(m[2] || 0));
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  const sex = $("#sexSel").value;
  let list = state.records;
  if (q) list = list.filter(r => haystack(r).includes(q));
  if (sex === "men") list = list.filter(r => (r.gender || "").toUpperCase() === "MALE");
  else if (sex === "women") list = list.filter(r => (r.gender || "").toUpperCase() === "FEMALE");
  const sort = $("#sortSel").value;
  const p = dob => { const x = parseDate(dob); return x ? +x.y * 10000 + x.mo * 100 + x.d : (sort === "youngest" ? -Infinity : Infinity); };
  const sorter = {
    newest: (a, b) => String(b.bookingID || "").localeCompare(String(a.bookingID || "")),
    name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
    date: (a, b) => String(b.booked || "").localeCompare(String(a.booked || "")),
    oldest: (a, b) => p(a.dob) - p(b.dob),
    youngest: (a, b) => p(b.dob) - p(a.dob),
    heaviest: (a, b) => (b.weight ?? -1) - (a.weight ?? -1),
    lightest: (a, b) => (a.weight ?? Infinity) - (b.weight ?? Infinity),
    tallest: (a, b) => (heightInches(b.height) ?? -1) - (heightInches(a.height) ?? -1),
    shortest: (a, b) => (heightInches(a.height) ?? Infinity) - (heightInches(b.height) ?? Infinity)
  }[sort] || (() => 0);
  return list.slice().sort(sorter);
}

/* ---------------------------------------------------------------- render */
function applyFilters() {
  const list = filtered();
  const photoList = list.filter(r => r.img && r.imgPub !== false);
  const empty = state.view === "photos" ? photoList.length === 0 : list.length === 0;
  $("#empty").style.display = empty ? "block" : "none";
  if (state.view === "photos") renderPhotos(photoList);
  else renderCards(list);
  updateCounts();
  setStatus("statusOk", state.records.length, "ok");
  tickClock();
}
function updateCounts() {
  const photos = state.records.filter(r => r.img && r.imgPub !== false).length;
  const tb = $("#tabPhotos");
  let c = tb.querySelector(".phcount");
  if (!c) { c = document.createElement("span"); c.className = "phcount"; tb.appendChild(c); }
  c.textContent = `(${photos})`;

  const men = state.records.filter(r => (r.gender || "").toUpperCase() === "MALE").length;
  const women = state.records.length - men;
  const set = (id, n) => {
    const el = $(`#${id} .sval`);
    if (el) el.textContent = Number.isFinite(n) ? n : "—";
  };
  set("sumCustody", state.records.length);
  set("sumMen", men);
  set("sumWomen", women);
  set("sumPhotos", photos);

  const shown = state.view === "photos"
    ? state.records.filter(r => r.img && r.imgPub !== false && (!state.q.trim() ||
        haystack(r).includes(state.q.trim().toLowerCase()))).length
    : filtered().length;
  $("#resultCount").textContent = t("showing")(shown, state.records.length);
}
function cardHTML(r, di) {
  const a = age(r.dob);
  const init = initials(nameOf(r));
  const hasImg = r.img && r.imgPub !== false;
  const thumb = hasImg
    ? `<img class="thumb" loading="lazy" src="${esc(r.img)}" data-init="${esc(init)}"
            alt="Mugshot of ${esc(nameOf(r))}" onload="this.classList.add('in')" onerror="avFail(this)">`
    : `<span class="cav" aria-hidden="true">${esc(init)}</span>`;
  const ch = r.charges || [];
  const tb = totalBond(r);
  const pills = [];
  if (a != null) pills.push(`<span class="pill">${a} ${lang === "es" ? "años" : "yrs"}</span>`);
  if (tb != null) pills.push(`<span class="pill bond">${esc(t("bond"))} ${money(tb)}</span>`);
  if (ch.some(o => o.denied)) pills.push(`<span class="pill denied">${esc(t("denied"))}</span>`);
  const gr = [r.gender, r.race].filter(Boolean).join(" · ");
  if (gr) pills.push(`<span class="pill gender">${esc(gr)}</span>`);
  const chLine = ch.length
    ? `<span class="chg"><b>${esc(t("charges"))}: ${ch.length}</b>` +
      (ch[0].desc ? `<span class="ellip">${esc(ch[0].desc)}${ch.length > 1 ? ` +${ch.length - 1}` : ""}</span>` : "") +
      `</span>`
    : `<span class="chg"><b>${esc(t("charges"))}: 0</b><span class="ellip">${esc(t("noCharges"))}</span></span>`;
  return `<button type="button" class="card" data-pid="${esc(r.ptsBookingID)}" style="--i:${di}">
    <span class="cphoto">
      ${thumb}
      ${!hasImg ? `<span class="phbadge">${esc(t("withheld"))}</span>` : ""}
      <span class="povl">
        <span class="pname">${esc(nameOf(r))}</span>
        <span class="pno">#${esc(r.bookingID)}</span>
      </span>
    </span>
    <span class="cbody">
      <span class="crow"><span class="strong">${esc(bookedPhrase(r.booked))}</span></span>
      ${chLine}
      <span class="pills">${pills.join("")}</span>
    </span>
  </button>`;
}
function renderCards(list) {
  $("#photogrid").style.display = "none";
  $("#grid").style.display = "grid";
  $("#grid").innerHTML = list.map((r, i) => cardHTML(r, Math.min(i, 12))).join("") ||
    `<div class="empty" style="display:block"><p>${esc(t("noResults"))}</p></div>`;
}
function renderPhotos(list) {
  $("#grid").style.display = "none";
  $("#photogrid").style.display = "grid";
  $("#photogrid").innerHTML = list.length ? list.map((p, i) => `
    <button type="button" class="ptile" data-pid="${esc(p.ptsBookingID)}" title="${esc(nameOf(p))}"
            style="--i:${Math.min(i, 18)}" aria-label="${esc(nameOf(p))}">
      <img loading="lazy" src="${esc(p.img)}" alt="Mugshot of ${esc(nameOf(p))}"
           onload="this.classList.add('in')">
      <span class="tcap"><span>${esc(nameOf(p))}</span></span>
    </button>`).join("") : "";
}
function skeletons(n) {
  $("#grid").style.display = "grid";
  $("#photogrid").style.display = "none";
  $("#grid").innerHTML = Array.from({ length: n },
    () => `<div class="skel"><div class="b"></div></div>`).join("");
}
function setStatus(kind, n, cls) {
  const fn = L[lang][kind];
  $("#statusText").textContent = typeof fn === "function" ? fn(n) : fn || kind;
  $("#statusDot").className = "dot" + (cls ? " " + cls : "");
}

/* ---------------------------------------------------------------- views */
function switchView(v) {
  state.view = v;
  $("#tabInmates").classList.toggle("active", v === "inmates");
  $("#tabPhotos").classList.toggle("active", v === "photos");
  applyFilters();
}

/* ------------------------------------------- detail modal (inmate file) */
function openDetail(pid) {
  const r = state.records.find(x => String(x.ptsBookingID) === String(pid));
  if (!r) return;
  const a = age(r.dob);
  const hasImg = r.img && r.imgPub !== false;
  const img = $("#mImg"), av = $("#mAvatar");
  img.hidden = !hasImg; av.hidden = hasImg;
  if (hasImg) { img.src = r.img; img.onerror = () => { img.hidden = true; av.hidden = false; }; }
  else av.textContent = initials(nameOf(r));

  $("#mName").textContent = nameOf(r);
  $("#mMeta").textContent = [`#${r.bookingID}`, bookedPhrase(r.booked),
    r.gender && r.race ? `${r.gender} · ${r.race}` : (r.gender || r.race || "")].filter(Boolean).join(" · ");
  if (!hasImg) $("#mMeta").textContent += ` · ${t("withheld")}`;

  const cells = [];
  const cell = (k, v) => { if (v != null && v !== "") cells.push(`<span class="qcell"><span class="qk">${esc(k)}</span><span class="qv">${esc(v)}</span></span>`); };
  cell(t("age"), a != null ? `${a}` : null);
  cell(t("dob"), r.dob ? dateOnly(r.dob) : null);
  cell(t("height"), r.height);
  cell(t("weight"), r.weight != null ? `${r.weight} lbs` : null);
  cell(t("eye"), r.eye);
  cell(t("hair"), r.hair);
  $("#mQuick").innerHTML = cells.join("");

  const ch = r.charges || [];
  const tb = totalBond(r);
  $("#mBody").innerHTML =
    `<div class="chead"><b>${esc(t("charges"))} (${ch.length})</b>` +
    (tb != null ? `<span class="bondtot">${esc(t("totalBond"))}: ${money(tb)}</span>`
                : `<span class="mut">${esc(t("bondNone"))}</span>`) + `</div>` +
    `<div class="charges">` +
    (ch.length ? ch.map(o => {
      const b = money(o.bond);
      return `<div class="charge"><div class="d">${esc(o.desc || "—")}</div>
        <div class="x">
          ${o.level ? `<span>${esc(t("level"))} <b>${esc(o.level)}</b></span>` : ""}
          ${b != null ? `<span>${esc(t("bond"))} <b>${b}</b></span>` : ""}
          ${o.denied ? `<span class="denied">${esc(t("denied"))}</span>` : ""}
          ${o.agency ? `<span>${esc(o.agency)}</span>` : ""}
          ${o.arrested ? `<span>${esc(t("arrested"))} ${esc(dateOnly(o.arrested))}</span>` : ""}
        </div></div>`;
    }).join("") : `<span class="mut">${esc(t("noCharges"))}</span>`) + `</div>`;

  $("#mFoot").innerHTML =
    row(t("booking"), `#${esc(r.bookingID)}`) +
    (r.ptsBookingID != null ? row("ptsBookingID", r.ptsBookingID) : "") +
    (r.dob ? row(t("dob"), `${dateOnly(r.dob)}${a != null ? ` (${a})` : ""}`) : "") +
    (r.booked ? row(t("booked"), `${dateOnly(r.booked)} · ${bookedPhrase(r.booked)}`) : "");

  $("#modal").style.display = "flex";
  document.body.classList.add("locked");
}
function row(k, v) { return `<div class="srow"><span>${esc(k)}</span><b>${v}</b></div>`; }
function closeModal() {
  $("#modal").style.display = "none";
  document.body.classList.remove("locked");
}

/* ---------------------------------------------------------------- lightbox */
function openLightbox(pid) {
  const r = state.records.find(x => String(x.ptsBookingID) === String(pid));
  if (!r || !r.img) return;
  $("#lbImg").src = r.img;
  $("#lbName").textContent = nameOf(r);
  const a = age(r.dob);
  $("#lbMeta").textContent = `#${r.bookingID} · ${bookedPhrase(r.booked)}` +
    (a != null ? ` · ${a} ${lang === "es" ? "años" : "yrs"}` : "") +
    ` · ${t("charges")}: ${(r.charges || []).length}`;
  $("#lightbox").style.display = "flex";
  document.body.classList.add("locked");
}
function closeLightbox() {
  $("#lightbox").style.display = "none";
  document.body.classList.remove("locked");
}

/* ---------------------------------------------------------------- i18n */
function applyLang() {
  document.documentElement.lang = lang;
  $("#langBtn").textContent = lang === "en" ? "ES" : "EN";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const k = el.dataset.i18n;
    if (typeof L[lang][k] === "string") el.textContent = L[lang][k];
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    const k = el.dataset.i18nPh;
    if (L[lang][k]) el.placeholder = L[lang][k];
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(el => {
    const k = el.dataset.i18nAria;
    if (L[lang][k]) el.setAttribute("aria-label", L[lang][k]);
  });
  updateCounts();
}

/* ---------------------------------------------------------------- theme */
function applyTheme(mode) {
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = mode;
  try { localStorage.setItem("sjr-theme", mode); } catch (e) { /* private mode */ }
}
function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* ---------------------------------------------------------------- init */
let deb;
function init() {
  try {
    const saved = localStorage.getItem("sjr-theme");
    if (saved) applyTheme(saved);
  } catch (e) { /* ignore */ }
  $("#apiUrl").textContent = "64.225.20.254:3030";

  applyLang();
  load();
  setInterval(tickClock, 60000);

  $("#themeBtn").onclick = () => applyTheme(currentTheme() === "dark" ? "light" : "dark");
  $("#langBtn").onclick = () => { lang = lang === "en" ? "es" : "en"; applyLang(); applyFilters(); };
  $("#tabInmates").onclick = () => switchView("inmates");
  $("#tabPhotos").onclick = () => switchView("photos");

  $("#q").addEventListener("input", e => {
    $("#qClear").hidden = !e.target.value;
    clearTimeout(deb);
    deb = setTimeout(() => { state.q = e.target.value; applyFilters(); }, 200);
  });
  $("#qClear").onclick = () => {
    $("#q").value = ""; state.q = ""; $("#qClear").hidden = true; applyFilters(); $("#q").focus();
  };
  $("#sortSel").onchange = () => applyFilters();
  $("#sexSel").onchange = () => applyFilters();

  $("#mClose").onclick = closeModal;
  $("#lbClose").onclick = closeLightbox;
  $("#lbFile").onclick = () => {
    const pid = $("#lbFile").dataset.pid;
    closeLightbox();
    if (pid) openDetail(pid);
  };
  $("#modal").addEventListener("click", e => { if (e.target === $("#modal")) closeModal(); });
  $("#lightbox").addEventListener("click", e => { if (e.target === $("#lightbox")) closeLightbox(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if ($("#lightbox").style.display !== "none") closeLightbox();
      else closeModal();
    }
  });
  $("#grid").addEventListener("click", e => {
    const card = e.target.closest(".card");
    if (card) openDetail(card.dataset.pid);
  });
  $("#photogrid").addEventListener("click", e => {
    const tile = e.target.closest(".ptile");
    if (tile) { $("#lbFile").dataset.pid = tile.dataset.pid; openLightbox(tile.dataset.pid); }
  });

  /* sticky toolbar elevation */
  const tb = $("#toolbar");
  const onScroll = () => tb.classList.toggle("elev", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
