// ========================================
// ✅ CONFIG
// ========================================
const TMDB_API_KEY = "f5898fe633ec69bab2e05af48377b03f";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTNC9_Lvn8uqzJZafLxTuxvo5JfaGAB5miWbYnRQ29Xhp93W9VBGlJfF2nrd5yDwAuEy1TpAwv6TCIb/pub?gid=945797519&single=true&output=csv";

// ✅ TES INFOS SUPABASE
const SUPABASE_URL = "https://uilxmbqyelygrzeblzyk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PczgzrkJcm_aQ9Ovubz2Hg_Bzz8Ae5e";

const PLATFORM_PRIORITY = ["Netflix", "Disney+", "Prime", "Canal+", "Apple TV+"];

const supabaseClient =
  SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.startsWith("sb_")
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// ========================================
// ✅ CSV PARSER ROBUSTE
// ========================================
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (c === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }

    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && next === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += c;
  }

  row.push(cur);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

const clean = (s) => (s ?? "").toString().trim();

// ========================================
// ✅ PLATEFORMES
// ========================================
function normalizePlatformName(p) {
  const s = (p || "").toLowerCase().trim();
  if (!s) return "";

  if (s.includes("netflix")) return "Netflix";
  if (s.includes("disney")) return "Disney+";
  if (s.includes("prime")) return "Prime";
  if (s.includes("canal")) return "Canal+";
  if (s.includes("apple")) return "Apple TV+";

  return (p || "").trim();
}

function parsePlatformsCell(cell) {
  const raw = clean(cell);
  if (!raw) return [];
  return raw
    .split(/[|,;\/]+/g)
    .map((x) => normalizePlatformName(x))
    .filter(Boolean);
}

function uniquePlatforms(list) {
  const out = [];
  const seen = new Set();

  for (const p of list || []) {
    const n = normalizePlatformName(p);
    if (!n) continue;
    const k = n.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  }
  return out;
}

function sortPlatformsForUser(itemPlatforms, userSelectedPlatforms) {
  const plats = uniquePlatforms(itemPlatforms);
  const selected = uniquePlatforms(userSelectedPlatforms);

  const first = selected.filter((p) => plats.includes(p));
  const rest = plats
    .filter((p) => !first.includes(p))
    .sort((a, b) => {
      const ia = PLATFORM_PRIORITY.indexOf(a);
      const ib = PLATFORM_PRIORITY.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

  return [...first, ...rest];
}

function intersects(a, b) {
  const A = new Set(uniquePlatforms(a).map((x) => x.toLowerCase()));
  for (const x of uniquePlatforms(b)) {
    if (A.has(x.toLowerCase())) return true;
  }
  return false;
}

// ========================================
// ✅ CHARGEMENT BASE GOOGLE SHEET
// ========================================
let CONTENTS = [];

const CONTENTS_LOCAL_KEY = "contents_cache_v1";

async function loadSheetBase() {
  // 1. Essayer de charger depuis le cache localStorage
  const cached = localStorage.getItem(CONTENTS_LOCAL_KEY);
  if (cached) {
    try {
      CONTENTS = JSON.parse(cached);
      console.log("Base chargée depuis le cache local :", CONTENTS.length);
      return;
    } catch (e) {
      console.warn("Cache contents invalide, on recharge depuis Google Sheet");
    }
  }

  // 2. Sinon charger depuis Google Sheet
  console.time("Chargement Google Sheet");

  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  const text = await res.text();
  const rows = parseCSV(text);

  console.timeEnd("Chargement Google Sheet");

  const header = rows[0].map((h) => h.toLowerCase().trim());
  const idx = (name) => header.indexOf(name);

  const iTitle = idx("title");
  const iType = idx("type");
  const iMood = idx("mood");
  const iDuration = idx("duration");
  const iEnergy = idx("energy");
  const iPlatform = idx("platform");
  const iPlatforms = idx("platforms");

  CONTENTS = rows.slice(1).map((row) => {
    const platformsRaw =
      (iPlatforms !== -1 ? row[iPlatforms] : "") ||
      (iPlatform !== -1 ? row[iPlatform] : "");

    const platforms = parsePlatformsCell(platformsRaw);

    return {
      title: clean(row[iTitle]),
      type: clean(row[iType]),
      mood: clean(row[iMood]),
      duration: clean(row[iDuration]),
      energy: clean(row[iEnergy]),
      platforms,
      platform: platforms[0] || "",
    };
  });

  // 3. Sauvegarder dans le cache localStorage
  try {
    localStorage.setItem(CONTENTS_LOCAL_KEY, JSON.stringify(CONTENTS));
    console.log("Base sauvegardée en cache local :", CONTENTS.length);
  } catch (e) {
    console.warn("Impossible de sauvegarder CONTENTS en localStorage");
  }
}

// ========================================
// ✅ TMDB
// ========================================
const tmdbCache = new Map();

const TMDB_LOCAL_KEY = "tmdb_cache_v1";

function loadTmdbLocalCache() {
  try {
    const raw = localStorage.getItem(TMDB_LOCAL_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    Object.entries(obj).forEach(([k, v]) => {
      tmdbCache.set(k, v);
    });
  } catch (e) {
    console.warn("Impossible de charger le cache TMDB local", e);
  }
}

function saveTmdbLocalCache() {
  try {
    const obj = Object.fromEntries(tmdbCache.entries());
    localStorage.setItem(TMDB_LOCAL_KEY, JSON.stringify(obj));
    console.log("✅ Cache TMDB sauvegardé", Object.keys(obj).length);
  } catch (e) {
    console.warn("Impossible de sauvegarder le cache TMDB local", e);
  }
}

loadTmdbLocalCache();

function cacheKey(title, type) {
  return (type + "|" + title).toLowerCase();
}

function mediaTypeFromUserType(type) {
  const t = (type || "").toLowerCase();
  return t === "série" || t === "serie" ? "tv" : "movie";
}

function pickTrailerKey(list) {
  const trailer =
    list.find((v) => v.site === "YouTube" && v.type === "Trailer") ||
    list.find((v) => v.site === "YouTube" && v.type === "Teaser") ||
    list.find((v) => v.site === "YouTube");
  return trailer?.key || "";
}

async function fetchTrailerKey(media, id) {
  const langs = ["fr-FR", "en-US", ""];

  for (const lang of langs) {
    const vUrl =
      `https://api.themoviedb.org/3/${media}/${id}/videos` +
      `?api_key=${encodeURIComponent(TMDB_API_KEY)}` +
      (lang ? `&language=${encodeURIComponent(lang)}` : "");

    try {
      const vr = await fetch(vUrl);
      const vd = await vr.json();
      const key = pickTrailerKey(vd?.results || []);
      if (key) return key;
    } catch (_) {}
  }

  return "";
}

const TMDB_GENRE_MAP = {
  28: "Action",
  12: "Aventure",
  16: "Animation",
  35: "Comédie",
  80: "Crime",
  99: "Documentaire",
  18: "Drame",
  10751: "Famille",
  14: "Fantastique",
  36: "Histoire",
  27: "Horreur",
  10402: "Musique",
  9648: "Mystère",
  10749: "Romance",
  878: "Science-fiction",
  10770: "Téléfilm",
  53: "Thriller",
  10752: "Guerre",
  37: "Western",

  10759: "Action",
  10762: "Famille",
  10763: "Actualité",
  10764: "Télé-réalité",
  10765: "Science-fiction",
  10766: "Drame",
  10767: "Talk-show",
  10768: "Guerre"
};

function mapGenreIds(ids) {
  return (ids || [])
    .map(id => TMDB_GENRE_MAP[id])
    .filter(Boolean);
}

async function tmdbSearchLight(title, type) {
  const key = "light|" + cacheKey(title, type);
  if (tmdbCache.has(key)) return tmdbCache.get(key);

  const media = mediaTypeFromUserType(type);

  const searchUrl =
    `https://api.themoviedb.org/3/search/${media}` +
    `?api_key=${encodeURIComponent(TMDB_API_KEY)}` +
    `&language=fr-FR&query=${encodeURIComponent(title)}`;

  const r = await fetch(searchUrl);
  const data = await r.json();
  const first = data?.results?.[0];

  let genres = [];
  if (first?.genre_ids?.length) {
    genres = mapGenreIds(first.genre_ids);
  }

  const res = {
    id: first?.id || null,
    media,
    poster: first?.poster_path ? TMDB_IMG + first.poster_path : "",
    overview: first?.overview || "",
    genres,
    genre: genres[0] || "",
    trailerKey: ""
  };

  tmdbCache.set(key, res);
console.log("LIGHT ajouté au cache :", key);
saveTmdbLocalCache();
return res;
}

async function tmdbSearchFull(title, type) {
  const key = "full|" + cacheKey(title, type);
  if (tmdbCache.has(key)) return tmdbCache.get(key);

  const light = await tmdbSearchLight(title, type);

  let trailerKey = "";
  if (light.id) {
    trailerKey = await fetchTrailerKey(light.media, light.id);
  }

  const res = {
    ...light,
    trailerKey
  };

  tmdbCache.set(key, res);
console.log("FULL ajouté au cache :", key);
saveTmdbLocalCache();
return res;
}

function platformSearchUrl(platform, title) {
  const q = encodeURIComponent((title || "").trim());
  const p = (platform || "").toLowerCase();

  if (p.includes("netflix")) return `https://www.netflix.com/search?q=${q}`;
  if (p.includes("prime")) return `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`;
  if (p.includes("disney")) return `https://www.disneyplus.com/fr-fr/search?q=${q}`;
  if (p.includes("apple")) return `https://tv.apple.com/fr/search?term=${q}`;
  if (p.includes("canal")) {
    return `https://www.google.com/search?q=${encodeURIComponent(`site:canalplus.com ${title}`)}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(`${title} regarder streaming`)}`;
}

function youtubeSearchUrl(title, type) {
  const q = encodeURIComponent(`${title} ${type || ""} bande annonce`);
  return `https://www.youtube.com/results?search_query=${q}`;
}

// ========================================
// ✅ SUPABASE / AUTH / FAVORIS
// ========================================
let currentUser = null;
let favoriteKeys = new Set();
let favoriteRows = [];
let lastViewBeforeDetail = "results";

function hasSupabase() {
  return !!supabaseClient;
}

function contentKey(title, type) {
  return `${String(type || "").trim().toLowerCase()}||${String(title || "").trim().toLowerCase()}`;
}

function isFavorite(item) {
  return favoriteKeys.has(contentKey(item.title, item.type));
}

async function ensureProfile(user) {
  if (!hasSupabase() || !user) return;

  try {
    await supabaseClient.from("profiles").upsert({
      id: user.id,
      email: user.email || null,
    });
  } catch (e) {
    console.warn("Profile upsert error", e);
  }
}

async function loadFavorites() {
  if (!hasSupabase() || !currentUser) {
    favoriteKeys = new Set();
    favoriteRows = [];
    updateFavoriteButtons();
    return;
  }

  const { data, error } = await supabaseClient
    .from("favorites")
    .select("id, title, type, mood, duration, energy, platforms, poster, created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erreur chargement favoris", error);
    return;
  }

  favoriteRows = data || [];
  favoriteKeys = new Set(
    favoriteRows.map((row) => contentKey(row.title, row.type))
  );

  updateFavoriteButtons();
}

async function toggleFavorite(item) {
  if (!hasSupabase()) {
    alert("Configure Supabase dans le script.js avant d’utiliser les favoris.");
    return false;
  }

  if (!currentUser) {
    openAuthModal("Connecte-toi pour ajouter des favoris.");
    return false;
  }

  const key = contentKey(item.title, item.type);
  const already = favoriteKeys.has(key);

  if (already) {
    const { error } = await supabaseClient
      .from("favorites")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("title", item.title)
      .eq("type", item.type);

    if (error) {
      console.error("Erreur suppression favori :", error);
      alert("Impossible de retirer ce favori.");
      return false;
    }
  } else {
    let posterValue = null;
    try {
      const info = await tmdbSearchLight(item.title, item.type);
      posterValue = info.poster || null;
    } catch (_) {}

    const { error } = await supabaseClient
      .from("favorites")
      .insert({
        user_id: currentUser.id,
        title: item.title,
        type: item.type,
        mood: item.mood || null,
        duration: item.duration || null,
        energy: item.energy || null,
        platforms: (item.platforms || []).join("|") || null,
        poster: posterValue,
      });

    if (error) {
      console.error("Erreur ajout favori :", error);
      alert("Impossible d’ajouter ce favori.");
      return false;
    }
  }

  await loadFavorites();

  if (!favoritesSection.classList.contains("hidden")) {
    await renderFavoritesSection();
  }

  updateFavoriteButtons();
  return !already;
}

function getFavoritePreferenceProfile() {
  const favItems = CONTENTS.filter(item => isFavorite(item));
  if (!favItems.length) return null;

  const countMap = (values) => {
    const map = new Map();
    values.forEach(v => {
      if (!v) return;
      map.set(v, (map.get(v) || 0) + 1);
    });
    return map;
  };

  const pickTop = (map) =>
    [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const typeMap = countMap(favItems.map(i => i.type));
const moodMap = countMap(favItems.map(i => i.mood));
const durationMap = countMap(favItems.map(i => i.duration));
const energyMap = countMap(favItems.map(i => i.energy));
const genreMap = countMap(
  favItems.map(i => i.genre || "")
);

  const platformMap = new Map();
  favItems.forEach(item => {
    uniquePlatforms(item.platforms || []).forEach(p => {
      platformMap.set(p, (platformMap.get(p) || 0) + 1);
    });
  });

  return {
  favoriteType: pickTop(typeMap),
  favoriteMood: pickTop(moodMap),
  favoriteDuration: pickTop(durationMap),
  favoriteEnergy: pickTop(energyMap),
  favoriteGenre: pickTop(genreMap),
  favoritePlatforms: [...platformMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(x => x[0])
};
}

async function signUpWithEmail(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
  });
  return { data, error };
}

async function signInWithEmail(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

async function signOutUser() {
  if (!hasSupabase()) return;
  await supabaseClient.auth.signOut();
}

function setAuthMessage(msg, isError = false) {
  authMessage.textContent = msg || "";
  authMessage.style.color = isError ? "#ff9fae" : "rgba(255,247,239,.78)";
}

function openAuthModal(message = "") {
  setAuthMessage(message, false);
  show(authModal);
}

function closeAuthModal() {
  hide(authModal);
  setAuthMessage("");
}

function showLoginTab() {
  loginForm.classList.remove("hidden");
  signupForm.classList.add("hidden");
  showLoginTabBtn.classList.add("active");
  showSignupTabBtn.classList.remove("active");
  setAuthMessage("");
}

function showSignupTab() {
  signupForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
  showSignupTabBtn.classList.add("active");
  showLoginTabBtn.classList.remove("active");
  setAuthMessage("");
}

async function updateAuthUI() {
  if (currentUser) {
    userBadge.textContent = currentUser.email || "Connecté";
    userBadge.classList.remove("hidden");

    favoritesBtn.classList.remove("hidden");
    profileBtn.classList.remove("hidden");   
    surpriseBtn.classList.add("hidden");
    historyBtn.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");

    authBtn.classList.add("hidden");
  } else {
    userBadge.classList.add("hidden");

    favoritesBtn.classList.add("hidden");
    profileBtn.classList.add("hidden");     
    surpriseBtn.classList.add("hidden");
    historyBtn.classList.add("hidden");
    logoutBtn.classList.add("hidden");

    authBtn.classList.remove("hidden");

    favoriteKeys = new Set();
    favoriteRows = [];
    updateFavoriteButtons();
    await renderFavoritesSection();
  }
}

// ========================================
// ✅ MODAL WATCH
// ========================================
let watchModalEl = null;

function ensureWatchModal() {
  if (watchModalEl) return;

  const modal = document.createElement("div");
  modal.id = "watchModal";
  modal.className = "modal hidden";

  modal.innerHTML = `
    <div class="modalCard">
      <div class="topRow">
        <div>
          <div id="wmTitle" style="font-weight:800;font-size:18px;margin-bottom:4px;">Choisir une plateforme</div>
          <div id="wmSub" class="muted small">Où veux-tu regarder ?</div>
        </div>
        <button id="wmClose" class="btn ghost" type="button">✖</button>
      </div>
      <div id="wmBtns" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;"></div>
      <div style="margin-top:12px;opacity:.65;font-size:12px;">
        *On t’ouvre la page de recherche de la plateforme.
      </div>
    </div>
  `;

  modal.addEventListener("click", (e) => {
    if (e.target === modal) hide(modal);
  });

  document.body.appendChild(modal);
  watchModalEl = modal;
  modal.querySelector("#wmClose").addEventListener("click", () => hide(modal));
}

function openWatchModal({ title, platforms, onPick }) {
  ensureWatchModal();

  const wmTitle = watchModalEl.querySelector("#wmTitle");
  const wmSub = watchModalEl.querySelector("#wmSub");
  const wmBtns = watchModalEl.querySelector("#wmBtns");

  wmTitle.textContent = `Regarder : ${title}`;
  wmSub.textContent = platforms.length > 1 ? "Choisis une plateforme :" : "Plateforme :";
  wmBtns.innerHTML = "";

  platforms.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn primary";
    btn.textContent = p;
    btn.addEventListener("click", () => {
      hide(watchModalEl);
      onPick(p);
    });
    wmBtns.appendChild(btn);
  });

  show(watchModalEl);
}

// ========================================
// ✅ DOM
// ========================================
const startBtn = document.getElementById("startBtn");
const quiz = document.getElementById("quiz");
const resultsSection = document.getElementById("resultsSection");
const feedbackSection = document.getElementById("feedback");
const loader = document.getElementById("loader");

const aboutBtn = document.getElementById("aboutBtn");
const aboutSection = document.getElementById("about");
const closeAboutBtn = document.getElementById("closeAboutBtn");

const authBtn = document.getElementById("authBtn");
const logoutBtn = document.getElementById("logoutBtn");
const favoritesBtn = document.getElementById("favoritesBtn");
const surpriseBtn = document.getElementById("surpriseBtn");
const userBadge = document.getElementById("userBadge");

const profileBtn = document.getElementById("profileBtn");
const historyBtn = document.getElementById("historyBtn");
const historySection = document.getElementById("historySection");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");
const historyContent = document.getElementById("historyContent");
const profileSection = document.getElementById("profileSection");
const closeProfileBtn = document.getElementById("closeProfileBtn");

const authModal = document.getElementById("authModal");
const closeAuthBtn = document.getElementById("closeAuthBtn");
const showLoginTabBtn = document.getElementById("showLoginTabBtn");
const showSignupTabBtn = document.getElementById("showSignupTabBtn");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authMessage = document.getElementById("authMessage");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");

const favoritesSection = document.getElementById("favoritesSection");
const favoritesGrid = document.getElementById("favoritesGrid");
const favoritesEmpty = document.getElementById("favoritesEmpty");
const closeFavoritesBtn = document.getElementById("closeFavoritesBtn");

const stepText = document.getElementById("stepText");
const progressFill = document.getElementById("progressFill");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const finishBtn = document.getElementById("finishBtn");

const currentMoodInput = document.getElementById("currentMood");
const moodInput = document.getElementById("mood");
const typeInput = document.getElementById("type");
const durationInput = document.getElementById("duration");
const energyInput = document.getElementById("energy");

const summaryBadges = document.getElementById("summaryBadges");
const resultsEl = document.getElementById("results");

const rerollBtn = document.getElementById("rerollBtn");
const redoBtn = document.getElementById("redoBtn");
const toFeedbackBtn = document.getElementById("toFeedbackBtn");
const backToResultsBtn = document.getElementById("backToResultsBtn");

const feedbackForm = document.getElementById("feedbackForm");
const thanksMsg = document.getElementById("thanksMsg");

const detailSection = document.getElementById("detailSection");
const detailTitle = document.getElementById("detailTitle");
const detailSubtitle = document.getElementById("detailSubtitle");
const detailPoster = document.getElementById("detailPoster");
const detailPills = document.getElementById("detailPills");
const detailFavBtn = document.getElementById("detailFavBtn");
const detailWhyBtn = document.getElementById("detailWhyBtn");
const detailWhyBox = document.getElementById("detailWhyBox");
const detailSynBtn = document.getElementById("detailSynBtn");
const detailSynBox = document.getElementById("detailSynBox");
const backToResultsFromDetail = document.getElementById("backToResultsFromDetail");
const detailTrailerBtn = document.getElementById("detailTrailerBtn");
const detailTrailerBox = document.getElementById("detailTrailerBox");
const detailWatchBtn = document.getElementById("detailWatchBtn");

const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const appShell = document.querySelector(".appShell");

const heroMoodLine = document.getElementById("heroMoodLine");

const authBtnHome = document.getElementById("authBtnHome");

const startBtnHome = document.getElementById("startBtnHome");

const surpriseBtnResults = document.getElementById("surpriseBtnResults");

const homeSection = document.getElementById("homeSection");
const homeBtn = document.getElementById("homeBtn");

function updateHeroMoodLine(mood) {
  if (!heroMoodLine) return;

  if (!mood) {
    heroMoodLine.textContent = "Prêt pour une soirée cinéma ?";
    return;
  }

  if (mood.includes("rire")) {
    heroMoodLine.textContent = "On part sur quelque chose de fun et léger 😄";
    return;
  }

  if (mood.includes("réconfort")) {
    heroMoodLine.textContent = "On va te trouver quelque chose de doux et réconfortant 🫶";
    return;
  }

  if (mood.includes("tension")) {
    heroMoodLine.textContent = "Ambiance suspense activée 😱";
    return;
  }

  if (mood.includes("réfléchir")) {
    heroMoodLine.textContent = "On cherche quelque chose de captivant et intelligent 🧠";
    return;
  }

  if (mood.includes("détente")) {
    heroMoodLine.textContent = "On va ralentir un peu et se détendre 😌";
    return;
  }

  heroMoodLine.textContent = "Prêt pour une soirée cinéma ?";
}

function setMoodAccentColor(mood) {
  if (!mood) {
    document.documentElement.style.setProperty("--accent", "#ffd36a");
    return;
  }

  if (mood.includes("rire")) {
    document.documentElement.style.setProperty("--accent", "#ffd36a");
    return;
  }

  if (mood.includes("réconfort")) {
    document.documentElement.style.setProperty("--accent", "#ff7aa2");
    return;
  }

  if (mood.includes("tension")) {
    document.documentElement.style.setProperty("--accent", "#9b5cff");
    return;
  }

  if (mood.includes("réfléchir")) {
    document.documentElement.style.setProperty("--accent", "#5cc8ff");
    return;
  }

  if (mood.includes("détente")) {
    document.documentElement.style.setProperty("--accent", "#73e2a7");
    return;
  }

  document.documentElement.style.setProperty("--accent", "#ffd36a");
}

// ========================================
// ✅ STATE
// ========================================
let currentStep = 1;
let lastUser = null;
let lastTop5 = [];
let currentDetailItem = null;

// ========================================
// ✅ HELPERS UI
// ========================================
function show(el) {
  if (!el) return;
  el.classList.remove("hidden");
}

function hide(el) {
  if (!el) return;
  el.classList.add("hidden");
}

function scrollToTopOf(section) {
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideMainSections() {
  hide(homeSection);
  hide(quiz);
  hide(resultsSection);
  hide(feedbackSection);
  hide(aboutSection);
  hide(detailSection);
  hide(favoritesSection);
  hide(profileSection);
  hide(historySection);
}

function setProgress(step) {
  stepText.textContent = `Étape ${step}/6`;
progressFill.style.width = `${(step / 6) * 100}%`;
  prevBtn.disabled = step === 1;

  hide(finishBtn);
  show(nextBtn);

  if (step === 6) {
  hide(nextBtn);
  show(finishBtn);
}
}

function showStep(step) {
  document.querySelectorAll(".step").forEach((s) => hide(s));
  const target = document.querySelector(`.step[data-step="${step}"]`);
  if (target) show(target);
  setProgress(step);
}

function selectedPlatforms() {
  return Array.from(document.querySelectorAll(".platform:checked")).map((p) =>
    normalizePlatformName(p.value)
  );
}

function mustHaveMood() {
  return moodInput.value && moodInput.value.trim().length > 0;
}

function mustHaveEnergy() {
  return energyInput.value && energyInput.value.trim().length > 0;
}

function encode(data) {
  return Object.keys(data)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(data[key]))
    .join("&");
}

function updateFavoriteButtons() {
  document.querySelectorAll(".favoriteToggle").forEach((btn) => {
    const title = btn.dataset.favTitle;
    const type = btn.dataset.favType;
    if (!title || !type) return;

    const key = contentKey(title, type);
    const fav = favoriteKeys.has(key);

    btn.classList.toggle("isFav", fav);
    btn.textContent = fav ? "❤️" : "🤍";
  });

  if (currentDetailItem) {
    const fav = isFavorite(currentDetailItem);
    detailFavBtn.textContent = fav
      ? "❤️ Retirer des favoris"
      : "🤍 Ajouter aux favoris";
  }
}

// ========================================
// ✅ PERSONNALISATION
// ========================================
function computeScore(item, user, prefs) {
  let score = 0;

  // TYPE (film / série)
  if (user.type === "Peu importe") {
    score += 5;
  } else if (item.type === user.type) {
    score += 20;
  } else {
    score -= 30; // pénalité forte si mauvais type
  }

  // HUMEUR
  if (item.mood === user.mood) {
    score += 20;
  } else {
    score -= 15;
  }

  // DURÉE
  if (user.duration === "Peu importe") {
    score += 5;
  } else if (item.duration === user.duration) {
    score += 10;
  }

  // ÉNERGIE
  if (item.energy === user.energy) {
    score += 10;
  }

  // PLATEFORMES
  if (user.platforms && user.platforms.length) {
    if (item.platforms.some((p) => user.platforms.includes(p))) {
      score += 15;
    } else {
      score -= 10;
    }
  }

  // BONUS SI DANS LES FAVORIS
  const key = contentKey(item.title, item.type);
  if (favoriteKeys.has(key)) {
    score += 10;
  }

  return score;
}

function scoreToPercent(score, bestScore) {
  if (!bestScore) return 0;
  return Math.round((score / bestScore) * 100);
}

function why(item, user, prefs = null) {
  const r = [];

  if (item.mood === user.mood) r.push("même humeur");
  if (user.type !== "Peu importe" && item.type === user.type) r.push("type correspondant");
  if (user.duration !== "Peu importe" && item.duration === user.duration) r.push("durée ok");
  if (item.energy === user.energy) r.push("énergie compatible");

  const itemPlats = item.platforms?.length ? item.platforms : (item.platform ? [item.platform] : []);
  if (user.platforms.length === 0) r.push("plateformes libres");
  else if (intersects(itemPlats, user.platforms)) r.push("sur ta/tes plateformes");
  else r.push("autres plateformes");

  if (currentUser && prefs?.favoriteType === item.type) {
    r.push("proche de tes habitudes");
  }
  if (currentUser && prefs?.favoriteMood === item.mood) {
    r.push("en lien avec tes favoris");
  }
  if (currentUser && prefs?.favoriteGenre === item.genre) {
    r.push("genre que tu apprécies souvent");
  }

  return r.join(" · ");
}

function getTop5(user, useShuffle = false, excludedKeys = []) {
  const prefs = getFavoritePreferenceProfile();
  const excludedSet = new Set(excludedKeys);

  const scored = CONTENTS
    .map((item) => {
      const score = computeScore(item, user, prefs);
      return {
        ...item,
        score,
        why: why(item, user, prefs),
      };
    })
    .filter((item) => !excludedSet.has(contentKey(item.title, item.type)))
    .sort((a, b) => b.score - a.score);

  let top5;

  if (useShuffle) {
    const top20 = scored.slice(0, 20);
    const shuffled = [...top20].sort(() => 0.5 - Math.random());
    top5 = shuffled.slice(0, 5).sort((a, b) => b.score - a.score);
  } else {
    top5 = scored.slice(0, 5);
  }

  const maxScore = top5[0]?.score ?? 1;
  const minScore = top5[top5.length - 1]?.score ?? 0;

  return top5.map((item) => {
    let percent = 100;

    if (maxScore !== minScore) {
      percent = Math.round(
        ((item.score - minScore) / (maxScore - minScore)) * 40 + 60
      );
    }

    return {
      ...item,
      percent,
    };
  });
}

// ========================================
// ✅ SUMMARY
// ========================================
function renderSummaryBadges(user) {
  const chips = [
    { label: "État actuel", value: user.currentMood, icon: "💭" },
    { label: "Envie du moment", value: user.mood, icon: "🎭" },
    { label: "Type", value: user.type, icon: "🎬" },
    { label: "Durée", value: user.duration, icon: "⏱️" },
    { label: "Énergie", value: user.energy, icon: "⚡" },
    {
      label: "Plateformes",
      value: user.platforms.length ? user.platforms.join(", ") : "Peu importe",
      icon: "📺",
    },
  ];

  const prefs = getFavoritePreferenceProfile();
  if (currentUser && prefs?.favoriteType) {
    chips.push({
      label: "Style perso",
      value: `plutôt ${prefs.favoriteType.toLowerCase()}`,
      icon: "❤️",
    });
  }

  summaryBadges.innerHTML = chips
    .map(
      (c) => `
      <div class="sBadge">
        <span class="sDot"></span>
        <span>${c.icon} <b>${c.label} :</b> ${c.value}</span>
      </div>
    `
    )
    .join("");
}

// ========================================
// ✅ FAVORITE BUTTONS
// ========================================
function escapeHtmlAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildFavoriteButtonHTML(item) {
  const fav = isFavorite(item);
  return `
    <button
      class="favoriteToggle ${fav ? "isFav" : ""}"
      type="button"
      data-fav-title="${escapeHtmlAttr(item.title)}"
      data-fav-type="${escapeHtmlAttr(item.type)}"
      aria-label="Favori"
    >${fav ? "❤️" : "🤍"}</button>
  `;
}

function attachFavoriteButtonBehavior(root, item) {
  const btn = root.querySelector(".favoriteToggle");
  if (!btn) return;

  btn.onclick = async (e) => {
    e.stopPropagation();

    const result = await toggleFavorite(item);

    if (result !== false) {
      const key = contentKey(item.title, item.type);
      const fav = favoriteKeys.has(key);
      btn.classList.toggle("isFav", fav);
      btn.textContent = fav ? "❤️" : "🤍";
    }
  };
}

// ========================================
// ✅ RENDER RESULTS
// ========================================
async function renderTop5(user, useShuffle = false, excludedKeys = []) {
  const top5 = getTop5(user, useShuffle, excludedKeys);
  lastTop5 = top5;
  if (currentUser && top5.length) {
  surpriseBtn.classList.remove("hidden");
}

  renderSummaryBadges(user);
  resultsEl.innerHTML = "";

  hideMainSections();
  show(resultsSection);
  scrollToTopOf(resultsSection);

  for (let i = 0; i < top5.length; i++) {
    const r = top5[i];

    const card = document.createElement("div");
    card.className = "rcard";
    card.dataset.index = String(i);

    card.innerHTML = `
      <div class="rankBg">${i + 1}</div>
      ${buildFavoriteButtonHTML(r)}

      <div class="posterWrap">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">🎬</div>
      </div>

      <div class="tileInfo">
        <div class="rtitle">${r.title}</div>
        <div class="matchScore">${r.percent}% compatible</div>
        <button class="whyBtn synBtn" type="button">📝 Synopsis</button>

        <div class="whyDetails synDetails hidden">
          Chargement du synopsis...
        </div>
      </div>
    `;

    attachFavoriteButtonBehavior(card, r);

    const synBtnEl = card.querySelector(".synBtn");
    const synBox = card.querySelector(".synDetails");

    synBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      synBox.classList.toggle("hidden");
      synBtnEl.textContent = synBox.classList.contains("hidden")
        ? "📝 Synopsis"
        : "✖ Fermer le synopsis";
    });

    card.addEventListener("click", async () => {
      lastViewBeforeDetail = "results";
      await openDetail(i, user);
    });

    resultsEl.appendChild(card);

    // Enrichissement en arrière-plan
    (async () => {
      try {
        const info = await tmdbSearchLight(r.title, r.type);

        if (!r.genre && info.genre) {
          r.genre = info.genre;
        }

        const posterWrap = card.querySelector(".posterWrap");
        if (posterWrap && info.poster) {
          posterWrap.innerHTML = `<img class="poster" loading="lazy" src="${info.poster}" alt="Affiche ${escapeHtmlAttr(r.title)}">`;
        }

        synBox.textContent = info.overview || "Synopsis indisponible pour ce titre.";
      } catch (_) {
        synBox.textContent = "Synopsis indisponible pour ce titre.";
      }
    })();
  }

  updateFavoriteButtons();
}

// ========================================
// ✅ RENDER FAVORITES
// ========================================
async function renderFavoritesSection() {
  favoritesGrid.innerHTML = "";

  const contentMap = new Map(
    CONTENTS.map((item) => [contentKey(item.title, item.type), item])
  );

  const items = favoriteRows.map((row) => {
    const key = contentKey(row.title, row.type);
    return (
      contentMap.get(key) || {
        title: row.title,
        type: row.type,
        mood: row.mood || "—",
        duration: row.duration || "—",
        energy: row.energy || "—",
        platforms: row.platforms ? parsePlatformsCell(row.platforms) : [],
        platform: row.platforms ? parsePlatformsCell(row.platforms)[0] || "" : "",
        poster: row.poster || "",
      }
    );
  });

  favoritesEmpty.classList.toggle("hidden", items.length > 0);

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "rcard";

    card.innerHTML = `
  ${buildFavoriteButtonHTML(item)}

  <div class="posterWrap">
    ${
      item.poster
        ? `<img class="poster" loading="lazy" src="${item.poster}" alt="Affiche ${escapeHtmlAttr(item.title)}">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:42px;">🎬</div>`
    }
  </div>

  <div class="tileInfo">
    <div class="favoriteCardTitle">${item.title}</div>

    <div class="favoriteMeta">
      <span class="pill">${item.type || "-"}</span>
      <span class="pill">${item.duration || "-"}</span>
      <span class="pill">${item.energy || "-"}</span>
    </div>

    <button class="favoriteSynopsisBtn synBtn" type="button">📝 Synopsis</button>

    <div class="whyDetails synDetails hidden">
      Chargement du synopsis...
    </div>
  </div>
`;

    attachFavoriteButtonBehavior(card, item);

    const synBtnEl = card.querySelector(".synBtn");
    const synBox = card.querySelector(".synDetails");

    synBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      synBox.classList.toggle("hidden");
      synBtnEl.textContent = synBox.classList.contains("hidden")
        ? "📝 Synopsis"
        : "✖ Fermer le synopsis";
    });

    card.addEventListener("click", async () => {
      const fakeUser = lastUser || {
        mood: item.mood || "Besoin de détente",
        type: item.type || "Peu importe",
        duration: item.duration || "Peu importe",
        energy: item.energy || "Normal",
        platforms: [],
      };

      lastTop5 = [item];
      lastViewBeforeDetail = "favorites";
      await openDetail(0, fakeUser);
    });

    favoritesGrid.appendChild(card);

    // enrichissement en arrière-plan
    (async () => {
      try {
        const info = await tmdbSearchLight(item.title, item.type);

        if (!item.genre && info.genre) {
          item.genre = info.genre;
        }

        const posterWrap = card.querySelector(".posterWrap");
        if (posterWrap && info.poster) {
          posterWrap.innerHTML = `<img class="poster" loading="lazy" src="${info.poster}" alt="Affiche ${escapeHtmlAttr(item.title)}">`;
        }

        synBox.textContent = info.overview || "Synopsis indisponible pour ce titre.";
      } catch (_) {
        synBox.textContent = "Synopsis indisponible pour ce titre.";
      }
    })();
  }

  updateFavoriteButtons();
}

function pickRandomTop5Item() {
  if (!lastTop5 || !lastTop5.length) return null;
  const randomIndex = Math.floor(Math.random() * lastTop5.length);
  return { item: lastTop5[randomIndex], index: randomIndex };
}

async function renderProfileSection() {
  if (!currentUser || !hasSupabase()) return;

  const profileContent = document.getElementById("profileContent");
  if (!profileContent) return;

  const prefs = getFavoritePreferenceProfile();
  const favCount = favoriteRows.length;

  profileContent.innerHTML = `
    <div class="profileTopBar">
      <div>
        <div class="profileMainTitle">Mon profil</div>
        <div class="profileSubtitle">Tes préférences Moodvie</div>
      </div>

      <button id="closeProfileBtnInside" class="btn ghost">✕ Fermer</button>
    </div>

    <div class="profileGridClean">
      <div class="profileBox wide">
        <div class="profileLabel">Compte</div>
        <div class="profileBigValue">${currentUser.email || "-"}</div>
      </div>

      <div class="profileBox">
        <div class="profileLabel">Favoris enregistrés</div>
        <div class="profileValue">${favCount}</div>
      </div>

      <div class="profileBox">
        <div class="profileLabel">Type préféré</div>
        <div class="profileValue">${prefs?.favoriteType || "-"}</div>
      </div>

      <div class="profileBox">
        <div class="profileLabel">Genre préféré</div>
        <div class="profileValue">${prefs?.favoriteGenre || "-"}</div>
      </div>

      <div class="profileBox">
        <div class="profileLabel">Humeur fréquente</div>
        <div class="profileValue">${prefs?.favoriteMood || "-"}</div>
      </div>

      <div class="profileBox">
        <div class="profileLabel">Durée préférée</div>
        <div class="profileValue">${prefs?.favoriteDuration || "-"}</div>
      </div>

      <div class="profileBox">
        <div class="profileLabel">Énergie préférée</div>
        <div class="profileValue">${prefs?.favoriteEnergy || "-"}</div>
      </div>

      <div class="profileBox wide">
        <div class="profileLabel">Plateformes préférées</div>
        <div class="profileTags">
          ${
            prefs?.favoritePlatforms?.length
              ? prefs.favoritePlatforms.map(p => `<span class="pill">${p}</span>`).join("")
              : "<span class='muted'>-</span>"
          }
        </div>
      </div>
    </div>
  `;

  const closeBtn = document.getElementById("closeProfileBtnInside");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      hide(profileSection);
    });
  }
}

async function saveQuizHistory(user) {
  if (!currentUser || !hasSupabase()) return;

  try {
    await supabaseClient.from("quiz_history").insert({
      user_id: currentUser.id,
      mood: user.mood || "",
      type: user.type || "",
      duration: user.duration || "",
      energy: user.energy || "",
      platforms: (user.platforms || []).join(", ")
    });

  
  } catch (e) {
    console.error("Erreur sauvegarde historique quiz :", e);
  }
}

async function renderHistorySection() {
  if (!currentUser || !hasSupabase()) return;

  const historyContent = document.getElementById("historyContent");
  if (!historyContent) return;

  historyContent.innerHTML = "<p class='muted'>Chargement de l’historique...</p>";

  const { data, error } = await supabaseClient
    .from("quiz_history")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false, nullsFirst: false });

  if (error) {
    historyContent.innerHTML = "<p class='muted'>Impossible de charger l’historique.</p>";
    console.error(error);
    return;
  }

  if (!data || !data.length) {
    historyContent.innerHTML = "<p class='muted'>Aucun quiz enregistré pour le moment.</p>";
    return;
  }

  // On récupère un exemple d'affiche pour chaque ligne d’historique
  const itemsWithPoster = await Promise.all(
    data.map(async (q) => {
      try {
        const tempUser = {
          currentMood: q.current_mood || "",
          mood: q.mood || "",
          type: q.type || "Peu importe",
          duration: q.duration || "Peu importe",
          energy: q.energy || "",
          platforms: q.platforms
            ? q.platforms.split(",").map(p => p.trim()).filter(Boolean)
            : [],
        };

        const recos = getTop5(tempUser, false, []);
        const firstReco = recos[0];

        if (!firstReco) {
          return { ...q, poster: "", previewTitle: "Aucune recommandation" };
        }

        const info = await tmdbSearchLight(firstReco.title, firstReco.type);

        return {
          ...q,
          poster: info.poster || "",
          previewTitle: firstReco.title || "Recommandation Moodvie",
        };
      } catch (e) {
        return { ...q, poster: "", previewTitle: "Recommandation Moodvie" };
      }
    })
  );

  historyContent.innerHTML = `
    <div class="historyList">
      ${itemsWithPoster.map((q, index) => `
        <div class="historyCard">
          <div class="historyPosterWrap">
            ${
              q.poster
                ? `<img class="historyPoster" src="${q.poster}" alt="Affiche ${escapeHtmlAttr(q.previewTitle || "Moodvie")}">`
                : `<div class="historyPosterPlaceholder">🎬</div>`
            }
          </div>

          <div class="historyBody">
            <div class="historyTitle">
              ${q.previewTitle || "Recommandation Moodvie"}
            </div>

            <div class="historyMeta">
              🕒 ${new Date(q.created_at).toLocaleString()}
            </div>

            <div class="historyChips">
              <span class="pill">${q.mood || "-"}</span>
              <span class="pill">${q.type || "-"}</span>
              <span class="pill">${q.duration || "-"}</span>
              <span class="pill">${q.energy || "-"}</span>
            </div>

            <div class="historyPlatforms">
              <strong>Plateformes :</strong> ${q.platforms || "-"}
            </div>

            <div class="historyActionRow">
              <button class="historyReplayBtn" data-history-index="${index}">
                Refaire ce quiz
              </button>
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  historyContent.querySelectorAll("[data-history-index]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const q = data[Number(btn.dataset.historyIndex)];
      if (!q) return;

      lastUser = {
        currentMood: q.current_mood || "",
        mood: q.mood,
        type: q.type,
        duration: q.duration,
        energy: q.energy,
        platforms: q.platforms
          ? q.platforms.split(",").map(p => p.trim()).filter(Boolean)
          : [],
      };

      await renderTop5(lastUser);
      hideMainSections();
      show(resultsSection);
      scrollToTopOf(resultsSection);
    });
  });
}

// ========================================
// ✅ DETAIL
// ========================================
async function openDetail(index, user) {
  const r = lastTop5[index];
  if (!r) return;

  currentDetailItem = r;

  let poster = "";
  let overview = "";
  let trailerKey = "";

  try {
  const info = await tmdbSearchFull(r.title, r.type);
  poster = info.poster || "";
  overview = info.overview || "";
  trailerKey = info.trailerKey || "";
  if (!r.genre && info.genre) {
    r.genre = info.genre;
  }
} catch (_) {}

  const rawPlatforms = r.platforms?.length ? r.platforms : r.platform ? [r.platform] : [];
  const sortedPlatforms = sortPlatformsForUser(rawPlatforms, user?.platforms || []);

  detailTitle.textContent = r.title;
  detailSubtitle.textContent = `Recommandation • ${r.type} • ${r.percent || scoreToPercent(r.score || 0)}% compatible`;
  detailPoster.src = poster || "";
  detailPoster.alt = `Affiche ${r.title}`;

  detailPills.innerHTML = `
  <div class="detailMainBadges">
    <span class="detailTypeBadge">${r.type}</span>
    ${
      sortedPlatforms.length
        ? `<div class="detailPlatformHighlight">
             <span class="detailPlatformLabel">Disponible sur</span>
             <div class="detailPlatformList">
               ${sortedPlatforms.map((p) => `<span class="detailPlatformBadge">${p}</span>`).join("")}
             </div>
           </div>`
        : ""
    }
  </div>

  <div class="detailSecondaryPills">
    ${r.genre ? `<span class="pill">${r.genre}</span>` : ""}
    <span class="pill">${r.duration}</span>
    <span class="pill">${r.mood}</span>
    <span class="pill">${r.energy}</span>
  </div>
`;

  detailWhyBox.textContent = `👉 ${r.why || ""}`;
  detailSynBox.textContent = overview ? overview : "Synopsis indisponible pour ce titre.";

  detailWhyBox.classList.add("hidden");
  detailSynBox.classList.add("hidden");
  detailWhyBtn.textContent = "🔎 Pourquoi ce choix ?";
  detailSynBtn.textContent = "📝 Synopsis";

  updateFavoriteButtons();

  detailFavBtn.onclick = async () => {
    await toggleFavorite(r);
    updateFavoriteButtons();
  };

  if (detailTrailerBox) {
    detailTrailerBox.classList.add("hidden");
    detailTrailerBox.innerHTML = "";
  }

  if (detailTrailerBtn) {
    detailTrailerBtn.textContent = "🎬 Bande-annonce";
    detailTrailerBtn.onclick = () => {
      if (!detailTrailerBox) return;

      if (!trailerKey) {
        window.open(youtubeSearchUrl(r.title, r.type), "_blank");
        return;
      }

      const isOpen = !detailTrailerBox.classList.contains("hidden");
      if (isOpen) {
        detailTrailerBox.classList.add("hidden");
        detailTrailerBox.innerHTML = "";
        detailTrailerBtn.textContent = "🎬 Bande-annonce";
        return;
      }

      detailTrailerBox.innerHTML = `
        <iframe
          src="https://www.youtube.com/embed/${trailerKey}"
          title="Bande-annonce ${escapeHtmlAttr(r.title)}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen></iframe>
      `;
      detailTrailerBox.classList.remove("hidden");
      detailTrailerBtn.textContent = "✖ Fermer la bande-annonce";
    };
  }

  if (detailWatchBtn) {
    const available = sortedPlatforms.length ? sortedPlatforms : ["Google"];

    detailWatchBtn.textContent = "▶ Regarder sur la plateforme";
    detailWatchBtn.onclick = () => {
      if (available.length === 1) {
        const url = platformSearchUrl(available[0], r.title);
        window.open(url, "_blank");
        return;
      }

      openWatchModal({
        title: r.title,
        platforms: available,
        onPick: (picked) => {
          const url = platformSearchUrl(picked, r.title);
          window.open(url, "_blank");
        },
      });
    };
  }

  hideMainSections();
  show(detailSection);
  scrollToTopOf(detailSection);
  updateFavoriteButtons();
}

// ========================================
// ✅ NAVIGATION DETAIL
// ========================================
detailWhyBtn.addEventListener("click", () => {
  detailWhyBox.classList.toggle("hidden");
  detailWhyBtn.textContent = detailWhyBox.classList.contains("hidden")
    ? "🔎 Pourquoi ce choix ?"
    : "✖ Fermer";
});

detailSynBtn.addEventListener("click", () => {
  detailSynBox.classList.toggle("hidden");
  detailSynBtn.textContent = detailSynBox.classList.contains("hidden")
    ? "📝 Synopsis"
    : "✖ Fermer";
});

backToResultsFromDetail.addEventListener("click", async () => {
  if (detailTrailerBox) {
    detailTrailerBox.classList.add("hidden");
    detailTrailerBox.innerHTML = "";
  }
  if (detailTrailerBtn) {
    detailTrailerBtn.textContent = "🎬 Bande-annonce";
  }

  hide(detailSection);

  if (lastViewBeforeDetail === "favorites") {
    await renderFavoritesSection();
    show(favoritesSection);
    scrollToTopOf(favoritesSection);
  } else {
    show(resultsSection);
    scrollToTopOf(resultsSection);
  }
});

// ========================================
// ✅ QUIZ
// ========================================
function goStart() {
  hideMainSections();
  show(quiz);
  surpriseBtn.classList.add("hidden");

  currentStep = 1;
  currentMoodInput.value = "";
  moodInput.value = "";
  typeInput.value = "Peu importe";
  durationInput.value = "Peu importe";
  energyInput.value = "";

  document.querySelectorAll(".platform").forEach((p) => (p.checked = false));
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));

  showStep(1);
  scrollToTopOf(quiz);
}

function validateStep(step) {
  if (step === 1 && !currentMoodInput.value) return false;
  if (step === 2 && !mustHaveMood()) return false;
  if (step === 5 && !mustHaveEnergy()) return false;
  return true;
}

function next() {
  if (!validateStep(currentStep)) {
    const active = document.querySelector(`.step[data-step="${currentStep}"]`);
    if (active) {
      active.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(6px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 220 }
      );
    }
    return;
  }

  if (currentStep < 6) {
    currentStep += 1;
    showStep(currentStep);
    scrollToTopOf(quiz);
  }
}

function prev() {
  if (currentStep > 1) {
    currentStep -= 1;
    showStep(currentStep);
    scrollToTopOf(quiz);
  }
}

async function finish() {
  if (!mustHaveMood() || !mustHaveEnergy()) return;

  lastUser = {
    currentMood: currentMoodInput.value,
    mood: moodInput.value,
    type: typeInput.value || "Peu importe",
    duration: durationInput.value || "Peu importe",
    energy: energyInput.value,
    platforms: selectedPlatforms(),
  };

  show(loader);

  try {
    await renderTop5(lastUser);

    // on cache le loader dès que le top 5 est prêt
    hide(loader);

    // sauvegarde et mise à jour de l’historique en arrière-plan
    saveQuizHistory(lastUser)
      .then(() => renderHistorySection())
      .catch((e) => {
        console.error("Erreur historique quiz :", e);
      });

  } catch (e) {
    hide(loader);
    console.error(e);
    alert("Impossible d’afficher les résultats.");
  }
}

// ========================================
// ✅ EVENTS
// ========================================
startBtn.addEventListener("click", goStart);

if (startBtnHome) {
  startBtnHome.addEventListener("click", goStart);
}

  if (aboutBtn) {
  aboutBtn.addEventListener("click", () => {
    try {
      if (!aboutSection) {
        console.warn("Section À propos introuvable");
        return;
      }

      hideMainSections();
      show(aboutSection);
      scrollToTopOf(aboutSection);
    } catch (e) {
      console.error("Erreur bouton À propos :", e);
    }
  });
}

if (homeBtn) {
  homeBtn.addEventListener("click", () => {
    hideMainSections();
    show(homeSection);
    scrollToTopOf(homeSection);
  });
}

if (closeAboutBtn) {
  closeAboutBtn.addEventListener("click", () => {
    try {
      if (!aboutSection) return;
      hide(aboutSection);
    } catch (e) {
      console.error("Erreur fermeture À propos :", e);
    }
  });
}
prevBtn.addEventListener("click", prev);
nextBtn.addEventListener("click", next);
finishBtn.addEventListener("click", finish);

rerollBtn.addEventListener("click", async () => {
  if (!lastUser || !lastTop5.length) return;

  const excludedKeys = lastTop5.map((item) => contentKey(item.title, item.type));
  await renderTop5(lastUser, true, excludedKeys);
});

redoBtn.addEventListener("click", goStart);

toFeedbackBtn.addEventListener("click", () => {
  hideMainSections();
  show(feedbackSection);
  thanksMsg.classList.add("hidden");
  scrollToTopOf(feedbackSection);
});

backToResultsBtn.addEventListener("click", () => {
  hide(feedbackSection);
  show(resultsSection);
  scrollToTopOf(resultsSection);
});

favoritesBtn.addEventListener("click", async () => {
  try {
    console.log("clic favoris");

    if (!currentUser) {
      openAuthModal("Connecte-toi pour voir tes favoris.");
      return;
    }

    await loadFavorites();
    await renderFavoritesSection();

    hideMainSections();
    show(favoritesSection);
    scrollToTopOf(favoritesSection);
  } catch (e) {
    console.error("Erreur bouton Favoris :", e);
  }
});

profileBtn.addEventListener("click", async () => {
  try {
    console.log("clic profil");

    if (!currentUser) {
      openAuthModal("Connecte-toi pour voir ton profil.");
      return;
    }

    await renderProfileSection();
    hideMainSections();
    show(profileSection);
    scrollToTopOf(profileSection);
  } catch (e) {
    console.error("Erreur bouton Profil :", e);
  }
});

surpriseBtn.addEventListener("click", async () => {
  if (!currentUser) {
    openAuthModal("Connecte-toi pour utiliser Surprise.");
    return;
  }

  if (!lastUser) {
    alert("Fais d’abord le quiz !");
    return;
  }

  await renderTop5(lastUser);

  const randomPick = pickRandomTop5Item();
  if (!randomPick) return;

  await openDetail(randomPick.index, lastUser);
});

historyBtn.addEventListener("click", async () => {
  try {
    console.log("clic historique");

    if (!currentUser) {
      openAuthModal("Connecte-toi pour voir ton historique.");
      return;
    }

    hideMainSections();
    await renderHistorySection();
    show(historySection);
    scrollToTopOf(historySection);
  } catch (e) {
    console.error("Erreur bouton Historique :", e);
  }
});

closeHistoryBtn.addEventListener("click", () => {
  hide(historySection);
});

if (closeProfileBtn) {
  closeProfileBtn.addEventListener("click", () => {
    hide(profileSection);
  });
}

closeFavoritesBtn.addEventListener("click", () => {
  hide(favoritesSection);
  if (lastUser && lastTop5.length) {
    show(resultsSection);
    scrollToTopOf(resultsSection);
  }
});

if (authBtn) {
  authBtn.addEventListener("click", () => {
    if (!hasSupabase()) {
      alert("Ajoute d’abord ton SUPABASE_URL et ta publishable key dans le script.js.");
      return;
    }
    openAuthModal();
  });
}

if (authBtnHome) {
  authBtnHome.addEventListener("click", () => {
    if (!hasSupabase()) {
      alert("Ajoute d’abord ton SUPABASE_URL et ta publishable key dans le script.js.");
      return;
    }
    openAuthModal();
  });
}

logoutBtn.addEventListener("click", async () => {
  await signOutUser();
});

closeAuthBtn.addEventListener("click", closeAuthModal);
showLoginTabBtn.addEventListener("click", showLoginTab);
showSignupTabBtn.addEventListener("click", showSignupTab);

authModal.addEventListener("click", (e) => {
  if (e.target === authModal) closeAuthModal();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!hasSupabase()) {
    setAuthMessage("Supabase n’est pas configuré.", true);
    return;
  }

  const { error } = await signInWithEmail(loginEmail.value.trim(), loginPassword.value);
  if (error) {
    setAuthMessage(error.message, true);
    return;
  }

  setAuthMessage("Connexion réussie.");
  loginForm.reset();
  closeAuthModal();
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!hasSupabase()) {
    setAuthMessage("Supabase n’est pas configuré.", true);
    return;
  }

  const { error } = await signUpWithEmail(signupEmail.value.trim(), signupPassword.value);
  if (error) {
    setAuthMessage(error.message, true);
    return;
  }

  setAuthMessage("Compte créé. Vérifie ton email si la confirmation est activée.");
  signupForm.reset();
});

document.querySelectorAll(".step").forEach((stepEl) => {
  stepEl.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = stepEl.getAttribute("data-step");
      const value = btn.dataset.value;

      stepEl.querySelectorAll(".chip").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");

      if (step === "1") currentMoodInput.value = value;
      if (step === "2") moodInput.value = value;
      if (step === "2") updateHeroMoodLine(value);
      if (step === "2") setMoodAccentColor(value);
      if (step === "3") typeInput.value = value;
      if (step === "4") durationInput.value = value;
      if (step === "5") energyInput.value = value;

      if (step !== "6") {
        setTimeout(() => {
          if (currentStep === parseInt(step, 10)) next();
        }, 120);
      }
    });
  });
});

document.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty("--x", `${x}px`);
    card.style.setProperty("--y", `${y}px`);
  });
});

feedbackForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (lastUser) {
    document.getElementById("fb_mood").value = lastUser.mood || "";
    document.getElementById("fb_type").value = lastUser.type || "";
    document.getElementById("fb_duration").value = lastUser.duration || "";
    document.getElementById("fb_energy").value = lastUser.energy || "";
    document.getElementById("fb_platforms").value = (lastUser.platforms || []).join(", ");
  }

  const formData = new FormData(feedbackForm);
  const data = Object.fromEntries(formData.entries());

  try {
    await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encode(data),
    });

    document.getElementById("comment").value = "";
    thanksMsg.classList.remove("hidden");
  } catch (_) {
    alert("Oups, l’envoi n’a pas marché. Réessaie.");
  }
});

// ========================================
// ✅ INIT
// ========================================
(async function init() {
  try {
    await loadSheetBase();

    if (hasSupabase()) {
      const { data } = await supabaseClient.auth.getUser();
      currentUser = data?.user || null;

      if (currentUser) {
        await ensureProfile(currentUser);
        await loadFavorites();
      }

      await updateAuthUI();
      updateFavoriteButtons();

      supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;

        if (currentUser) {
          await ensureProfile(currentUser);
          await loadFavorites();
        } else {
          favoriteKeys = new Set();
          favoriteRows = [];
        }

        await updateAuthUI();
        updateFavoriteButtons();
      });
    }
  } catch (e) {
    console.error("❌ Impossible de charger la base Google Sheet :", e);
    alert("Erreur : impossible de charger la base Google Sheet.");
  }
})();

// Sidebar toggle

if (sidebar && sidebarToggle && appShell) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    appShell.classList.toggle("sidebar-open");
  });
}

if (surpriseBtnResults) {
  surpriseBtnResults.addEventListener("click", async () => {
    if (!currentUser) {
      openAuthModal("Connecte-toi pour utiliser Surprends-moi.");
      return;
    }

    if (!lastUser) {
      alert("Fais d’abord le quiz.");
      return;
    }

    await renderTop5(lastUser);

    const randomPick = pickRandomTop5Item();
    if (!randomPick) return;

    await openDetail(randomPick.index, lastUser);
  });
}

