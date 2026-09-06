/* Starr County Jail Roster — live lookup app.
   Loads data.json (mirrored hourly from the county's public Webjail API by
   GitHub Actions) from the same origin — no CORS relay, no runtime county
   calls. Two views: inmate cards + photo grid; each inmate file shows
   charges up top. See tools/mirror.py. */
"use strict";

const L = {
  en: {
    title: "Starr County Jail", hsub: "Inmate roster · Rio Grande City, TX",
    eyebrow: "Starr County · Texas",
    subtitle: "Live inmate & booking lookup — Rio Grande City, TX",
    liveLabel: "Live",
    statusInit: "Loading roster…",
    statusOk: n => `${n} in custody`,
    statusErr: "Couldn't load the roster. The mirror updates hourly — try again in a moment.",
    retry: "Try again", searchPh: "Search name, booking # or charge…",
    noResults: "No inmates match your search.",
    sortNewest: "Newest booking", sortName: "Name A–Z", sortDate: "Booked date",
    sortOldest: "Oldest first", sortYoungest: "Youngest first",
    sortHeaviest: "Heaviest first", sortLightest: "Lightest first",
    sortTallest: "Tallest first", sortShortest: "Shortest first",
    sexAll: "Men & women", sexMen: "Men", sexWomen: "Women",
    sumCustody: n => `In custody: ${n}`, sumMen: n => `Men: ${n}`,
    sumWomen: n => `Women: ${n}`, sumPhotos: n => `Photos: ${n}`,
    updatedAgo: m => m < 60 ? `Updated ${m}m ago` : `Updated ${Math.floor(m / 60)}h ${m % 60}m ago`,
    booked: "Booked", withheld: "Photo withheld",
    charges: "Charges", charge: "Charge", bond: "Bond", denied: "Bond denied", level: "Level",
    agency: "Agency", arrested: "Arrested", dob: "DOB", gender: "Gender", race: "Race",
    height: "Height", weight: "Weight", booking: "Booking", subject: "Subject",
    eye: "Eyes", hair: "Hair",
    noCharges: "No charges listed.", totalBond: "Total bond", stay: "In custody since",
    tabInmates: "Inmates", tabPhotos: "Photos", viewFile: "View file",
    photosOf: n => `${n} photos`,
    footTitle: "About this site",
    footData: "Data is mirrored every hour from the Starr County jail system's public Webjail feed. Released inmates are removed from the feed automatically, so they disappear from this roster too.",
    footNote: "Not an official county website. Verify with the Starr County Sheriff's Office at (956) 487-5571 before acting on this information.",
    live: "Hourly mirror · updated"
  },
  es: {
    title: "Cárcel del Condado de Starr", hsub: "Lista de presos · Rio Grande City, TX",
    eyebrow: "Condado de Starr · Texas",
    subtitle: "Consulta de presos e ingresos en vivo — Rio Grande City, TX",
    liveLabel: "En vivo",
    statusInit: "Cargando lista…",
    statusOk: n => `${n} en custodia`,
    statusErr: "No se pudo cargar la lista. El espejo se actualiza cada hora — intenta de nuevo en un momento.",
    retry: "Reintentar", searchPh: "Buscar nombre, # de ingreso o cargo…",
    noResults: "Ningún preso coincide con tu búsqueda.",
    sortNewest: "Ingreso más reciente", sortName: "Nombre A–Z", sortDate: "Fecha de ingreso",
    sortOldest: "Mayores primero", sortYoungest: "Menores primero",
    sortHeaviest: "Más pesados primero", sortLightest: "Más ligeros primero",
    sortTallest: "Más altos primero", sortShortest: "Más bajos primero",
    sexAll: "Hombres y mujeres", sexMen: "Hombres", sexWomen: "Mujeres",
    sumCustody: n => `En custodia: ${n}`, sumMen: n => `Hombres: ${n}`,
    sumWomen: n => `Mujeres: ${n}`, sumPhotos: n => `Fotos: ${n}`,
    updatedAgo: m => m < 60 ? `Actualizado hace ${m} min` : `Actualizado hace ${Math.floor(m / 60)}h ${m % 60} min`,
    booked: "Ingresado", withheld: "Foto no publicada",
    charges: "Cargos", charge: "Cargo", bond: "Fianza", denied: "Fianza denegada", level: "Nivel",
    agency: "Agencia", arrested: "Arrestado", dob: "Nacimiento", gender: "Género", race: "Raza",
    height: "Estatura", weight: "Peso", booking: "Ingreso", subject: "Sujeto",
    eye: "Ojos", hair: "Cabello",
    noCharges: "No hay cargos registrados.", totalBond: "Fianza total", stay: "En custodia desde",
    tabInmates: "Presos", tabPhotos: "Fotos", viewFile: "Ver ficha",
    photosOf: n => `${n} fotos`,
    footTitle: "Acerca de este sitio",
    footData: "Los datos se reflejan cada hora desde el sistema público Webjail del condado de Starr. Los liberados se eliminan automáticamente del sistema, así que desaparecen de esta lista también.",
    footNote: "Este no es un sitio oficial del condado. Verifica con la Oficina del Sheriff del Condado de Starr al (956) 487-5571 antes de actuar con esta información.",
    live: "Espejo horario · actualizado"
  }
};
let lang = (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
const t = k => typeof L[lang][k] === "function" ? L[lang][k] : L[lang][k] || k;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const state = { records: [], loadedAt: null, q: "", err: false, view: "inmates" };

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
  s.className = "av";
  s.textContent = img.dataset.init || "—";
  s.setAttribute("aria-hidden", "true");
  img.replaceWith(s);
}
function parseDate(s) {
  if (s == null || s === "") return null;
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { y: m[1], mo, d };
    return null; // sentinel dates like 0000-00-00 -> unknown
  }
  const t = new Date(s);
  if (!isNaN(t)) return { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate() };
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
  if (!ch.some(c => c.bond != null && c.bond !== "")) return null;  // no bonds set
  return ch.reduce((s, c) => s + (Number(c.bond) || 0), 0);
}

/* ---------- data (same-origin mirror) ---------- */
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
    let p = $("#progress");
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

/* ---------- filtering / sorting (client-side; API has no search) ---------- */
function haystack(r) {
  return (nameOf(r) + " " + (r.bookingID || "") + " " + (r.ptsBookingID ?? "") + " " + chargeText(r)).toLowerCase();
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

/* ---------- rendering ---------- */
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
  if (tb && !tb.querySelector(".phcount")) tb.appendChild(Object.assign(document.createElement("span"), { className: "phcount" }));
  const c = tb.querySelector(".phcount");
  if (c) c.textContent = ` (${photos})`;
  const men = state.records.filter(r => (r.gender || "").toUpperCase() === "MALE").length;
  const women = state.records.length - men;
  const set = (id, fn, n) => { const el = $(id); if (el) el.textContent = fn(n); };
  set("#sumCustody", t("sumCustody"), state.records.length);
  set("#sumMen", t("sumMen"), men);
  set("#sumWomen", t("sumWomen"), women);
  set("#sumPhotos", t("sumPhotos"), photos);
}
function renderCards(list) {
  $("#photogrid").style.display = "none";
  $("#grid").style.display = "grid";
  $("#grid").innerHTML = list.map(cardHTML).join("") ||
    `<div class="empty" style="display:block"><p>${esc(t("noResults"))}</p></div>`;
}
function cardHTML(r) {
  const a = age(r.dob);
  const init = initials(nameOf(r));
  const thumb = r.img && r.imgPub !== false
    ? `<img class="thumb" loading="lazy" src="${esc(r.img)}" data-init="${esc(init)}" alt="Mugshot of ${esc(nameOf(r))}" onerror="avFail(this)">`
    : `<span class="av" aria-hidden="true">${esc(init)}</span>`;
  const ch = r.charges || [];
  const chLine = ch.length
    ? `<span class="cmeta chg"><span>${esc(t("charges"))}: ${ch.length}</span>` +
      (ch[0].desc ? `<span class="ellip">${esc(ch[0].desc)}${ch.length > 1 ? " +" + (ch.length - 1) : ""}</span>` : "") + `</span>`
    : `<span class="cmeta chg">${esc(t("noCharges"))}</span>`;
  return `<button type="button" class="card" data-pid="${esc(r.ptsBookingID)}">
    ${thumb}
    <div class="cbody">
      <span class="cname">${esc(nameOf(r))}</span>
      <span class="cmeta">
        <span>#${esc(r.bookingID)}</span>
        <span>· ${esc(t("booked"))} ${esc(dateOnly(r.booked))}</span>
        ${a != null ? `<span>· ${a} ${lang === "es" ? "años" : "yrs"}</span>` : ""}
      </span>
      ${chLine}
      <span class="cmeta">${esc(r.gender || "")}${r.race ? " · " + esc(r.race) : ""}
        ${r.imgPub === false ? `<span class="badge withheld">${esc(t("withheld"))}</span>` : ""}</span>
    </div>
  </button>`;
}
function renderPhotos(list) {
  $("#grid").style.display = "none";
  $("#photogrid").style.display = "grid";
  $("#photogrid").innerHTML = list.length ? list.map(p => `
    <button type="button" class="ptile" data-pid="${esc(p.ptsBookingID)}" title="${esc(nameOf(p))}">
      <img loading="lazy" src="${esc(p.img)}" alt="Mugshot of ${esc(nameOf(p))}">
    </button>`).join("") : "";
}
function skeletons(n) {
  $("#grid").style.display = "grid";
  $("#photogrid").style.display = "none";
  $("#grid").innerHTML = Array.from({ length: n },
    () => `<div class="skel"><div class="b"></div></div>`).join("");
}

/* ---------- status ---------- */
function setStatus(kind, n, cls) {
  const fn = L[lang][kind];
  $("#statusText").textContent = typeof fn === "function" ? fn(n) : fn || kind;
  $("#statusDot").className = "dot" + (cls ? " " + cls : "");
}

/* ---------- views ---------- */
function switchView(v) {
  state.view = v;
  $("#tabInmates").classList.toggle("active", v === "inmates");
  $("#tabPhotos").classList.toggle("active", v === "photos");
  applyFilters();
}

/* ---------- detail modal (the inmate file) ---------- */
function openDetail(pid) {
  const r = state.records.find(x => String(x.ptsBookingID) === String(pid));
  if (!r) return;
  const a = age(r.dob);
  const img = r.img && r.imgPub !== false;
  $("#mImg").hidden = !img;
  if (img) { $("#mImg").src = r.img; $("#mImg").onerror = () => { $("#mImg").hidden = true; }; }
  $("#mName").textContent = nameOf(r);
  const meta = [`#${r.bookingID}`, `${t("booked")} ${dateOnly(r.booked)}`,
    r.gender && r.race ? `${r.gender} · ${r.race}` : (r.gender || r.race || "")].filter(Boolean).join(" · ");
  $("#mMeta").textContent = meta;

  const ch = r.charges || [];
  const tb = totalBond(r);
  const chHead = `<div class="srow"><span><b>${esc(t("charges"))} (${ch.length})</b></span>` +
    (tb != null ? `<b class="bondtot">${esc(t("totalBond"))}: ${money(tb)}</b>` : `<b>—</b>`) + `</div>`;
  $("#mBody").innerHTML = chHead +
    `<div class="charges">` +
    (ch.length ? ch.map(o => {
      const b = money(o.bond);
      return `<div class="charge"><div class="d">${esc(o.desc || "—")}</div>
        <div class="x">
          ${o.level ? `<span>${esc(t("level"))}: ${esc(o.level)}</span>` : ""}
          ${b ? `<span>${esc(t("bond"))}: ${b}</span>` : ""}
          ${o.denied ? `<span class="denied">${esc(t("denied"))}</span>` : ""}
          ${o.agency ? `<span>${esc(o.agency)}</span>` : ""}
          ${o.arrested ? `<span>${esc(t("arrested"))} ${esc(dateOnly(o.arrested))}</span>` : ""}
        </div></div>`;
    }).join("") : `<span class="mut">${esc(t("noCharges"))}</span>`) +
    `</div>` +
    `<div class="dets">
      ${a != null ? row(t("dob"), `${dateOnly(r.dob)} (${a})`) : ""}
      ${r.height ? row(t("height"), esc(r.height)) : ""}
      ${r.weight != null ? row(t("weight"), r.weight + " lbs") : ""}
      ${r.eye ? row(t("eye"), esc(r.eye)) : ""}
      ${r.hair ? row(t("hair"), esc(r.hair)) : ""}
      ${row(t("booking"), esc(r.bookingID))}
      ${r.ptsSubjectID != null ? row(t("subject"), r.ptsSubjectID) : ""}
    </div>`;
  $("#modal").style.display = "flex";
  document.body.style.overflow = "hidden";
}
function row(k, v) { return `<div class="srow"><span>${esc(k)}</span><b>${v}</b></div>`; }
function closeModal() {
  $("#modal").style.display = "none";
  document.body.style.overflow = "";
}

/* ---------- lightbox (photo view) ---------- */
function openLightbox(pid) {
  const r = state.records.find(x => String(x.ptsBookingID) === String(pid));
  if (!r || !r.img) return;
  $("#lbImg").src = r.img;
  $("#lbName").textContent = nameOf(r);
  const a = age(r.dob);
  $("#lbMeta").textContent = `#${r.bookingID} · ${t("booked")} ${dateOnly(r.booked)}` +
    (a != null ? ` · ${a} ${lang === "es" ? "años" : "yrs"}` : "") +
    ` · ${esc(t("charges"))}: ${(r.charges || []).length}`;
  $("#lightbox").style.display = "flex";
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  $("#lightbox").style.display = "none";
  document.body.style.overflow = "";
}

/* ---------- i18n ---------- */
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
  updateCounts();
}

/* ---------- init ---------- */
let deb;
function init() {
  applyLang();
  load();
  setInterval(tickClock, 60000);

  $("#langBtn").onclick = () => { lang = lang === "en" ? "es" : "en"; applyLang(); applyFilters(); };
  $("#tabInmates").onclick = () => switchView("inmates");
  $("#tabPhotos").onclick = () => switchView("photos");
  $("#q").addEventListener("input", e => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.q = e.target.value; applyFilters(); }, 200);
  });
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
    if (tile) {
      $("#lbFile").dataset.pid = tile.dataset.pid;
      openLightbox(tile.dataset.pid);
    }
  });
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
