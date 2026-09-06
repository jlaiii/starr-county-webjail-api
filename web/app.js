/* Starr County Jail Roster — live lookup app.
   Loads data.json (mirrored hourly from the county's public Webjail API by
   GitHub Actions) from the same origin — no CORS relay, no runtime county
   calls. Mugshots are individual files loaded lazily. See tools/mirror.py. */
"use strict";

const L = {
  en: {
    title: "Starr County Jail Roster", subtitle: "Live inmate & booking lookup — Rio Grande City, TX",
    statusInit: "Loading roster…",
    statusOk: n => `${n} in custody`,
    statusErr: "Couldn't load the roster. The mirror updates hourly — try again in a moment.",
    retry: "Try again", searchPh: "Search name or booking #…",
    noResults: "No inmates match your search.",
    sortNewest: "Newest booking", sortName: "Name A–Z", sortDate: "Booked date",
    updatedAgo: m => m < 60 ? `Updated ${m}m ago` : `Updated ${Math.floor(m / 60)}h ${m % 60}m ago`,
    booked: "Booked", withheld: "Photo withheld",
    charges: "Charges", bond: "Bond", denied: "Bond denied", level: "Level",
    agency: "Agency", arrested: "Arrested", dob: "DOB", gender: "Gender", race: "Race",
    height: "Height", weight: "Weight", booking: "Booking", subject: "Subject",
    noCharges: "No charges listed.", stay: "In custody since",
    footTitle: "About this site",
    footData: "Data is mirrored every hour from the Starr County jail system's public Webjail feed. Released inmates are removed from the feed automatically, so they disappear from this roster too.",
    footNote: "Not an official county website. Verify with the Starr County Sheriff's Office at (956) 487-5571 before acting on this information.",
    viewCode: "View code", close: "Close", live: "Hourly mirror · updated"
  },
  es: {
    title: "Lista de Presos — Condado de Starr", subtitle: "Consulta de presos e ingresos en vivo — Rio Grande City, TX",
    statusInit: "Cargando lista…",
    statusOk: n => `${n} en custodia`,
    statusErr: "No se pudo cargar la lista. El espejo se actualiza cada hora — intenta de nuevo en un momento.",
    retry: "Reintentar", searchPh: "Buscar nombre o # de ingreso…",
    noResults: "Ningún preso coincide con tu búsqueda.",
    sortNewest: "Ingreso más reciente", sortName: "Nombre A–Z", sortDate: "Fecha de ingreso",
    updatedAgo: m => m < 60 ? `Actualizado hace ${m} min` : `Actualizado hace ${Math.floor(m / 60)}h ${m % 60} min`,
    booked: "Ingresado", withheld: "Foto no publicada",
    charges: "Cargos", bond: "Fianza", denied: "Fianza denegada", level: "Nivel",
    agency: "Agencia", arrested: "Arrestado", dob: "Nacimiento", gender: "Género", race: "Raza",
    height: "Estatura", weight: "Peso", booking: "Ingreso", subject: "Sujeto",
    noCharges: "No hay cargos registrados.", stay: "En custodia desde",
    footTitle: "Acerca de este sitio",
    footData: "Los datos se reflejan cada hora desde el sistema público Webjail del condado de Starr. Los liberados se eliminan automáticamente del sistema, así que desaparecen de esta lista también.",
    footNote: "Este no es un sitio oficial del condado. Verifica con la Oficina del Sheriff del Condado de Starr al (956) 487-5571 antes de actuar con esta información.",
    viewCode: "Ver código", close: "Cerrar", live: "Espejo horario · actualizado"
  }
};
let lang = (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
const t = k => typeof L[lang][k] === "function" ? L[lang][k] : L[lang][k] || k;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const state = { records: [], loadedAt: null, q: "", err: false };

function nameOf(r) { return r.name || [r.FirstName, r.MiddleName, r.LastName].filter(Boolean).join(" "); }
function dateOnly(s) { s = String(s || ""); return s.length >= 10 && s[4] === "-" ? `${s[5]}/${s[8]}/${s.slice(0, 4)}` : s.slice(0, 10) || "—"; }
function age(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return Number.isFinite(a) && a >= 0 ? a : null;
}
function money(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? "$" + n.toLocaleString("en-US") : null;
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
    p.innerHTML = `<button class="btn" id="retryBtn" type="button">↻ ${esc(t("retry"))}</button>`;
    $("#retryBtn").onclick = () => { p.innerHTML = ""; load(); };
  }
}
function tickClock() {
  if (!state.loadedAt) return;
  const m = Math.max(0, Math.round((Date.now() - state.loadedAt.getTime()) / 60000));
  const el = $("#updated");
  if (el) el.textContent = `${t("live")} ${t("updatedAgo")(m)}`;
}

/* ---------- rendering ---------- */
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = state.records;
  if (q) list = list.filter(r =>
    (nameOf(r) + " " + (r.bookingID || "") + " " + (r.ptsBookingID ?? "")).toLowerCase().includes(q));
  const sort = $("#sortSel").value;
  const sorter = {
    newest: (a, b) => String(b.bookingID || "").localeCompare(String(a.bookingID || "")),
    name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
    date: (a, b) => String(b.booked || "").localeCompare(String(a.booked || ""))
  }[sort] || (() => 0);
  return list.slice().sort(sorter);
}
function applyFilters() {
  const list = filtered();
  $("#empty").style.display = list.length ? "none" : "block";
  render(list);
  setStatus("statusOk", state.records.length, "ok");
  tickClock();
}
function cardHTML(r) {
  const a = age(r.dob);
  const thumb = r.img
    ? `<img class="thumb" loading="lazy" src="${esc(r.img)}" alt="Mugshot of ${esc(nameOf(r))}" onerror="this.outerHTML='<span class=&quot;av&quot;>👤</span>'">`
    : `<span class="av">👤</span>`;
  const badge = r.imgPub === false ? `<span class="badge withheld">${esc(t("withheld"))}</span>` : "";
  return `<button type="button" class="card" data-pid="${esc(r.ptsBookingID)}">
    ${thumb}
    <div class="cbody">
      <span class="cname">${esc(nameOf(r))}</span>
      <span class="cmeta">
        <span>#${esc(r.bookingID)}</span>
        <span>· ${esc(t("booked"))} ${esc(dateOnly(r.booked))}</span>
        ${a != null ? `<span>· ${a} ${lang === "es" ? "años" : "yrs"}</span>` : ""}
      </span>
      <span class="cmeta">${esc(r.gender || "")}${r.race ? " · " + esc(r.race) : ""}${badge}</span>
    </div>
  </button>`;
}
function render(list) {
  $("#grid").innerHTML = list.map(cardHTML).join("") ||
    `<div class="empty" style="display:block"><p>${esc(t("noResults"))}</p></div>`;
}
function skeletons(n) {
  $("#grid").innerHTML = Array.from({ length: n },
    () => `<div class="skel"><div class="b"></div></div>`).join("");
}

/* ---------- status ---------- */
function setStatus(kind, n, cls) {
  const fn = L[lang][kind];
  $("#statusText").textContent = typeof fn === "function" ? fn(n) : fn || kind;
  $("#statusDot").className = "dot" + (cls ? " " + cls : "");
}

/* ---------- detail modal ---------- */
function openDetail(pid) {
  const r = state.records.find(x => String(x.ptsBookingID) === String(pid));
  if (!r) return;
  const a = age(r.dob);
  const img = r.img && r.imgPub !== false;
  $("#mImg").hidden = !img;
  if (img) $("#mImg").src = r.img;
  $("#mName").textContent = nameOf(r);
  const meta = [`#${r.bookingID}`, `${t("booked")} ${dateOnly(r.booked)}`,
    r.gender && r.race ? `${r.gender} · ${r.race}` : (r.gender || r.race || "")].filter(Boolean).join(" · ");
  $("#mMeta").textContent = meta;
  const ch = r.charges || [];
  $("#mBody").innerHTML =
    row(t("stay"), dateOnly(r.booked)) +
    (a != null ? row(t("dob"), `${dateOnly(r.dob)} (${a})`) : "") +
    row(t("gender"), esc(r.gender || "—")) +
    row(t("race"), esc(r.race || "—")) +
    (r.height ? row(t("height"), esc(r.height)) : "") +
    (r.weight != null ? row(t("weight"), r.weight + " lbs") : "") +
    row(t("booking"), esc(r.bookingID)) +
    (r.ptsSubjectID != null ? row(t("subject"), r.ptsSubjectID) : "") +
    `<div class="srow"><span>${esc(t("charges"))}</span><b>${ch.length}</b></div>
     <div class="charges">` +
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
    `</div>`;
  $("#modal").style.display = "flex";
  document.body.style.overflow = "hidden";
}
function row(k, v) { return `<div class="srow"><span>${esc(k)}</span><b>${v}</b></div>`; }
function closeModal() {
  $("#modal").style.display = "none";
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
}

/* ---------- init ---------- */
let deb;
function init() {
  applyLang();
  load();
  setInterval(tickClock, 60000);

  $("#langBtn").onclick = () => { lang = lang === "en" ? "es" : "en"; applyLang(); applyFilters(); };
  $("#q").addEventListener("input", e => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.q = e.target.value; applyFilters(); }, 200);
  });
  $("#sortSel").onchange = () => applyFilters();
  $("#mClose").onclick = closeModal;
  $("#modal").addEventListener("click", e => { if (e.target === $("#modal")) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
  $("#grid").addEventListener("click", e => {
    const card = e.target.closest(".card");
    if (card) openDetail(card.dataset.pid);
  });
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
