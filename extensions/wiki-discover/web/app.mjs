// web/app.mjs — Preact view for the Wiki Discover canvas.
//
// Layout is a 3-part shell so the primary action (rating) is never below the
// fold: a fixed top bar, a scrolling <main> (tune panel + article + up-next),
// and a STICKY action bar pinned to the bottom. Secondary controls (interests,
// language, feedback counters, reset) are consolidated into one collapsible
// "Tune your feed" panel to keep the surface focused on the article.
//
// Accessibility: disclosures expose aria-expanded/aria-controls, catalog toggles
// expose aria-pressed, icon-only controls have aria-labels, and a polite live
// region announces the article when it changes (rating advances it silently).
//
// Two preference signals, both editable live and shared with the agent:
//   * INTERESTS — curated catalog or free-form; steer fetching + boost ranking.
//   * FEEDBACK — Like / Meh / Not for me. "Meh" is a gentle "not that into it".

import { html, mountCanvas, useState, useEffect, useRef, Icon, relativeTime } from "/kit/client.mjs";

const LANGS = [
  { code: "en", label: "English" },
  { code: "simple", label: "Simple English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "nl", label: "Nederlands" },
  { code: "ja", label: "日本語" },
  { code: "ru", label: "Русский" },
];

const INTEREST_CATALOG = [
  { group: "Science", topics: ["Astronomy", "Physics", "Biology", "Chemistry", "Mathematics", "Medicine"] },
  { group: "Technology", topics: ["Computer science", "Artificial intelligence", "Space exploration", "Robotics", "Video games"] },
  { group: "History", topics: ["Ancient Rome", "Ancient Egypt", "World War II", "Military history", "Archaeology"] },
  { group: "Geography & places", topics: ["Japan", "India", "Africa", "Mountains", "Rivers", "National parks"] },
  { group: "Arts & culture", topics: ["Music", "Film", "Painting", "Architecture", "Literature"] },
  { group: "Nature", topics: ["Animals", "Birds", "Dinosaurs", "Plants", "Oceans"] },
  { group: "Society", topics: ["Philosophy", "Economics", "Mythology", "Linguistics", "Politics"] },
  { group: "Sports", topics: ["Football", "Basketball", "Olympics", "Chess", "Cycling"] },
];

function topTopics(weights, n = 6) {
  return Object.entries(weights || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

// Canonical file segment of a Wikipedia image URL, used to skip the lead image
// (already shown big at the top) when it reappears in the gallery. Thumb URLs
// (.../thumb/x/xx/File.jpg/240px-File.jpg) put the filename second-to-last;
// direct upload URLs (.../x/xx/File.jpg) put it last — key on the real filename.
function fileKey(url) {
  if (!url) return "";
  try {
    const parts = decodeURIComponent(url).split("/");
    return (parts.includes("thumb") ? parts[parts.length - 2] : parts[parts.length - 1]) || "";
  } catch {
    return url;
  }
}

function TopBar({ connected }) {
  return html`
    <header class="wd-topbar">
      <div class="wd-brand">
        <${Icon} name="compass" size=${20} aria-hidden="true" />
        <h1>Wiki Discover</h1>
      </div>
      <span class="ck-status" aria-live="polite">
        <span class=${`ck-dot ${connected ? "ck-dot-live" : "ck-dot-off"}`}></span>
        ${connected ? "live" : "reconnecting…"}
      </span>
    </header>
  `;
}

function TunePanel({ state, invoke }) {
  const interests = state.interests || [];
  const stats = state.stats || {};
  const learned = topTopics(state.weights);
  const [open, setOpen] = useState(interests.length === 0);
  const [catOpen, setCatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const chosen = new Set(interests.map((i) => i.toLowerCase()));

  async function add(label) {
    const v = (label ?? draft).trim();
    if (!v) return;
    await invoke("add_interest", { interest: v });
    if (label == null) setDraft("");
  }
  function toggle(topic) {
    if (chosen.has(topic.toLowerCase())) invoke("remove_interest", { interest: topic });
    else invoke("add_interest", { interest: topic });
  }

  return html`
    <div class="wd-tune">
      <button
        class=${`wd-tunebar ${open ? "is-open" : ""}`}
        aria-expanded=${open}
        aria-controls="wd-tune-panel"
        onClick=${() => setOpen(!open)}
      >
        <span class="wd-tunelabel"><${Icon} name="sliders-horizontal" size=${15} aria-hidden="true" />Tune your feed</span>
        <span class="ck-caption">${interests.length ? `${interests.length} interest${interests.length === 1 ? "" : "s"}` : "no interests yet"}</span>
        <span class="ck-grow"></span>
        <span class="wd-counts">
          <span class="wd-count" style="color:var(--ck-success)" aria-label=${`${stats.liked || 0} liked`}>
            <${Icon} name="thumbs-up" size=${13} aria-hidden="true" />${stats.liked || 0}
          </span>
          <span class="wd-count" style="color:var(--ck-attention)" aria-label=${`${stats.meh || 0} meh`}>
            <${Icon} name="meh" size=${13} aria-hidden="true" />${stats.meh || 0}
          </span>
          <span class="wd-count" style="color:var(--ck-danger)" aria-label=${`${stats.disliked || 0} not for me`}>
            <${Icon} name="thumbs-down" size=${13} aria-hidden="true" />${stats.disliked || 0}
          </span>
        </span>
        <${Icon} name=${open ? "chevron-up" : "chevron-down"} size=${16} aria-hidden="true" />
      </button>

      ${open
        ? html`<div class="wd-tune-body" id="wd-tune-panel">
            <label class="wd-field" style="flex-direction:row;align-items:center;gap:8px">
              <span class="ck-caption">Wikipedia language</span>
              <select
                class="ck-select"
                style="width:auto"
                value=${state.lang}
                onChange=${(e) => invoke("set_lang", { lang: e.target.value })}
              >
                ${LANGS.map((l) => html`<option value=${l.code} key=${l.code}>${l.label}</option>`)}
              </select>
            </label>

            <div class="wd-field">
              <span class="ck-caption wd-field-label" id="wd-interest-label">Interests — steer & boost the feed</span>
              ${interests.length
                ? html`<div class="wd-chips">
                    ${interests.map(
                      (i) => html`<span class="ck-badge ck-badge-accent wd-chip" key=${i}>
                        ${i}
                        <button class="wd-chip-x" aria-label=${`Remove interest ${i}`} onClick=${() => invoke("remove_interest", { interest: i })}>
                          <${Icon} name="x" size=${12} aria-hidden="true" />
                        </button>
                      </span>`,
                    )}
                  </div>`
                : null}
              <div class="ck-row">
                <input
                  class="ck-input ck-grow"
                  aria-labelledby="wd-interest-label"
                  placeholder="Add an interest — a topic, place, person…"
                  value=${draft}
                  onInput=${(e) => setDraft(e.target.value)}
                  onKeyDown=${(e) => {
                    if (e.key === "Enter") add();
                  }}
                />
                <button class="ck-btn ck-btn-primary" disabled=${!draft.trim()} onClick=${() => add()}>
                  <${Icon} name="plus" size=${16} aria-hidden="true" />Add
                </button>
              </div>
              <button
                class="ck-btn ck-btn-sm"
                style="align-self:flex-start"
                aria-expanded=${catOpen}
                aria-controls="wd-catalog"
                onClick=${() => setCatOpen(!catOpen)}
              >
                <${Icon} name=${catOpen ? "chevron-up" : "chevron-down"} size=${14} aria-hidden="true" />
                ${catOpen ? "Hide suggestions" : "Browse topics"}
              </button>
              ${catOpen
                ? html`<div class="wd-catalog" id="wd-catalog">
                    ${INTEREST_CATALOG.map(
                      (cat) => html`<div key=${cat.group}>
                        <div class="ck-caption wd-cat-label">${cat.group}</div>
                        <div class="wd-chips">
                          ${cat.topics.map((t) => {
                            const active = chosen.has(t.toLowerCase());
                            return html`<button
                              key=${t}
                              class=${`ck-badge wd-pick ${active ? "ck-badge-success" : "ck-badge-muted"}`}
                              aria-pressed=${active}
                              onClick=${() => toggle(t)}
                            >
                              <${Icon} name=${active ? "check" : "plus"} size=${12} aria-hidden="true" />${t}
                            </button>`;
                          })}
                        </div>
                      </div>`,
                    )}
                  </div>`
                : null}
            </div>

            <div class="wd-tune-foot">
              ${learned.length
                ? html`<div class="wd-chips" style="flex:1">
                    <span class="ck-caption" style="align-self:center">Learned:</span>
                    ${learned.map(
                      (t) => html`<span class="ck-badge ck-badge-success" key=${t}>
                        <${Icon} name="sparkles" size=${12} aria-hidden="true" />${t}
                      </span>`,
                    )}
                  </div>`
                : html`<span class="ck-caption" style="flex:1">React below and it learns what you like.</span>`}
              <button
                class="ck-btn ck-btn-sm"
                title="Forget learned feedback (keeps your interests)"
                disabled=${!(stats.rated || learned.length)}
                onClick=${() => invoke("reset_preferences")}
              >
                <${Icon} name="rotate-ccw" size=${14} aria-hidden="true" />Reset
              </button>
            </div>
          </div>`
        : null}
    </div>
  `;
}

function Gallery({ article, leadSrc }) {
  const imgs = article.images || [];
  if (!imgs.length) return null;
  const leadKey = fileKey(leadSrc || article.thumbnail);
  const shown = imgs.filter((im) => fileKey(im.src) !== leadKey).slice(0, 8);
  if (!shown.length) return null;
  return html`
    <div>
      <div class="wd-gallery">
        ${shown.map((im, i) => {
          const label = im.caption || `${article.title} image ${i + 1}`;
          return html`
            <a
              class="wd-gimg"
              key=${im.src}
              href=${im.src}
              target="_blank"
              rel="noopener noreferrer"
              aria-label=${`${label} (opens in new tab)`}
            >
              <img
                src=${im.src}
                alt=${label}
                loading="lazy"
                onError=${(e) => {
                  const cell = e.target.closest(".wd-gimg");
                  if (cell) cell.style.display = "none";
                }}
              />
            </a>
          `;
        })}
      </div>
      <div class="ck-caption wd-gcount">
        <${Icon} name="image" size=${12} aria-hidden="true" /> ${shown.length} image${shown.length === 1 ? "" : "s"} from this article
      </div>
    </div>
  `;
}

function Article({ state }) {
  const a = state.current;
  if (!a) return null;
  const matched = a.matched || [];
  // Prefer the page's lead thumbnail; if it has none, fall back to the first
  // in-article image (from media-list) so the frame shows a real picture.
  const leadSrc = a.thumbnail || (a.images && a.images[0] && a.images[0].src) || "";
  return html`
    <article class="ck-card wd-article">
      <div class="wd-head">
        <div class=${`wd-lead ${leadSrc ? "has-img" : ""}`}>
          ${leadSrc
            ? html`<img
                src=${leadSrc}
                alt=""
                loading="lazy"
                onError=${(e) => {
                  e.target.style.display = "none";
                }}
              />`
            : html`<${Icon} name="image" size=${26} aria-hidden="true" />`}
        </div>
        <div class="wd-headtext">
          <h2 class="wd-title">
            <a href=${a.url} target="_blank" rel="noopener noreferrer" aria-label=${`${a.title} (opens on Wikipedia in a new tab)`}>${a.title}</a>
          </h2>
          <div class="wd-tags">
            ${a.description
              ? html`<span class="ck-badge ck-badge-accent"><${Icon} name="tag" size=${12} aria-hidden="true" />${a.description}</span>`
              : null}
            ${matched.length
              ? html`<span class="ck-badge ck-badge-success">
                  <${Icon} name="heart" size=${12} aria-hidden="true" /><span class="sr-only">Matches your interests: </span>${matched.slice(0, 3).join(", ")}
                </span>`
              : null}
          </div>
        </div>
      </div>
      <div class="wd-body">
        ${a.extract
          ? html`<p class="wd-extract">${a.extract}</p>`
          : html`<p class="wd-extract ck-muted">No summary available for this article.</p>`}
        <${Gallery} article=${a} leadSrc=${leadSrc} />
      </div>
    </article>
  `;
}

function UpNext({ state }) {
  const items = (state.queue || []).slice(0, 4);
  if (!items.length) return null;
  return html`
    <section aria-label="Up next">
      <div class="ck-spread wd-next-head">
        <span class="ck-caption">Up next</span>
        <span class="ck-caption">${(state.queue || []).length} queued</span>
      </div>
      <ul class="wd-next-list">
        ${items.map(
          (it) => html`
            <li class="wd-next-item" key=${it.id}>
              <span class="wd-next-title">
                ${(it.matched || []).length
                  ? html`<${Icon} name="heart" size=${12} aria-hidden="true" /><span class="sr-only">Matches your interests. </span> `
                  : null}
                ${it.title}
                ${it.description ? html`<span class="wd-next-desc"> · ${it.description}</span>` : null}
              </span>
              ${it.score > 0
                ? html`<span class="ck-badge ck-badge-success" aria-label=${`match strength ${it.score}`}>+${it.score}</span>`
                : it.score < 0
                  ? html`<span class="ck-badge ck-badge-muted" aria-label=${`match strength ${it.score}`}>${it.score}</span>`
                  : null}
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}

function ActionBar({ rating, rate }) {
  return html`
    <footer class="wd-actionbar">
      <button class="ck-btn wd-sentiment" disabled=${rating} onClick=${() => rate("up")} title="More like this">
        <${Icon} name="thumbs-up" size=${16} class="wd-ico-up" aria-hidden="true" />Like
      </button>
      <button class="ck-btn wd-sentiment" disabled=${rating} onClick=${() => rate("meh")} title="Not that into it — a little less of this">
        <${Icon} name="meh" size=${16} class="wd-ico-meh" aria-hidden="true" />Meh
      </button>
      <button class="ck-btn wd-sentiment" disabled=${rating} onClick=${() => rate("down")} title="Not for me">
        <${Icon} name="thumbs-down" size=${16} class="wd-ico-down" aria-hidden="true" />Not for me
      </button>
    </footer>
  `;
}

function App({ state, invoke, connected }) {
  // Single-flight guard so the auto-pump never stacks fetches or loops.
  const pumping = useRef(false);
  async function pump() {
    if (pumping.current) return;
    pumping.current = true;
    try {
      await invoke("next_article");
    } finally {
      pumping.current = false;
    }
  }

  // Lazily fetch the article's images once it's on screen. Bounded to two
  // attempts per id, so a transient media-list failure (which sets imagesError)
  // gets one retry but can never loop. Depends on id + imagesError (not
  // imagesLoaded) to avoid a redundant no-op run on success.
  const imgFor = useRef({ id: "", n: 0 });
  useEffect(() => {
    const cur = state?.current;
    if (!cur || cur.imagesLoaded) return;
    if (imgFor.current.id !== cur.id) imgFor.current = { id: cur.id, n: 0 };
    if (imgFor.current.n >= 2) return;
    imgFor.current.n += 1;
    invoke("load_images").catch(() => {});
  }, [state?.current?.id, state?.current?.imagesError]);

  // Load on first state and refill when the queue runs low. Gated on `!error`.
  useEffect(() => {
    if (!state || state.error) return;
    const low = !state.current || (state.queue?.length ?? 0) < 3;
    if (low) pump();
  }, [state?.current?.id, state?.queue?.length, state?.lang, state?.interests?.length, state?.error]);

  const [rating, setRating] = useState(false);
  const [actionError, setActionError] = useState("");
  async function rate(value) {
    if (rating || !state?.current) return;
    setRating(true);
    setActionError("");
    try {
      await invoke("rate", { value });
    } catch (err) {
      setActionError(`Couldn't record your rating: ${err?.message || err}. Please try again.`);
    } finally {
      setRating(false);
    }
  }

  if (!state) return html`<p class="ck-muted" style="padding:16px">Loading…</p>`;

  const loadingFirst = !state.current && !state.error;

  return html`<div class="wd-app">
    <${TopBar} connected=${connected} />
    <span class="sr-only" aria-live="polite">${state.current ? `Now showing: ${state.current.title}` : ""}</span>
    <main class="wd-scroll">
      <${TunePanel} state=${state} invoke=${invoke} />

      ${state.error
        ? html`<div class="ck-callout ck-error" role="alert" style="margin-bottom:12px">
            <${Icon} name="circle-x" size=${16} aria-hidden="true" />
            <span class="ck-grow">${state.error}</span>
            <button class="ck-btn ck-btn-sm" onClick=${() => invoke("next_article")}>
              <${Icon} name="refresh-cw" size=${14} aria-hidden="true" />Retry
            </button>
          </div>`
        : null}

      ${actionError
        ? html`<div class="ck-callout ck-error" role="alert" style="margin-bottom:12px">
            <${Icon} name="circle-x" size=${16} aria-hidden="true" />
            <span class="ck-grow">${actionError}</span>
            <button class="ck-btn ck-btn-sm" aria-label="Dismiss" onClick=${() => setActionError("")}>
              <${Icon} name="x" size=${14} aria-hidden="true" />
            </button>
          </div>`
        : null}

      ${state.current
        ? html`<${Article} state=${state} />`
        : loadingFirst
          ? html`<div class="ck-card" style="padding:16px" role="status" aria-label="Loading article">
              <div class="ck-skeleton" style="height:150px;margin-bottom:12px"></div>
              <div class="ck-skeleton" style="height:18px;width:60%;margin-bottom:8px"></div>
              <div class="ck-skeleton" style="height:14px;width:92%"></div>
            </div>`
          : html`<div class="ck-empty"><${Icon} name="compass" size=${20} aria-hidden="true" />No article loaded.</div>`}

      <${UpNext} state=${state} />

      <div class="ck-caption" style="text-align:center;margin-top:14px">
        ${state.lastRefresh ? `updated ${relativeTime(state.lastRefresh)}` : ""}
      </div>
    </main>

    ${state.current ? html`<${ActionBar} rating=${rating} rate=${rate} />` : null}
  </div>`;
}

mountCanvas({ view: (model) => html`<${App} ...${model} />` });
