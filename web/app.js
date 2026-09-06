/* Starr County Jail Roster — live lookup app.
   Queries the county's public Webjail API directly from the browser (CORS *).
   Note: the API only honors $limit/$skip/$sort — field filters are ignored,
   so search/sort happen client-side after paging through the roster. */
"use strict";

const API = "http://64.225.20.254:3030";   // plain HTTP endpoint (see docs/)
const PAGE = 12;                            // ~3-4 MB per page incl. mugshots
const L = {
  en: {
    title: "Starr County Jail Roster", subtitle: "Live inmate & booking lookup — Rio Grande City, TX",
    statusInit: "Connecting to the county feed…", statusLoading: n => `Loading roster… (${n} loaded)`,
    statusOk: n => `${n} in custody — county feed updates hourly`,
    statusErr: "Can't reach the county feed right now.",
    retry: "Try again", searchPh: "Search name or booking #…", loadMore: "Load more",
    noResults: "No inmates match your search.",
    sortNewest: "Newest booking", sortName: "Name A–Z", sortDate: "Booked date",
    booked: "Booked", charges: n => `Charges: ${n}`, withheld: "Photo withheld",
    detailCharges: "Charges", bond: "Bond", denied: "Bond denied", level: "Level",
    agency: "Agency", arrested: "Arrested", dob: "DOB", gender: "Gender", race: "Race",
    height: "Height", weight: "Weight", booking: "Booking", subject: "Subject",
    noCharges: "No charges listed.", loadingCharges: "Loading charges…", retryLoad: "Retry",
    footTitle: "About this site",
    footData: "Roster data comes directly from the Starr County jail system's public Webjail feed (updated hourly by the county). Released inmates are removed from the feed automatically.",
    footNote: "Not an official county website. Verify with the Starr County Sheriff's Office at (956) 487-5571 before acting on this information.",
    footApi: "Data API", viewCode: "View code", close: "Close",
    stay: "In custody since"
  },
  es: {
    title: "Lista de Presos — Condado de Starr", subtitle: "Consulta de presos e ingresos en vivo — Rio Grande City, TX",
    statusInit: "Conectando con el sistema del condado…", statusLoading: n => `Cargando lista… (${n} cargados)`,
    statusOk: n => `${n} en custodia — el sistema del condado se actualiza cada hora`,
    statusErr: "No se puede conectar con el sistema del condado.",
    retry: "Reintentar", searchPh: "Buscar nombre o # de ingreso…", loadMore: "Cargar más",
    noResults: "Ningún preso coincide con tu búsqueda.",
    sortNewest: "Ingreso más reciente", sortName: "Nombre A–Z", sortDate: "Fecha de ingreso",
    booked: "Ingresado", charges: n => `Cargos: ${n}`, withheld: "Foto no publicada",
    detailCharges: "Cargos", bond: "Fianza", denied: "Fianza denegada", level: "Nivel",
    agency: "Agencia", arrested: "Arrestado", dob: "Nacimiento", gender: "Género", race: "Raza",
    height: "Estatura", weight: "Peso", booking: "Ingreso", subject: "Sujeto",
    noCharges: "No hay cargos registrados.", loadingCharges: "Cargando cargos…", retryLoad: "Reintentar",
    footTitle: "Acerca de este sitio",
    footData: "Los datos provienen directamente del sistema público Webjail del condado de Starr (actualizado cada hora por el condado). Los liberados se eliminan automáticamente del sistema.",
    footNote: "Este no es un sitio oficial del condado. Verifica con la Oficina del Sheriff del Condado de Starr al (956) 487-5571 antes de actuar con esta información.",
    footApi: "API de datos", viewCode: "Ver código", close: "Cerrar",
    stay: "En custodia desde"
  }
};
let lang = (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
const t = k => (typeof L[lang][k] === "function" ? L[lang][k] : L[lang][k] || k);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const state = { records: [], total: 0, loaded: 0, loading: false, done: false, q: "" };

function nameOf(r) { return [r.FirstName, r.MiddleName, r.LastName].filter(Boolean).join(" "); }
function dateOnly(s) { s = String(s || ""); return s.length >= 10 && s[4] === "-" ? `${s[5]}/${s[8]}/${s.slice(0,4)}` : s.slice(0, 10) || "—"; }
function age(dob) {
  if (!dob) return null;
  const d = new Date(dob); const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return Number.isFinite(a) && a >= 0 ? a : null;
}
function money(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? "$" + n.toLocaleString("en-US") : null;
}
function mugUrl(r) {
  let b64 = r.MugShotFileStream;
  if (!b64) return null;
  if (b64.startsWith("data:")) b64 = b64.slice(b64.indexOf(",") + 1);
  const kind = /^iVBOR/i.test(b64) ? "png" : "jpeg";
  return `data:image/${kind};base64,${b64}`;
}

/* ---------- data ---------- */
async function fetchPage(skip) {
  const url = `${API}/inmates?$limit=${PAGE}&$skip=${skip}&$sort[BookingID]=-1`;
  const res = await fetch(url, { headers: { "User-Agent": "starr-roster-web/1.0" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
async function loadMore(auto) {
  if (state.loading || state.done) return;
  state.loading = true;
  setStatus(state.total ? "statusLoading" : "statusInit", state.loaded, "busy");
  try {
    const d = await fetchPage(state.loaded);
    state.total = d.total;
    state.records.push(...d.data);
    state.loaded = state.records.length;
    if (d.data.length < PAGE) state.done = true;
    applyFilters();
  } catch (e) {
    if (auto && state.records.length) { /* keep what we have */ }
    setStatus("statusErr", 0, "err");
    showRetry();
  } finally {
    state.loading = false;
  }
}

/* ---------- rendering ---------- */
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = state.records;
  if (q) list = list.filter(r =>
    (nameOf(r) + " " + (r.BookingID || "") + " " + (r.ptsBookingID ?? "")).toLowerCase().includes(q));
  const sort = $("#sortSel").value;
  const sorter = {
    newest: (a, b) => String(b.BookingID || "").localeCompare(String(a.BookingID || "")),
    name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
    date: (a, b) => String(b.BookingDate || "").localeCompare(String(a.BookingDate || ""))
  }[sort] || (() => 0);
  return list.slice().sort(sorter);
}
function applyFilters() {
  const list = filtered();
  $("#empty").style.display = list.length ? "none" : "block";
  render(list);
  $("#moreBtn").style.display = state.done || state.q.trim() ? "none" : "block";
  $("#moreBtn").textContent = state.loaded < state.total
    ? t("loadMore") + ` (${state.loaded}/${state.total})` : t("loadMore");
  if (!state.done && !state.q.trim() && list.length < 40) loadMore(true); // auto-fill first screens
}
function cardHTML(r) {
  const img = r.PublishImageToWebjail !== false ? mugUrl(r) : null;
  const a = age(r.DOB);
  const thumb = img
    ? `<img class="thumb" loading="lazy" src="${img}" alt="Mugshot of ${esc(nameOf(r))}">`
    : `<span class="av">👤</span>`;
  const badge = r.PublishImageToWebjail === false
    ? `<span class="badge withheld">${esc(t("withheld"))}</span>` : "";
  return `<button type="button" class="card" data-pid="${esc(r.ptsBookingID)}">
    ${thumb}
    <div class="cbody">
      <span class="cname">${esc(nameOf(r))}</span>
      <span class="cmeta">
        <span>#${esc(r.BookingID)}</span>
        <span>· ${esc(t("booked"))} ${esc(dateOnly(r.BookingDate))}</span>
        ${a != null ? `<span>· ${a} ${lang === "es" ? "años" : "yrs"}</span>` : ""}
      </span>
      <span class="cmeta">${esc(r.Gender || "")}${r.Race ? " · " + esc(r.Race) : ""}${badge}</span>
    </div>
  </button>`;
}
function render(list) {
  const g = $("#grid");
  g.innerHTML = list.map(cardHTML).join("") ||
    `<div class="empty" style="display:block"><p>${esc(t("noResults"))}</p></div>`;
}
function skeletons(n) {
  $("#grid").innerHTML = Array.from({ length: n },
    () => `<div class="skel"><div class="b"></div></div>`).join("");
}

/* ---------- status ---------- */
function setStatus(kind, n, cls) {
  const el = $("#statusText");
  const fn = L[lang][kind];
  el.textContent = typeof fn === "function" ? fn(n) : fn || kind;
  $("#statusDot").className = "dot" + (cls ? " " + cls : "");
}
function showRetry() {
  let p = $("#progress");
  p.innerHTML = `<button class="btn" id="retryBtn" type="button">↻ ${esc(t("retry"))}</button>`;
  $("#retryBtn").onclick = () => { p.innerHTML = ""; skeletons(6); loadMore(true); };
}

/* ---------- detail modal ---------- */
async function openDetail(pid) {
  const r = state.records.find(x => String(x.ptsBookingID) === String(pid));
  if (!r) return;
  const m = $("#modal");
  const img = r.PublishImageToWebjail !== false ? mugUrl(r) : null;
  const a = age(r.DOB);
  $("#mImg").hidden = !img;
  if (img) $("#mImg").src = img;
  $("#mName").textContent = nameOf(r);
  const meta = [`#${r.BookingID}`, `${t("booked")} ${dateOnly(r.BookingDate)}`,
    r.Gender && r.Race ? `${r.Gender} · ${r.Race}` : (r.Gender || r.Race || "")].filter(Boolean).join(" · ");
  $("#mMeta").textContent = meta;
  $("#mBody").innerHTML =
    row(t("stay"), dateOnly(r.BookingDate)) +
    (a != null ? row(t("dob"), `${dateOnly(r.DOB)} (${a})`) : "") +
    row(t("gender"), esc(r.Gender || "—")) +
    row(t("race"), esc(r.Race || "—")) +
    (r.Height ? row(t("height"), esc(r.Height)) : "") +
    (r.Weight ? row(t("weight"), r.Weight + " lbs") : "") +
    row(t("booking"), esc(r.BookingID)) +
    row(t("subject"), r.ptsSubjectID ?? "—") +
    `<div class="srow"><span>${esc(t("detailCharges"))}</span><b id="mChgCount">…</b></div>
     <div class="charges" id="mCharges"><span class="mut">${esc(t("loadingCharges"))}</span></div>`;
  m.style.display = "flex";
  document.body.style.overflow = "hidden";
  loadCharges(pid);
}
function row(k, v) { return `<div class="srow"><span>${esc(k)}</span><b>${v}</b></div>`; }
async function loadCharges(pid) {
  try {
    const res = await fetch(`${API}/inmate-detail/${pid}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    const offs = d.offences || [];
    $("#mChgCount").textContent = offs.length;
    $("#mCharges").innerHTML = offs.length
      ? offs.map(o => {
          const b = money(o.BondAmount);
          return `<div class="charge"><div class="d">${esc(o.StatuteDescription || "—")}</div>
            <div class="x">
              ${o.StatuteLevel ? `<span>${esc(t("level"))}: ${esc(o.StatuteLevel)}</span>` : ""}
              ${b ? `<span>${esc(t("bond"))}: ${b}</span>` : ""}
              ${o.IsBondDenied ? `<span class="denied">${esc(t("denied"))}</span>` : ""}
              ${o.ArrestingAgency ? `<span>${esc(o.ArrestingAgency)}</span>` : ""}
              ${o.ArrestDate ? `<span>${esc(t("arrested"))} ${esc(dateOnly(o.ArrestDate))}</span>` : ""}
            </div></div>`;
        }).join("")
      : `<span class="mut">${esc(t("noCharges"))}</span>`;
  } catch (e) {
    $("#mCharges").innerHTML = `<button class="btn" type="button" onclick="loadCharges('${pid}')">↻ ${esc(t("retryLoad"))}</button>`;
  }
}

/* ---------- i18n ---------- */
function applyLang() {
  document.documentElement.lang = lang;
  $("#langBtn").textContent = lang === "en" ? "ES" : "EN";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const k = el.dataset.i18n;
    if (L[lang][k]) el.textContent = L[lang][k];
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    const k = el.dataset.i18nPh;
    if (L[lang][k]) el.placeholder = L[lang][k];
  });
}

/* ---------- init ---------- */
let deb;
function init() {
  $("#apiUrl").textContent = API;
  applyLang();
  skeletons(6);
  loadMore(true);

  $("#langBtn").onclick = () => { lang = lang === "en" ? "es" : "en"; applyLang(); applyFilters(); };
  $("#q").addEventListener("input", e => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.q = e.target.value; applyFilters(); }, 250);
  });
  $("#sortSel").onchange = () => applyFilters();
  $("#moreBtn").onclick = () => { skeletons(3); loadMore(true); };
  $("#mClose").onclick = closeModal;
  $("#modal").addEventListener("click", e => { if (e.target === $("#modal")) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
  $("#grid").addEventListener("click", e => {
    const card = e.target.closest(".card");
    if (card) openDetail(card.dataset.pid);
  });
}
function closeModal() {
  $("#modal").style.display = "none";
  document.body.style.overflow = "";
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
