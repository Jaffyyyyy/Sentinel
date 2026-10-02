"use strict";

const STORAGE_KEY = "ukayfind-state-v1";
const BRANDS = window.BRAND_GUIDE_DATA || [];
const ENRICHMENT = window.BRAND_GUIDE_ENRICHMENT || {};
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const DAY = 24 * 60 * 60 * 1000;
const LOGO_REFRESH_INTERVAL = 30 * DAY;

function defaultState() {
  return {
    preferences: { webBrandUpdates: true },
    onlineBrands: [],
    brandUpdates: {},
    lastBrandSync: null,
    logoRecords: {},
    lastLogoSync: null
  };
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultState();
    const parsed = JSON.parse(stored);
    const logoRecords = parsed.logoRecords && typeof parsed.logoRecords === "object" ? parsed.logoRecords : {};
    const needsVersionedLogoHistory = Object.values(logoRecords).some(record =>
      record?.current && (!record.current.sha1 || record.historyVersion !== 3)
    );
    return {
      ...defaultState(),
      ...parsed,
      preferences: { ...defaultState().preferences, ...(parsed.preferences || {}) },
      onlineBrands: Array.isArray(parsed.onlineBrands) ? parsed.onlineBrands.slice(0, 1000) : [],
      brandUpdates: parsed.brandUpdates && typeof parsed.brandUpdates === "object" ? parsed.brandUpdates : {},
      lastBrandSync: parsed.lastBrandSync || null,
      logoRecords,
      lastLogoSync: needsVersionedLogoHistory ? null : (parsed.lastLogoSync || null)
    };
  } catch (error) {
    console.error("Could not read saved brand-guide data.", error);
    return defaultState();
  }
}

let state = loadState();
let page = location.hash.slice(1) || "brands";
let brandQuery = "";
let brandCategory = "All brands";
let searchController = null;
let syncController = null;
let logoSyncController = null;
let searchTimer = 0;
let onlineSearchStatus = "idle";
let onlineSearchMessage = "";
let suggestions = [];
let syncInProgress = false;
let logoSyncInProgress = false;
let syncLabel = "";
let logoSyncLabel = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Could not save brand-guide data.", error);
    toast("Browser storage is full or unavailable. Recent changes may not persist.");
    return false;
  }
}

function toast(message) {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 3500);
}

function allBrands() {
  return [...BRANDS, ...state.onlineBrands];
}

function brandCategories() {
  return ["All brands", ...new Set(allBrands().map(brand => brand.category).sort((a, b) => a.localeCompare(b)))];
}

function enrichmentFor(brand) {
  return ENRICHMENT[brand.id] || {
    washTags: [brand.tags || "No period-specific label timeline is supplied. Compare the full label and product with dated, model-specific primary sources.", "Label details vary by item, production market, and era.", "A label is a research clue, not proof of age or authenticity."],
    collaborations: [],
    rarity: "No release-specific rarity evidence is provided for this brand. Research the exact model, variant, market, production record, condition, and provenance."
  };
}

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function similarity(query, title) {
  const terms = normalize(query).split(" ").filter(term => term.length > 1);
  const candidates = normalize(title).split(" ").filter(term => term.length > 1);
  if (!terms.length || !candidates.length) return 0;
  return terms.filter(term => candidates.some(candidate => candidate === term || candidate.startsWith(term) || term.startsWith(candidate))).length / terms.length;
}

function apiUrl(base, params) {
  return `${base}?${new URLSearchParams({ ...params, format: "json", origin: "*" })}`;
}

async function fetchJson(url, parentSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Reference service returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.info || "Reference lookup failed.");
    return payload;
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abort);
  }
}

async function fetchWikipediaPage(query, signal) {
  const payload = await fetchJson(apiUrl(WIKIPEDIA_API, {
    action: "query", generator: "search", gsrsearch: query, gsrnamespace: "0", gsrlimit: "3",
    prop: "extracts|info", exintro: "1", explaintext: "1", inprop: "url"
  }), signal);
  return Object.values(payload.query?.pages || {}).filter(item => item.extract && item.title && item.fullurl)
    .sort((a, b) => (a.index || 999) - (b.index || 999))
    .map(item => ({
      pageId: item.pageid,
      revisionId: item.lastrevid || null,
      title: item.title,
      extract: item.extract.trim().slice(0, 1500),
      url: item.fullurl,
      retrievedAt: new Date().toISOString()
    }));
}

function isBrandSummary(text) {
  return /\b(brand|company|manufacturer|retailer|fashion house|sportswear|clothing|footwear|apparel|watchmaker|camera maker|electronics company|outdoor equipment)\b/i.test(text || "");
}

function matchingBuiltIn(title) {
  return BRANDS.find(brand => similarity(brand.name, title) >= 0.66);
}

function updateWikipediaRecord(brand, result) {
  state.brandUpdates[brand.id] = {
    title: result.title, summary: result.extract.slice(0, 900), url: result.url,
    revisionId: result.revisionId, retrievedAt: result.retrievedAt, license: "CC BY-SA 4.0"
  };
}

function saveResearchLead(result) {
  const existing = state.onlineBrands.find(brand => brand.wikiPageId === result.pageId);
  if (existing) {
    existing.overview = result.extract;
    existing.wikiRevisionId = result.revisionId;
    existing.wikiRetrievedAt = result.retrievedAt;
    existing.wikiUrl = result.url;
    existing.website = result.url;
    return existing;
  }
  const saved = {
    id: `wiki-${result.pageId}`,
    name: result.title,
    category: "Online research lead",
    founded: "See source",
    origin: "See source",
    mark: "",
    website: result.url,
    overview: result.extract,
    notable: "Read the linked source; item-level research is still required.",
    guide: "Saved from an online brand search as an unverified research lead. Corroborate it with the brand's own materials.",
    tags: "No wash-tag timeline is supplied. Use item-, category-, and era-specific sources.",
    onlineCandidate: true,
    wikiPageId: result.pageId,
    wikiRevisionId: result.revisionId,
    wikiRetrievedAt: result.retrievedAt,
    wikiUrl: result.url
  };
  state.onlineBrands.unshift(saved);
  state.onlineBrands = state.onlineBrands.slice(0, 1000);
  return saved;
}

async function searchOnlineBrand(query) {
  if (!navigator.onLine || !state.preferences.webBrandUpdates || query.trim().length < 3) return;
  searchController = new AbortController();
  onlineSearchStatus = "searching";
  render();
  try {
    const results = await fetchWikipediaPage(query, searchController.signal);
    const exact = results.find(result => similarity(query, result.title) >= 0.66 && isBrandSummary(result.extract));
    const known = exact && matchingBuiltIn(exact.title);
    if (exact && known) {
      updateWikipediaRecord(known, exact);
      onlineSearchMessage = `Updated the reference for ${known.name}`;
      onlineSearchStatus = "saved";
      persist();
    } else if (exact) {
      const saved = saveResearchLead(exact);
      onlineSearchMessage = `Saved ${saved.name} locally as an unverified research lead`;
      onlineSearchStatus = "saved";
      persist();
    } else {
      suggestions = results.filter(result => isBrandSummary(result.extract));
      onlineSearchStatus = suggestions.length ? "suggestions" : "empty";
    }
  } catch (error) {
    if (searchController.signal.aborted) return;
    console.warn("Online brand search failed; offline guide remains available.", error);
    onlineSearchStatus = "error";
  }
  if (page === "brands" && brandQuery === query) render();
}

function visibleBrands() {
  const query = normalize(brandQuery);
  return allBrands().filter(brand => {
    if (brandCategory !== "All brands" && brand.category !== brandCategory) return false;
    const enrichment = enrichmentFor(brand);
    const online = state.brandUpdates[brand.id] || {};
    const searchable = [
      brand.name, brand.category, brand.origin, brand.founded, brand.overview, brand.notable, brand.guide,
      brand.tags, brand.search, online.summary, online.title,
      enrichment.collaborations.join(" "), enrichment.washTags.join(" "), enrichment.rarity
    ].map(normalize).join(" ");
    return !query || searchable.includes(query);
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function formatDate(value) {
  if (!value) return "Date not supplied";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not supplied" : date.toLocaleDateString();
}

function logoRecordFor(brand) {
  return state.logoRecords[brand.id] || null;
}

function renderLogoAlbum(brand) {
  const record = logoRecordFor(brand);
  const entries = record ? [...(record.history || []), ...(record.current ? [{ ...record.current, current: true }] : [])] : [];
  const pictures = entries.map(entry => `
    <figure class="logo-album-item ${entry.current ? "current" : ""}">
      <a href="${escapeHtml(entry.filePage)}" target="_blank" rel="noopener noreferrer" aria-label="Open source file: ${escapeHtml(entry.fileName)}">
        <img data-album-logo src="${escapeHtml(entry.thumbUrl || entry.imageUrl)}" alt="${escapeHtml(brand.name)} logo reference${entry.current ? ", latest linked version" : ", earlier archived reference"}" loading="lazy" referrerpolicy="no-referrer">
      </a>
      <figcaption><strong>${entry.current ? "Latest linked file revision" : escapeHtml(entry.archiveLabel || "Earlier file revision")}</strong>
        <span>${escapeHtml(entry.fileName)}</span>
        <small>${entry.uploadedAt ? `File revision uploaded ${formatDate(entry.uploadedAt)}` : "Upload date not supplied"}${entry.current ? ` · checked ${formatDate(entry.checkedAt)}` : entry.sourceRevision ? "" : ` · source change detected ${formatDate(entry.archivedAt)}`}</small>
        ${entry.changeNote ? `<small>${escapeHtml(entry.changeNote)}</small>` : ""}
        <small>${escapeHtml(entry.license || "Licence not stated in file metadata")}${entry.artist ? ` · ${escapeHtml(entry.artist)}` : ""}</small>
        <a class="logo-source-link" href="${escapeHtml(entry.filePage)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons source ↗</a>
      </figcaption>
    </figure>`).join("");
  const localMark = brand.mark
    ? `<div class="logo-local-note">Offline mark: <img src="./brand-logos/${escapeHtml(brand.mark)}" alt="${escapeHtml(brand.name)} Simple Icons mark" loading="lazy"> bundled Simple Icons artwork</div>`
    : "";
  const noEntries = `<p class="logo-empty">No logo file is linked to this brand in Wikidata yet. The text name is shown until a source is found; this does not mean the brand has no logo.</p>`;
  return `<details class="logo-album"><summary>Logo album <span>${entries.length ? `${entries.length} sourced ${entries.length === 1 ? "image" : "images"}` : "source history"}</span></summary>
    ${localMark}<div class="logo-album-grid">${entries.length ? pictures : noEntries}</div>
    ${record?.entityUrl ? `<p class="logo-source-note">Logo-file link from <a href="${escapeHtml(record.entityUrl)}" target="_blank" rel="noopener noreferrer">Wikidata ${escapeHtml(record.entityId)}</a>; versioned image files and licence metadata come from Wikimedia Commons. File revisions document repository edits, not necessarily brand identity changes or adoption dates.${record.historyWarning ? ` ${escapeHtml(record.historyWarning)}` : ""} <a href="${escapeHtml(brand.website)}" target="_blank" rel="noopener noreferrer">Compare with the brand’s official site ↗</a></p>` : `<p class="logo-source-note">Online logo lookup uses Wikidata and Wikimedia Commons. Treat repository images as research candidates—not confirmation that a logo is current or officially approved.</p>`}
  </details>`;
}

function renderBrand(brand) {
  const enrichment = enrichmentFor(brand);
  const logoRecord = logoRecordFor(brand);
  const online = state.brandUpdates[brand.id] || (brand.onlineCandidate ? {
    title: brand.name, summary: brand.overview, url: brand.wikiUrl || brand.website,
    revisionId: brand.wikiRevisionId, retrievedAt: brand.wikiRetrievedAt
  } : null);
  const imageUrl = logoRecord?.current?.thumbUrl;
  const hasBundledMark = Boolean(brand.mark);
  const logoMarkup = imageUrl
    ? `<img class="brand-logo-img" data-brand-logo data-fallback-src="${hasBundledMark ? `./brand-logos/${escapeHtml(brand.mark)}` : ""}" data-fallback-name="${escapeHtml(brand.name)}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(brand.name)} logo reference from Wikimedia Commons" loading="lazy" referrerpolicy="no-referrer">`
    : hasBundledMark
      ? `<img class="brand-logo-img" src="./brand-logos/${escapeHtml(brand.mark)}" alt="${escapeHtml(brand.name)} mark from Simple Icons" loading="lazy">`
      : `<span class="brand-text-mark">${escapeHtml(brand.name)}</span>`;
  const collaborations = enrichment.collaborations.length
    ? `<ul class="brand-bullet-list">${enrichment.collaborations.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p>No collaboration examples in this local edition. That does not mean none exist.</p>`;
  const rarity = (window.BRAND_RARITY_FRAMEWORK || []).map(item => `<div class="rarity-tier"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span></div>`).join("");
  const summary = online?.summary ? `<section class="brand-online-summary"><h3>${brand.onlineCandidate ? "Saved online reference" : "Latest online reference"}</h3><p>${escapeHtml(online.summary)}</p><div class="brand-source-attribution">From <a href="${escapeHtml(online.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(online.title || brand.name)}</a> · Wikipedia contributors · CC BY-SA 4.0 · saved ${formatDate(online.retrievedAt)}${online.revisionId ? ` · revision ${escapeHtml(online.revisionId)}` : ""}</div></section>` : "";
  const logoCaption = imageUrl ? "Wikidata / Commons candidate · verify source" : hasBundledMark ? "Simple Icons mark · offline" : "Logo artwork not available";
  return `<article class="brand-guide-card card">
    <div class="brand-guide-head">
      <div class="brand-logo-stage ${imageUrl || hasBundledMark ? "has-brand-mark" : "text-brand-mark"}">${logoMarkup}</div>
      <div class="brand-title-copy"><div class="brand-kicker">${escapeHtml(brand.category)}</div><h2>${escapeHtml(brand.name)}</h2><div class="brand-meta">${escapeHtml(brand.origin)} · Founded ${escapeHtml(brand.founded)}</div></div>
      <span class="brand-logo-caption">${logoCaption}</span>
    </div>
    <div class="brand-guide-body">
      <p class="brand-overview">${escapeHtml(brand.overview)}</p>
      <div class="brand-fact-row"><span class="brand-fact-label">Known for</span><span>${escapeHtml(brand.notable)}</span></div>
      <div class="brand-reading-block"><h3>Brand background</h3><p>${escapeHtml(brand.guide)}</p></div>
      ${renderLogoAlbum(brand)}
      <div class="brand-reading-block tag-reading"><h3>Older wash tags &amp; label clues</h3><ul class="brand-bullet-list">${enrichment.washTags.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      <div class="brand-reading-block"><h3>Known collaborations &amp; partnerships</h3>${collaborations}</div>
      <section class="brand-rarity"><h3>Rarity clues · not a score</h3><p>${escapeHtml(enrichment.rarity)}</p><div class="rarity-scale">${rarity}</div><div class="rarity-caution">Rarity belongs to an exact item, variant, market, and condition. Require release evidence and provenance; this guide does not authenticate items or estimate value.</div></section>
      ${summary}
      <div class="brand-guide-foot"><span>${brand.onlineCandidate ? "Unverified online research lead" : escapeHtml(logoCaption)}</span><a href="${escapeHtml(brand.onlineCandidate ? brand.wikiUrl || brand.website : brand.website)}" target="_blank" rel="noopener noreferrer">${brand.onlineCandidate ? "Source article" : "Official brand site"} ↗</a></div>
    </div>
  </article>`;
}

function renderSearchMessage() {
  if (!brandQuery.trim() || visibleBrands().length) return "";
  if (!navigator.onLine) return `<div class="online-search-message">You are offline. Connect to look up an unsaved brand.</div>`;
  if (!state.preferences.webBrandUpdates) return `<div class="online-search-message">Online brand search is off. Enable it in Privacy to search Wikipedia.</div>`;
  if (onlineSearchStatus === "searching") return `<div class="online-search-message">Searching Wikipedia for a brand reference…</div>`;
  if (onlineSearchStatus === "error") return `<div class="online-search-message">The online lookup failed. The built-in guide remains available; try again later.</div>`;
  if (onlineSearchStatus === "saved") return `<div class="online-search-message saved">${escapeHtml(onlineSearchMessage)}. It is saved on this device.</div>`;
  if (suggestions.length) return `<div class="online-suggestion-list">${suggestions.map((item, index) => `<article class="online-suggestion"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.extract.slice(0, 260))}</p><small>Wikipedia · possible match, not yet saved</small></div><button class="secondary-button small-button" data-save-suggestion="${index}">Save reference</button></article>`).join("")}</div>`;
  if (onlineSearchStatus === "empty") return `<div class="online-search-message">No close brand reference found. Try another spelling.</div>`;
  return "";
}

function renderBrands() {
  const brands = visibleBrands();
  const status = !navigator.onLine ? "Offline · saved guide is available" : syncLabel || (state.lastBrandSync ? `Brand notes checked ${formatDate(state.lastBrandSync)}` : "Bundled brand guide · works offline");
  const logoStatus = !navigator.onLine ? "Logo source checks need internet" : logoSyncLabel || (state.lastLogoSync ? `Logo sources checked ${formatDate(state.lastLogoSync)}` : "Logo albums update from public Wikimedia records");
  return `<section class="guide-intro">
    <div><div class="eyebrow">YOUR PERSONAL REFERENCE</div><h1 class="page-title">The brand guide</h1><p class="page-subtitle">Browse brand histories, logo references, older labels, collaborations, and rarity clues. Wikipedia notes refresh daily and logo sources every 30 days; searching for another brand can add an unverified reference to this device.</p></div>
    <div class="guide-intro-actions"><button class="secondary-button small-button" data-sync-brands ${syncInProgress || !navigator.onLine || !state.preferences.webBrandUpdates ? "disabled" : ""}>Update brand notes</button><button class="secondary-button small-button" data-sync-logos ${logoSyncInProgress || !navigator.onLine || !state.preferences.webBrandUpdates ? "disabled" : ""}>Check logo sources</button></div>
  </section>
  <section class="brand-guide-intro card"><div><strong>${BRANDS.length} built-in brand guides${state.onlineBrands.length ? ` + ${state.onlineBrands.length} saved online` : ""}</strong><p>${escapeHtml(status)} · ${escapeHtml(logoStatus)}</p></div><span class="brand-guide-owner">ON THIS DEVICE</span></section>
  <div class="brand-guide-controls"><label class="filter-search"><span aria-hidden="true">⌕</span><input class="form-input" id="brand-search" type="search" placeholder="Search brands, tags, collaborations…" value="${escapeHtml(brandQuery)}" aria-label="Search brand guide"></label>
    <select class="filter-chip" id="brand-category" aria-label="Filter brand category">${brandCategories().map(category => `<option ${category === brandCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select>
    <span class="results-count">${brands.length} of ${allBrands().length} guides</span></div>
  <div class="brand-guide-notice"><span aria-hidden="true">ⓘ</span><span><strong>Online sources:</strong> when enabled, brand names are sent to Wikipedia, Wikidata, and Wikimedia Commons. Photos, profile information, and other activity are not sent. Logo images are sourced candidates; a Wikidata or file edit does not prove the brand officially adopted or retired a mark.</span></div>
  <div id="online-brand-search">${renderSearchMessage()}</div>
  ${brands.length ? `<div class="brand-guide-list">${brands.map(renderBrand).join("")}</div>` : `<section class="empty-state"><h2>No saved brand guide matches</h2><p>Try another search or connect to look up a brand reference.</p></section>`}
  <p class="brand-guide-credits">Logos and images remain the property of their respective owners and may have separate licences. Wikimedia file metadata is shown beside sourced candidates; check the original file and the brand's official channels before reuse. Bundled offline marks are provided by <a href="https://simpleicons.org/" target="_blank" rel="noopener noreferrer">Simple Icons</a>. Wikipedia text is attributed to its contributors under CC BY-SA 4.0. This is an independent personal reference, not an authentication service or endorsement.</p>`;
}

function renderIphoneHelp() {
  return `<section class="guide-intro"><div><div class="eyebrow">TAKE YOUR GUIDE WITH YOU</div><h1 class="page-title">Use UkayFind on iPhone</h1><p class="page-subtitle">Add this website to your Home Screen so it opens like an app. The saved brand guide can work offline after it has loaded.</p></div></section>
    <article class="help-card card"><h2>Publish the guide with GitHub Pages</h2><ol><li>Upload all guide files to the root of your GitHub repository, including the hidden <code>.github/workflows/pages.yml</code> workflow and <code>.nojekyll</code> file.</li><li>Push the files to the <strong>main</strong> or <strong>master</strong> branch. The included GitHub Actions workflow publishes the static site.</li><li>In GitHub, open <strong>Settings → Pages</strong> and select <strong>GitHub Actions</strong> as the deployment source if required.</li><li>Wait for the <strong>Publish UkayFind Brand Guide</strong> workflow to finish, then open the site URL shown in Pages settings. It is usually <code>https://YOUR-NAME.github.io/YOUR-REPOSITORY/</code>.</li></ol>
      <div class="help-callout"><strong>Privacy:</strong> GitHub Pages sites may be publicly readable. Do not publish secrets or private personal information. This site contains no server-side private-data controls; saved searches and logo albums are kept only in each browser and are not synced. Use a private HTTPS host with access controls if you want other people excluded.</div>
      <h2>Add it to your iPhone</h2><ol><li>Open the HTTPS GitHub Pages URL in <strong>Safari</strong> on your iPhone.</li><li>Tap the <strong>Share</strong> button (the square with an upward arrow).</li><li>Scroll the share menu and tap <strong>Add to Home Screen</strong>. If shown, turn on <strong>Open as Web App</strong>.</li><li>Tap <strong>Add</strong>. Open the new Home Screen icon once while connected to cache the guide shell.</li></ol>
      <div class="help-callout"><strong>Important for this computer:</strong> <code>http://127.0.0.1:18765/</code> only opens on the computer running the local server. It will not open on your iPhone. Publish the files with the steps above to get an HTTPS address.</div>
      <h2>After installing</h2><ul><li>Search and open brand pages while online; cached guide files and saved text stay on the device.</li><li>Logo album images are remote Wikimedia files and need internet unless your browser has separately cached them. The bundled Simple Icons marks work offline.</li><li>Use <strong>Privacy</strong> to turn off online updates. If disabled, brand-name searches and logo checks do not contact the reference services.</li><li>To get new site changes, reconnect and reload the Home Screen app. If it looks stale, close it and reopen it after the site update.</li></ul></article>`;
}

function renderPrivacy() {
  const enabled = Boolean(state.preferences.webBrandUpdates);
  return `<section class="guide-intro"><div><div class="eyebrow">YOUR DEVICE, YOUR CHOICE</div><h1 class="page-title">Privacy</h1><p class="page-subtitle">This is a personal, single-user reference guide. It has no account, application backend, or cross-device sync.</p></div></section>
    <article class="help-card card"><h2>Online reference lookup</h2><p>When enabled, the guide sends brand names to Wikipedia for text summaries and to Wikidata/Wikimedia Commons for logo-file candidates. Search terms may be received by those providers. Photos, your name, profile, and collection are not sent.</p>
      <div class="toggle-row"><div class="toggle-copy"><strong>Allow online brand and logo lookups</strong><small>Turn off to stop automatic refreshes and online brand/logo searches. The bundled guide remains available offline.</small></div><button class="toggle ${enabled ? "on" : ""}" role="switch" aria-checked="${enabled}" aria-label="Allow online brand and logo lookups" data-toggle-online></button></div>
      <h2>Where saved guide data lives</h2><p>Saved online brand references, summaries, logo-file links, logo-history snapshots, and this preference are stored in this browser’s local storage. Use Privacy → Clear saved online data to remove online discoveries and logo snapshots from this device. Built-in brand profiles remain.</p>
      <button class="secondary-button small-button" data-clear-online>Clear saved online data</button>
      <h2>Accuracy and image rights</h2><p>Logo records are Wikimedia community-maintained candidates, not official brand announcements. Changes in a Wikidata record are not proof of a real-world rebrand. Check the linked source and the official brand site. Verify each file’s licence and trademark terms before copying or publishing any image.</p></article>`;
}

function render() {
  const root = document.getElementById("app-content");
  if (!root) return;
  const routes = { brands: renderBrands, iphone: renderIphoneHelp, privacy: renderPrivacy };
  if (!routes[page]) page = "brands";
  root.innerHTML = routes[page]();
  root.querySelectorAll("[data-brand-logo]").forEach(image => {
    image.addEventListener("error", () => {
      if (image.dataset.fallbackSrc) {
        image.removeAttribute("data-brand-logo");
        image.src = image.dataset.fallbackSrc;
        image.alt = `${image.dataset.fallbackName} bundled offline mark`;
        return;
      }
      const wordmark = document.createElement("span");
      wordmark.className = "brand-text-mark";
      wordmark.textContent = image.dataset.fallbackName || "Brand";
      image.replaceWith(wordmark);
    }, { once: true });
  });
  root.querySelectorAll("[data-album-logo]").forEach(image => {
    image.addEventListener("error", () => {
      const placeholder = document.createElement("span");
      placeholder.className = "logo-image-unavailable";
      placeholder.textContent = "Image needs an internet connection";
      image.replaceWith(placeholder);
    }, { once: true });
  });
  document.querySelectorAll("[data-page]").forEach(link => link.classList.toggle("active", link.dataset.page === page));
}

async function syncBrandNotes(force = false) {
  if (syncInProgress || !navigator.onLine || !state.preferences.webBrandUpdates) return;
  if (!force && state.lastBrandSync && Date.now() - new Date(state.lastBrandSync).getTime() < DAY) return;
  syncInProgress = true;
  syncController = new AbortController();
  syncLabel = "Refreshing online brand notes…";
  if (page === "brands") render();
  const targets = [...BRANDS.map(brand => ({ brand, query: `${brand.name} brand company` })), ...state.onlineBrands.slice(0, 25).map(brand => ({ brand, query: brand.name }))];
  let next = 0;
  let updated = 0;
  let failures = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (next < targets.length) {
      const target = targets[next++];
      if (syncController.signal.aborted) return;
      try {
        const pages = await fetchWikipediaPage(target.query, syncController.signal);
        const exact = pages.find(result => similarity(target.brand.name, result.title) >= (target.brand.onlineCandidate ? 0.66 : 0.5) &&
          (target.brand.onlineCandidate || isBrandSummary(result.extract)) && !/often refers to|may refer to/i.test(result.extract));
        if (!exact) continue;
        if (target.brand.onlineCandidate) {
          target.brand.overview = exact.extract;
          target.brand.wikiRevisionId = exact.revisionId;
          target.brand.wikiRetrievedAt = exact.retrievedAt;
          target.brand.wikiUrl = exact.url;
        } else {
          updateWikipediaRecord(target.brand, exact);
        }
        updated++;
      } catch (error) {
        if (syncController.signal.aborted) return;
        failures++;
        console.warn(`Could not refresh the guide entry for ${target.brand.name}.`, error);
      }
    }
  });
  await Promise.all(workers);
  if (syncController.signal.aborted) {
    syncLabel = "Online brand updates cancelled";
    syncInProgress = false;
    syncController = null;
    render();
    return;
  }
  if (updated || !failures) {
    state.lastBrandSync = new Date().toISOString();
    persist();
  }
  syncLabel = `Brand notes: ${updated} refreshed${failures ? ` · ${failures} failed; retry later` : ""}`;
  syncInProgress = false;
  syncController = null;
  render();
}

function entitySearchUrl(name) {
  return apiUrl(WIKIDATA_API, { action: "wbsearchentities", search: name, language: "en", limit: "5" });
}

async function fetchLogoReference(brand, signal) {
  const search = await fetchJson(entitySearchUrl(brand.name), signal);
  const entity = (search.search || []).find(item => normalize(item.label) === normalize(brand.name) &&
    /\b(brand|company|fashion|sportswear|apparel|footwear|clothing|manufacturer|retailer|luxury|watch|camera|electronics)\b/i.test(item.description || ""));
  if (!entity) return null;

  const entityData = await fetchJson(apiUrl(WIKIDATA_API, {
    action: "wbgetentities", ids: entity.id, props: "claims", languages: "en"
  }), signal);
  const claims = entityData.entities?.[entity.id]?.claims?.P154 || [];
  const logoClaim = claims.find(item => item.rank === "preferred") || claims.find(item => item.rank === "normal");
  const fileName = logoClaim?.mainsnak?.datavalue?.value;
  if (typeof fileName !== "string" || !fileName.trim()) return null;

  const commonsData = await fetchJson(apiUrl(COMMONS_API, {
    action: "query", titles: `File:${fileName}`, prop: "imageinfo", iiprop: "url|timestamp|sha1|extmetadata", iilimit: "10", iiurlwidth: "600"
  }), signal);
  const file = Object.values(commonsData.query?.pages || {})[0];
  const versions = file?.imageinfo || [];
  const info = versions[0];
  if (!info?.url || !info.thumburl || !info.descriptionurl) return null;
  const meta = info.extmetadata || {};
  return {
    entityId: entity.id,
    entityUrl: `https://www.wikidata.org/wiki/${encodeURIComponent(entity.id)}`,
    fileName,
    imageUrl: info.url,
    thumbUrl: info.thumburl,
    filePage: info.descriptionurl,
    sha1: info.sha1 || null,
    uploadedAt: info.timestamp || null,
    checkedAt: new Date().toISOString(),
    license: meta.LicenseShortName?.value?.replace(/<[^>]*>/g, "").slice(0, 100) || "Licence not stated in file metadata",
    artist: meta.Artist?.value?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").slice(0, 100) || "",
    fileRevisions: versions.slice(1, 7).map(revision => ({
      fileName,
      imageUrl: revision.url,
      thumbUrl: revision.thumburl,
      filePage: revision.descriptionurl || info.descriptionurl,
      sha1: revision.sha1 || null,
      uploadedAt: revision.timestamp || null,
      license: meta.LicenseShortName?.value?.replace(/<[^>]*>/g, "").slice(0, 100) || "Licence not stated in file metadata",
      artist: meta.Artist?.value?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").slice(0, 100) || ""
    }))
  };
}

function mergeLogoRecord(previous, latest) {
  const { fileRevisions = [], ...current } = latest;
  const record = {
    entityId: current.entityId,
    entityUrl: current.entityUrl,
    historyCheckedAt: current.checkedAt,
    historyVersion: 3,
    history: previous?.history || [],
    current
  };
  if (!previous?.current) {
    record.history = fileRevisions.slice(0, 5).reverse().map(revision => ({
      ...revision,
      current: false,
      sourceRevision: true,
      archiveLabel: "Earlier Commons file revision",
      changeNote: "This is an earlier revision of the same repository file, not proof of an earlier official brand identity."
    }));
  } else {
    const sameFile = normalize(previous.current.fileName) === normalize(latest.fileName);
    const revisionChanged = Boolean(previous.current.sha1 && latest.sha1 && previous.current.sha1 !== latest.sha1);
    if (!sameFile || revisionChanged) {
      const archivedRevision = sameFile
        ? fileRevisions.find(revision => revision.sha1 && revision.sha1 === previous.current.sha1)
        : previous.current;
      if (archivedRevision) {
        const archivedSnapshot = sameFile
          ? { ...previous.current, ...archivedRevision, filePage: latest.filePage }
          : previous.current;
        record.history.push({
          ...archivedSnapshot,
          current: false,
          archivedAt: latest.checkedAt,
          archiveLabel: "Earlier linked logo-file record",
          changeNote: "Wikimedia source file content or link changed. This is not a verified brand rebrand."
        });
      } else {
        record.historyWarning = "A source revision changed, but Wikimedia no longer returned the matching earlier image revision, so it was not shown as an archived image.";
      }
    }
    if (!previous.current.sha1 || previous.historyVersion !== 3) {
      const seenRevisions = new Set(record.history.map(item => `${normalize(item.fileName)}:${item.sha1 || item.uploadedAt}`));
      const newlyVersioned = fileRevisions.slice(0, 5).reverse()
        .filter(revision => !seenRevisions.has(`${normalize(revision.fileName)}:${revision.sha1 || revision.uploadedAt}`))
        .map(revision => ({
          ...revision,
          current: false,
          sourceRevision: true,
          archiveLabel: "Earlier Commons file revision",
          changeNote: "This is an earlier revision of the same repository file, not proof of an earlier official brand identity."
        }));
      record.history.push(...newlyVersioned);
    }
  }
  if (record.history.length > 12) {
    record.history = record.history.slice(-12);
  }
  return record;
}

async function syncLogoRecords(force = false) {
  if (logoSyncInProgress || !navigator.onLine || !state.preferences.webBrandUpdates) return;
  if (!force && state.lastLogoSync && Date.now() - new Date(state.lastLogoSync).getTime() < LOGO_REFRESH_INTERVAL) return;
  logoSyncInProgress = true;
  logoSyncController = new AbortController();
  logoSyncLabel = "Checking sourced logo files…";
  if (page === "brands") render();
  let next = 0;
  let updated = 0;
  let noSource = 0;
  let failures = 0;
  const targets = [...BRANDS, ...state.onlineBrands.slice(0, 25)];
  const workers = Array.from({ length: 2 }, async () => {
    while (next < targets.length) {
      const brand = targets[next++];
      if (logoSyncController.signal.aborted) return;
      try {
        const latest = await fetchLogoReference(brand, logoSyncController.signal);
        if (!latest) {
          noSource++;
          continue;
        }
        state.logoRecords[brand.id] = mergeLogoRecord(state.logoRecords[brand.id], latest);
        updated++;
      } catch (error) {
        if (logoSyncController.signal.aborted) return;
        failures++;
        console.warn(`Could not check the logo source for ${brand.name}.`, error);
      }
    }
  });
  await Promise.all(workers);
  if (logoSyncController.signal.aborted) {
    logoSyncLabel = "Logo source checks cancelled";
    logoSyncInProgress = false;
    logoSyncController = null;
    render();
    return;
  }
  if (updated || !failures) {
    state.lastLogoSync = new Date().toISOString();
    persist();
  }
  logoSyncLabel = `Logo sources: ${updated} updated${noSource ? ` · ${noSource} not listed` : ""}${failures ? ` · ${failures} failed; retry later` : ""}`;
  logoSyncInProgress = false;
  logoSyncController = null;
  render();
}

document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const link = target.closest("[data-page]");
  if (link) {
    event.preventDefault();
    page = link.dataset.page || "brands";
    location.hash = page;
    document.querySelector(".guide-header nav")?.classList.remove("mobile-open");
    document.getElementById("menu-toggle")?.setAttribute("aria-expanded", "false");
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (target.closest("#menu-toggle")) {
    const nav = document.querySelector(".guide-header nav");
    const open = nav?.classList.toggle("mobile-open") || false;
    target.closest("#menu-toggle")?.setAttribute("aria-expanded", String(open));
    return;
  }
  if (target.closest("[data-sync-brands]")) {
    void syncBrandNotes(true);
    return;
  }
  if (target.closest("[data-sync-logos]")) {
    void syncLogoRecords(true);
    return;
  }
  const saveSuggestion = target.closest("[data-save-suggestion]");
  if (saveSuggestion) {
    const item = suggestions[Number(saveSuggestion.dataset.saveSuggestion)];
    if (!item) return;
    saveResearchLead(item);
    persist();
    onlineSearchMessage = `Saved ${item.title} locally as an unverified research lead`;
    onlineSearchStatus = "saved";
    render();
    return;
  }
  if (target.closest("[data-toggle-online]")) {
    state.preferences.webBrandUpdates = !state.preferences.webBrandUpdates;
    if (!state.preferences.webBrandUpdates) {
      searchController?.abort();
      syncController?.abort();
      logoSyncController?.abort();
      syncLabel = "Online lookups disabled";
      logoSyncLabel = "Online lookups disabled";
    }
    persist();
    render();
    return;
  }
  if (target.closest("[data-clear-online]")) {
    if (!window.confirm("Remove saved online brand discoveries, Wikipedia notes, logo images and logo-history snapshots from this browser? Built-in profiles will remain.")) return;
    searchController?.abort();
    syncController?.abort();
    logoSyncController?.abort();
    state.onlineBrands = [];
    state.brandUpdates = {};
    state.logoRecords = {};
    state.lastBrandSync = null;
    state.lastLogoSync = null;
    persist();
    brandQuery = "";
    page = "brands";
    location.hash = page;
    render();
    toast("Saved online reference data cleared.");
  }
});

document.addEventListener("input", event => {
  const input = event.target;
  if (input.id !== "brand-search") return;
  brandQuery = input.value;
  clearTimeout(searchTimer);
  searchController?.abort();
  suggestions = [];
  onlineSearchMessage = "";
  onlineSearchStatus = "idle";
  const cursor = input.selectionStart;
  render();
  const replacement = document.getElementById("brand-search");
  replacement?.focus();
  replacement?.setSelectionRange(cursor, cursor);
  if (brandQuery.trim().length >= 3 && visibleBrands().length === 0 && state.preferences.webBrandUpdates) {
    searchTimer = window.setTimeout(() => void searchOnlineBrand(brandQuery), 650);
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "brand-category") {
    brandCategory = event.target.value;
    render();
  }
});

window.addEventListener("hashchange", () => {
  page = location.hash.slice(1) || "brands";
  render();
});
window.addEventListener("online", () => {
  if (!state.preferences.webBrandUpdates) return;
  syncLabel = "Internet connected · saved guide is ready";
  render();
  void syncBrandNotes(false);
  void syncLogoRecords(false);
});
window.addEventListener("offline", () => {
  syncLabel = "Offline · using saved guide";
  logoSyncLabel = "Offline · logo images may need internet";
  render();
});

render();
persist();
if (!["brands", "iphone", "privacy"].includes(location.hash.slice(1))) {
  history.replaceState(null, "", "#brands");
}
if (state.preferences.webBrandUpdates && navigator.onLine) {
  void syncBrandNotes(false);
  void syncLogoRecords(false);
}
