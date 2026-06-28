// web/app.mjs - Preact view for the Code Tutor canvas.
//
// SHARED domain state (codebase, topics, findings, questions) arrives over SSE
// and is read-only here - mutate only via invoke(action, input). LOCAL UI state
// (active tab, filters, expanded panels, draft text, live slider position) lives
// in useState; Preact's DOM diffing keeps a live push from clobbering it.

import { html, mountCanvas, useState, useEffect, useRef, Icon, relativeTime, pollWhileVisible } from "/kit/client.mjs";
import { tokenize, toLines, languageFor } from "./highlight.mjs";

const LEVELS = ["eli5", "curious", "engineer", "wizard"];
const LEVEL_LABEL = { eli5: "ELI5", curious: "Curious", engineer: "Engineer", wizard: "Wizard" };
const LEVEL_TAG = { eli5: "like I'm 5", curious: "plain English", engineer: "technical", wizard: "deep magic" };
const LEVEL_ICON = { eli5: "baby", curious: "lightbulb", engineer: "wrench", wizard: "wand-sparkles" };
const LEVEL_COLOR = {
  eli5: "var(--lvl-eli5)",
  curious: "var(--lvl-curious)",
  engineer: "var(--lvl-engineer)",
  wizard: "var(--lvl-wizard)",
};

const CATEGORY_META = {
  algorithm: { icon: "workflow", label: "Algorithm", color: "#58a6ff" },
  "data-structure": { icon: "boxes", label: "Data structure", color: "#bc8cff" },
  complexity: { icon: "gauge", label: "Complexity", color: "#e3b341" },
  theory: { icon: "brain", label: "Theory", color: "#56d4dd" },
  pattern: { icon: "layers", label: "Pattern", color: "#3fb950" },
  paradigm: { icon: "git-fork", label: "Paradigm", color: "#f778ba" },
  concurrency: { icon: "waypoints", label: "Concurrency", color: "#f0883e" },
  system: { icon: "network", label: "System", color: "#a371f7" },
};
const catMeta = (c) => CATEGORY_META[c] ?? { icon: "book-open", label: c || "Topic", color: "var(--ck-accent)" };

const STATUS_META = {
  new: { icon: "circle-dashed", label: "Not started", color: "var(--ck-muted)" },
  understood: { icon: "circle-check", label: "Understood", color: "var(--ck-success)" },
  confused: { icon: "circle-x", label: "Stuck", color: "var(--ck-danger)" },
  revisit: { icon: "bookmark", label: "Revisit", color: "var(--ck-attention)" },
};
const STATUS_PICKER = ["understood", "confused", "revisit", "new"];
const STATUS_FILTER = ["understood", "confused", "revisit", "new"];

const QUALITY_META = {
  good: { icon: "thumbs-up", label: "Strengths", color: "var(--q-good)" },
  ok: { icon: "triangle-alert", label: "Could improve", color: "var(--q-ok)" },
  bad: { icon: "circle-x", label: "Issues", color: "var(--q-bad)" },
};
const QUALITY_ORDER = ["bad", "ok", "good"];
const FIX_COLOR = { open: "var(--ck-muted)", requested: "var(--ck-attention)", done: "var(--ck-success)" };

// A copy-able fallback prompt for the "Copy prompt" button (kept close to the
// server's injected prompt). The Refresh button normally injects this into the
// session automatically; this is here only for manual paste if needed.
const REFRESH_PROMPT =
  "Refresh the Code Tutor analysis for this codebase: open the Code Tutor canvas, call analysis_status to see what changed, re-read the relevant source, then call set_codebase to refresh the fingerprint and add or update topics, code references, and findings to match the current code.";

async function copy(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard API blocked in this webview; fall back below */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
const refString = (r) => `${r.file}${r.startLine ? `:${r.startLine}${r.endLine && r.endLine !== r.startLine ? `-${r.endLine}` : ""}` : ""}`;

// A copy button that confirms the click: it swaps to a check + "Copied" for a
// moment so the action is visibly acknowledged (clipboard writes are otherwise
// silent). Pass `label` for a text button, omit it for an icon-only button.
function CopyButton({ text, label, title, cls = "ck-btn ck-btn-sm", iconSize = 13, ariaLabel }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function onClick(e) {
    e.stopPropagation();
    const ok = await copy(text);
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }
  return html`
    <button
      type="button"
      class=${cls + (copied ? " is-copied" : "")}
      title=${copied ? "Copied" : title}
      aria-label=${(ariaLabel ?? title ?? label) + (copied ? " (copied)" : "")}
      onClick=${onClick}
    >
      <${Icon} name=${copied ? "check" : "copy"} size=${iconSize} />${label ? (copied ? "Copied" : label) : ""}
    </button>
  `;
}

// ---- small presentational helpers -----------------------------------------
function Pill({ color, icon, children }) {
  return html`<span class="cs-pill" style=${`--accent:${color}`}>
    ${icon ? html`<${Icon} name=${icon} size=${12} />` : null}${children}
  </span>`;
}

function Tile({ color, icon, size = 16, cls = "cs-tile-md" }) {
  return html`<span class=${`cs-tile ${cls}`} style=${`--accent:${color}`}><${Icon} name=${icon} size=${size} /></span>`;
}

// ---- brand mark ------------------------------------------------------------
// A graduation cap (the kit's Lucide cap glyph) framed by curly braces:
// "learning, in code". The cap is the hero (scaled up, non-scaling-stroke so its
// weight stays at 2) with thinner braces pulled to the edges, so it stays
// legible at the ~22px header tile. Rendered as a STATIC inline SVG (no dynamic
// content), mirroring how the kit's own Icon draws every glyph.
const BRAND_SVG = `<g stroke-width="1.6"><path d="M4 5c-1 0-1.4.6-1.4 1.5v2.3c0 .8-.5 1.4-1.2 1.4.7 0 1.2.6 1.2 1.4v2.3C2.6 16.4 3 17 4 17"/><path d="M20 5c1 0 1.4.6 1.4 1.5v2.3c0 .8.5 1.4 1.2 1.4-.7 0-1.2.6-1.2 1.4v2.3c0 .9-.4 1.5-1.4 1.5"/></g><g transform="translate(12 11) scale(0.62) translate(-12 -12)"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" vector-effect="non-scaling-stroke"/><path d="M22 10v6" vector-effect="non-scaling-stroke"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" vector-effect="non-scaling-stroke"/></g>`;

function BrandMark({ size = 22, label }) {
  const props = {
    xmlns: "http://www.w3.org/2000/svg",
    class: "ck-icon cs-brand",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    dangerouslySetInnerHTML: { __html: BRAND_SVG }, // static constant, no injection surface
  };
  if (label) {
    props.role = "img";
    props["aria-label"] = label;
  } else {
    props["aria-hidden"] = "true";
  }
  return html`<svg ...${props}></svg>`;
}

function BrandTile({ size = 22, cls = "cs-tile-lg", label }) {
  return html`<span class=${`cs-tile ${cls}`} style="--accent:var(--ck-accent)"><${BrandMark} size=${size} label=${label} /></span>`;
}

function ProgressRing({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 24;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return html`
    <div class="cs-ring" role="img" aria-label=${`${done} of ${total} topics understood`} title=${`${done} of ${total} understood`}>
      <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
        <circle class="cs-ring-track" cx="29" cy="29" r=${r} fill="none" stroke-width="6" />
        <circle class="cs-ring-val" cx="29" cy="29" r=${r} fill="none" stroke-width="6" stroke-dasharray=${c} stroke-dashoffset=${off} />
      </svg>
      <div class="cs-ring-label"><span class="cs-ring-pct">${pct}%</span><span class="cs-ring-sub">${done}/${total}</span></div>
    </div>
  `;
}

// ---- reading-level slider --------------------------------------------------
// `value` is the committed level; the slider owns a LOCAL index so dragging is
// instant. onPreview fires on drag (parent recolors + swaps the explanation);
// onCommit fires on release.
function LevelSlider({ value, onCommit, onPreview, label, compact }) {
  const committed = Math.max(0, LEVELS.indexOf(value));
  const [idx, setIdx] = useState(committed);
  useEffect(() => setIdx(committed), [committed]);
  const fill = (idx / (LEVELS.length - 1)) * 100;
  return html`
    <div class=${"cs-slider" + (compact ? " compact" : "")}>
      <input
        type="range"
        min="0"
        max=${LEVELS.length - 1}
        step="1"
        value=${idx}
        style=${`--cs-fill:${fill}%`}
        aria-label=${label || "Reading level"}
        onInput=${(e) => {
          const v = Number(e.target.value);
          setIdx(v);
          onPreview?.(LEVELS[v]);
        }}
        onChange=${(e) => onCommit(LEVELS[Number(e.target.value)])}
      />
      ${compact
        ? null
        : html`<div class="cs-scale">
            ${LEVELS.map(
              (l, i) => html`<button
                key=${l}
                type="button"
                class=${"cs-tick" + (i === idx ? " cs-tick-on" : "")}
                aria-label=${`Set reading level to ${LEVEL_LABEL[l]}`}
                aria-pressed=${String(i === idx)}
                onClick=${() => {
                  setIdx(i);
                  onPreview?.(LEVELS[i]);
                  onCommit(LEVELS[i]);
                }}
              >
                <${Icon} name=${LEVEL_ICON[l]} size=${11} />${LEVEL_LABEL[l]}
              </button>`
            )}
          </div>`}
    </div>
  `;
}

// Compact level control that slides in at the top once the full slider scrolls
// out of view. Same value + handlers as the header slider, so they stay in sync.
function StickyLevel({ level, stuck, onPreview, onCommit }) {
  return html`
    <div class=${"cs-sticky-level" + (stuck ? " stuck" : "")} style=${`--lvl:${LEVEL_COLOR[level]}`} aria-hidden=${String(!stuck)}>
      <div class="cs-sticky-cur">
        <${Icon} name=${LEVEL_ICON[level]} size=${15} />
        <span>${LEVEL_LABEL[level]}</span>
      </div>
      <div class="cs-sticky-slider">
        <${LevelSlider} value=${level} onPreview=${onPreview} onCommit=${onCommit} label="Reading level" compact=${true} />
      </div>
    </div>
  `;
}

function LevelPanel({ level, onPreview, onCommit, label, sub }) {
  return html`
    <div class="cs-level" style=${`--lvl:${LEVEL_COLOR[level]}`}>
      <div class="cs-level-top">
        <div class="cs-level-cur">
          <${Tile} color=${LEVEL_COLOR[level]} icon=${LEVEL_ICON[level]} size=${14} cls="cs-tile-sm" />
          <span class="cs-level-name">${LEVEL_LABEL[level]}</span>
          <span class="cs-level-tag">· ${LEVEL_TAG[level]}</span>
        </div>
        <span class="cs-section-label" style="margin:0">${label}</span>
      </div>
      <${LevelSlider} value=${level} onPreview=${onPreview} onCommit=${onCommit} label=${label} />
      ${sub ? html`<div class="ck-caption" style="margin-top:6px">${sub}</div>` : null}
    </div>
  `;
}

// ---- code viewer -----------------------------------------------------------
function CodeBlock({ data }) {
  const lang = languageFor(data.file);
  const lines = toLines(tokenize((data.lines || []).join("\n"), lang));
  return html`
    <div class="cs-code">
      ${lines.map((toks, idx) => {
        const num = data.fromLine + idx;
        const focus = data.focusStart && num >= data.focusStart && num <= data.focusEnd;
        return html`
          <div class=${"cs-code-line" + (focus ? " cs-code-focus" : "")}>
            <span class="cs-code-gutter">${num}</span>
            <span class="cs-code-src"
              >${toks.length ? toks.map((t, i) => html`<span key=${i} class=${"tok-" + t.t}>${t.v}</span>`) : html`<span> </span>`}</span
            >
          </div>
        `;
      })}
      ${data.truncated ? html`<div class="cs-code-foot">… window truncated · ${data.total} lines in file</div>` : null}
    </div>
  `;
}

function CodeRef({ r, invoke }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const lang = languageFor(r.file);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      setError(null);
      try {
        setData(await invoke("read_snippet", { file: r.file, startLine: r.startLine, endLine: r.endLine }));
      } catch (e) {
        setError(e?.message || "Couldn't load this file.");
      } finally {
        setLoading(false);
      }
    }
  }

  return html`
    <div class="cs-ref">
      <div class="cs-ref-headrow">
        <button class="cs-ref-head" aria-expanded=${String(open)} onClick=${toggle}>
          <${Icon} name=${open ? "chevron-down" : "chevron-right"} size=${14} style="flex:none;color:var(--ck-muted)" />
          <${Icon} name="file-code" size=${14} style="flex:none;color:var(--ck-muted)" />
          <span class="cs-ref-path">${r.file}${r.startLine
            ? html`<span class="cs-ref-line">:${r.startLine}${r.endLine && r.endLine !== r.startLine ? `-${r.endLine}` : ""}</span>`
            : null}</span>
          <span class="cs-lang">${lang === "unknown" ? "txt" : lang}</span>
        </button>
        <button
          type="button"
          class="cs-ref-copy"
          aria-label=${`Copy path ${refString(r)}`}
          title="Copy path"
          onClick=${(e) => { e.stopPropagation(); copy(refString(r)); }}
        ><${Icon} name="copy" size=${13} /></button>
      </div>
      ${r.note && !open ? html`<div class="cs-ref-note">${r.note}</div>` : null}
      ${open
        ? loading
          ? html`<div class="cs-ref-note"><${Icon} name="loader-circle" class="ck-spinner" size=${13} /> loading source…</div>`
          : error
          ? html`<div class="cs-ref-note" style="color:var(--ck-danger)"><${Icon} name="circle-x" size=${13} /> ${error}</div>`
          : data
          ? html`<div>${r.note ? html`<div class="cs-ref-note">${r.note}</div>` : null}<${CodeBlock} data=${data} /></div>`
          : null
        : null}
    </div>
  `;
}

function CodeRefs({ refs, invoke }) {
  if (!refs?.length) return null;
  return html`
    <div>
      <div class="cs-section-label"><${Icon} name="file-code" size=${13} />Code references</div>
      <div class="cs-refs">${refs.map((r, i) => html`<${CodeRef} key=${i} r=${r} invoke=${invoke} />`)}</div>
    </div>
  `;
}

// ---- per-topic Q&A ---------------------------------------------------------
// Live "the tutor is thinking" indicator. The host model call is a real round
// trip (often 10-60s on a reasoning model), so a static spinner reads as frozen.
// A ticking elapsed counter gives constant, honest progress and survives both
// re-renders and a brief host park-behind-screenshot. `since` is an ISO start
// time already in shared state (question.createdAt / topic.explaining.at).
function Thinking({ since, label = "The tutor is thinking", size = 14 }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const start = since ? new Date(since).getTime() : now;
  const secs = Number.isFinite(start) ? Math.max(0, Math.round((now - start) / 1000)) : 0;
  const hint =
    secs >= 45 ? "the session may be busy, still trying" :
    secs >= 25 ? "almost there" :
    secs >= 12 ? "still working" :
    "thinking";
  return html`<div class="cs-pending">
    <${Icon} name="loader-circle" class="ck-spinner" size=${size} />
    <span>${label}…</span>
    <span class="ck-caption cs-think-meta">${hint} · ${secs}s</span>
  </div>`;
}

function TopicQA({ topic, level, questions, invoke }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = questions.filter((q) => q.topicId === topic.id);

  async function ask() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await invoke("ask_question", { topicId: topic.id, level, text: t });
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div>
      <div class="cs-section-label"><${Icon} name="messages-square" size=${13} />Ask & clarify</div>
      <div class="cs-qa">
        ${mine.map(
          (q) => html`
            <div key=${q.id} class="cs-q">
              <div class="cs-q-text">
                <${Icon} class="cs-ico" name="circle-help" size=${14} />
                <span>${q.text}${q.level ? html` <span class="ck-caption">(${LEVEL_LABEL[q.level]})</span>` : null}</span>
              </div>
              ${q.answer
                ? html`<div class="cs-a-text">${q.answer}</div>`
                : html`<${Thinking} since=${q.createdAt} size=${13} />`}
            </div>
          `
        )}
        <div class="cs-ask">
          <textarea
            class="ck-textarea"
            placeholder=${`Ask about "${topic.title}" at the ${LEVEL_LABEL[level]} level…`}
            value=${text}
            rows="2"
            onInput=${(e) => setText(e.target.value)}
            onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); ask(); } }}
          ></textarea>
          <div class="ck-row">
            <button class="ck-btn ck-btn-sm ck-btn-primary" disabled=${!text.trim() || busy} onClick=${ask}>
              <${Icon} name="send" size=${14} />Ask the tutor
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- topic accordion card --------------------------------------------------
// Renders at the single global `level` (the header slider controls it). No
// per-topic slider: one level applies to every topic.
function TopicCard({ topic, level, questions, open, onToggle, invoke }) {
  const explanation = topic.explanations?.[level];
  const cat = catMeta(topic.category);
  const st = STATUS_META[topic.status] ?? STATUS_META.new;

  return html`
    <div class="cs-topic" style=${`--accent:${cat.color}`}>
      <button class="cs-topic-head" aria-expanded=${String(open)} onClick=${onToggle}>
        <${Tile} color=${cat.color} icon=${cat.icon} size=${17} />
        <div class="cs-topic-main">
          <div class="cs-topic-title">${topic.title}</div>
          <div class="cs-cat-label">${cat.label}</div>
          ${topic.summary ? html`<div class="cs-topic-summary">${topic.summary}</div>` : null}
        </div>
        <div class="cs-topic-aside">
          <${Pill} color=${st.color} icon=${st.icon}>${st.label}<//>
        </div>
        <${Icon} class="cs-chevron" name=${open ? "chevron-down" : "chevron-right"} size=${18} />
      </button>

      ${open
        ? html`
            <div class="cs-topic-body">
              <div class="cs-divider"></div>

              ${explanation
                ? html`<div>
                    ${(topic.cachedLevels ?? []).includes(level)
                      ? html`<div class="cs-from-cache"><${Icon} name="library" size=${12} /> reused from the concept library</div>`
                      : null}
                    <div class="cs-prose">${explanation}</div>
                  </div>`
                : (() => {
                    const explaining = topic.explaining?.level === level;
                    const err = topic.explainError?.level === level ? topic.explainError.message : null;
                    const getIt = async () => {
                      const r = await invoke("fill_from_cache", { topicId: topic.id, level });
                      if (!r?.hit) await invoke("request_explanation", { topicId: topic.id, level });
                    };
                    if (explaining) {
                      return html`<div class="ck-callout">
                        <${Thinking} since=${topic.explaining?.at} label=${`Asking the tutor for a ${LEVEL_LABEL[level]} explanation`} size=${16} />
                      </div>`;
                    }
                    return html`<div class="ck-callout">
                      <${Icon} name=${err ? "triangle-alert" : "info"} size=${16} />
                      <span>
                        ${err ? err : html`No ${LEVEL_LABEL[level]} explanation yet.`}
                        <button class="ck-btn ck-btn-sm" style="margin-left:8px" onClick=${getIt}>
                          <${Icon} name=${err ? "refresh-cw" : "sparkles"} size=${13} />${err ? "Try again" : "Get this explanation"}
                        </button>
                      </span>
                    </div>`;
                  })()}

              ${topic.keyPoints?.length
                ? html`
                    <div>
                      <div class="cs-section-label"><${Icon} name="list-checks" size=${13} />Key points</div>
                      <ul class="cs-points">
                        ${topic.keyPoints.map(
                          (p, i) => html`<li key=${i}><${Icon} class="cs-ico" name="check" size=${14} /><span>${p}</span></li>`
                        )}
                      </ul>
                    </div>
                  `
                : null}

              <${CodeRefs} refs=${topic.refs} invoke=${invoke} />

              <div>
                <div class="cs-section-label"><${Icon} name="brain" size=${13} />Mark your understanding</div>
                <div class="cs-status-row">
                  ${STATUS_PICKER.map((s) => {
                    const m = STATUS_META[s];
                    const on = topic.status === s;
                    return html`
                      <button
                        key=${s}
                        class=${`cs-status-btn${on ? " cs-on" : ""}`}
                        style=${`--accent:${m.color}`}
                        onClick=${() => invoke("set_topic_status", { id: topic.id, status: s })}
                      >
                        <${Icon} name=${m.icon} size=${14} />${m.label}
                      </button>
                    `;
                  })}
                </div>
              </div>

              <${TopicQA} topic=${topic} level=${level} questions=${questions} invoke=${invoke} />
            </div>
          `
        : null}
    </div>
  `;
}

// ---- findings --------------------------------------------------------------
function FindingCard({ f, topicTitle, invoke }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const m = QUALITY_META[f.quality] ?? QUALITY_META.ok;
  return html`
    <div class=${`cs-finding ${f.quality}`}>
      <div class="cs-finding-head">
        <${Tile} color=${m.color} icon=${m.icon} size=${16} />
        <div style="flex:1;min-width:0">
          <div class="cs-finding-title">${f.title}</div>
          ${topicTitle || (f.fixStatus && f.fixStatus !== "open")
            ? html`<div class="cs-meta">
                ${topicTitle ? html`<span class="cs-chip"><${Icon} name="book-open" size=${11} />${topicTitle}</span>` : null}
                ${f.fixStatus && f.fixStatus !== "open" ? html`<${Pill} color=${FIX_COLOR[f.fixStatus]}>${f.fixStatus}</${Pill}>` : null}
              </div>`
            : null}
        </div>
      </div>

      ${f.detail ? html`<div class="cs-prose" style="font-size:var(--fs-sm)">${f.detail}</div>` : null}
      ${f.file ? html`<${CodeRef} r=${{ file: f.file, startLine: f.startLine, endLine: f.endLine }} invoke=${invoke} />` : null}
      ${f.suggestion ? html`<div class="cs-suggest"><strong>Fix:</strong> ${f.suggestion}</div>` : null}
      ${showPrompt && f.fixPrompt ? html`<div class="cs-fixprompt">${f.fixPrompt}</div>` : null}

      <div class="cs-finding-actions">
        ${f.fixPrompt
          ? html`
              <button class="ck-btn ck-btn-sm ck-btn-primary" onClick=${async () => {
                copy(f.fixPrompt);
                await invoke("set_fix_status", { id: f.id, status: "requested" });
              }}>
                <${Icon} name="wrench" size=${14} />Request fix session
              </button>
              <button class="ck-btn ck-btn-sm" onClick=${() => setShowPrompt((v) => !v)}>
                <${Icon} name=${showPrompt ? "chevron-down" : "chevron-right"} size=${14} />${showPrompt ? "Hide" : "Show"} prompt
              </button>
            `
          : null}
        ${f.fixStatus === "requested"
          ? html`<button class="ck-btn ck-btn-sm" onClick=${() => invoke("set_fix_status", { id: f.id, status: "done" })}>
              <${Icon} name="check" size=${14} />Mark fixed
            </button>`
          : null}
        <span class="cs-spacer"></span>
        <button class="cs-linkbtn" type="button" aria-label="Delete finding" title="Delete finding" onClick=${() => invoke("remove_finding", { id: f.id })}>
          <${Icon} name="trash-2" size=${13} />
        </button>
      </div>
      ${f.fixStatus === "requested"
        ? html`<div class="ck-caption"><${Icon} name="info" size=${12} /> Prompt copied - ask Copilot to start a session, or it'll pick this up.</div>`
        : null}
    </div>
  `;
}

// ---- tabs ------------------------------------------------------------------
function Tabs({ tab, setTab, counts }) {
  const tabs = [
    { id: "learn", label: "Learn", icon: "graduation-cap", n: counts.topics },
    { id: "review", label: "Code review", icon: "scan-search", n: counts.findings },
    { id: "questions", label: "Q&A", icon: "messages-square", n: counts.pending },
  ];
  return html`
    <div class="cs-tabbar" role="tablist">
      ${tabs.map(
        (t) => html`
          <button key=${t.id} class="cs-tab" role="tab" aria-selected=${String(tab === t.id)} onClick=${() => setTab(t.id)}>
            <${Icon} name=${t.icon} size=${15} />${t.label}${t.n ? html`<span class="cs-tab-n">${t.n}</span>` : null}
          </button>
        `
      )}
    </div>
  `;
}

// ---- tab bodies ------------------------------------------------------------
function LearnTab({ state, level, openIds, toggle, invoke }) {
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState("all");
  const topics = state.topics ?? [];
  const cats = ["all", ...Array.from(new Set(topics.map((t) => t.category)))];
  let shown = topics;
  if (cat !== "all") shown = shown.filter((t) => t.category === cat);
  if (status !== "all") shown = shown.filter((t) => t.status === status);
  const rank = { confused: 0, revisit: 1, new: 2, understood: 3 };
  shown = [...shown].sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2));

  // Live counts per status (from the full set, not the filtered view).
  const countBy = { understood: 0, confused: 0, revisit: 0, new: 0 };
  for (const t of topics) if (t.status in countBy) countBy[t.status]++;

  if (!topics.length) {
    return html`
      <div class="cs-empty">
        <${BrandTile} size=${24} />
        <h3>No curriculum yet</h3>
        <p>Ask Copilot to analyze this codebase. The CS concepts it teaches will appear here, each with
          explanations at your chosen level, real code references, and a code review.</p>
        <div class="cs-prompt">Analyze this repo and teach me the CS theory in it.</div>
      </div>
    `;
  }

  const statusChips = [
    { id: "all", icon: "layers", label: "All", color: "var(--ck-accent)", n: topics.length },
    ...STATUS_FILTER.map((s) => ({ id: s, icon: STATUS_META[s].icon, label: STATUS_META[s].label, color: STATUS_META[s].color, n: countBy[s] })),
  ];

  return html`
    <div>
      <div class="cs-toolbar">
        <label class="cs-field">
          <span class="cs-field-label">Category</span>
          <select class="ck-select" aria-label="Filter by category" value=${cat} onChange=${(e) => setCat(e.target.value)}>
            ${cats.map((c) => html`<option key=${c} value=${c}>${c === "all" ? "All categories" : catMeta(c).label}</option>`)}
          </select>
        </label>
        <div class="cs-field">
          <span class="cs-field-label">Your progress</span>
          <div class="cs-statusbar" role="group" aria-label="Filter by progress">
            ${statusChips.map(
              (c) => html`
                <button
                  key=${c.id}
                  class=${"cs-stat" + (status === c.id ? " on" : "")}
                  style=${`--accent:${c.color}`}
                  aria-pressed=${String(status === c.id)}
                  onClick=${() => setStatus(c.id)}
                >
                  <${Icon} name=${c.icon} size=${13} />${c.label}<span class="cs-stat-n">${c.n}</span>
                </button>
              `
            )}
          </div>
        </div>
      </div>
      <div class="cs-list">
        ${shown.length
          ? shown.map(
              (t) => html`<${TopicCard}
                key=${t.id}
                topic=${t}
                level=${level}
                questions=${state.questions ?? []}
                open=${openIds.includes(t.id)}
                onToggle=${() => toggle(t.id)}
                invoke=${invoke}
              />`
            )
          : html`<div class="cs-empty"><${Icon} name="filter" size=${20} /><p>No topics match this filter.</p></div>`}
      </div>
    </div>
  `;
}

function ReviewTab({ state, invoke }) {
  const findings = state.findings ?? [];
  const byId = Object.fromEntries((state.topics ?? []).map((t) => [t.id, t.title]));
  if (!findings.length) {
    return html`
      <div class="cs-empty">
        <${Tile} color="var(--q-bad)" icon="scan-search" size=${24} cls="cs-tile-lg" />
        <h3>No code review yet</h3>
        <p>As the tutor reads the code it flags strengths, so-so spots, and real issues - perf, wrong data
          structures, suboptimal algorithms - each with a one-click fix session.</p>
      </div>
    `;
  }
  return html`
    <div>
      ${QUALITY_ORDER.map((q) => {
        const group = findings.filter((f) => f.quality === q);
        if (!group.length) return null;
        const m = QUALITY_META[q];
        return html`
          <div key=${q} class="cs-find-group">
            <div class="cs-find-ghead">
              <${Tile} color=${m.color} icon=${m.icon} size=${15} cls="cs-tile-sm" />
              <h3>${m.label}</h3>
              <span class="cs-count">${group.length}</span>
            </div>
            <div class="cs-list">${group.map((f) => html`<${FindingCard} key=${f.id} f=${f} topicTitle=${byId[f.topicId]} invoke=${invoke} />`)}</div>
          </div>
        `;
      })}
    </div>
  `;
}

function QuestionsTab({ state, invoke }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const questions = state.questions ?? [];
  const byId = Object.fromEntries((state.topics ?? []).map((t) => [t.id, t.title]));

  async function ask() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await invoke("ask_question", { text: t });
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="ck-col">
      <div class="cs-ask" style="background:var(--ck-bg-muted);border:1px solid var(--ck-border);border-radius:var(--r-md);padding:11px">
        <textarea
          class="ck-textarea"
          placeholder="Ask the tutor anything about this codebase or its CS concepts…"
          value=${text}
          rows="2"
          onInput=${(e) => setText(e.target.value)}
        ></textarea>
        <div class="ck-row">
          <button class="ck-btn ck-btn-primary ck-btn-sm" disabled=${!text.trim() || busy} onClick=${ask}>
            <${Icon} name="send" size=${14} />Ask
          </button>
          <span class="ck-caption">Answers appear here in the panel.</span>
        </div>
      </div>

      ${questions.length
        ? html`<div class="cs-qa">
            ${questions.map(
              (q) => html`
                <div key=${q.id} class="cs-q">
                  <div class="cs-q-text">
                    <${Icon} class="cs-ico" name="circle-help" size=${14} />
                    <span>${q.text}
                      ${q.topicId && byId[q.topicId] ? html` <span class="ck-caption">· ${byId[q.topicId]}</span>` : null}
                      ${q.level ? html` <span class="ck-caption">(${LEVEL_LABEL[q.level]})</span>` : null}
                    </span>
                    <span class="cs-spacer"></span>
                    <button class="cs-linkbtn" type="button" onClick=${() => invoke("remove_question", { id: q.id })} aria-label="Delete question" title="Delete">
                      <${Icon} name="trash-2" size=${13} />
                    </button>
                  </div>
                  ${q.answer
                    ? html`<div class="cs-a-text">${q.answer}</div>`
                    : html`<${Thinking} since=${q.createdAt} size=${13} />`}
                </div>
              `
            )}
          </div>`
        : html`<div class="cs-empty"><${Icon} name="messages-square" size=${20} /><p>No questions yet.</p></div>`}
    </div>
  `;
}

// ---- header ----------------------------------------------------------------
function Freshness({ state, analysis, onRefresh }) {
  const requested = !!state.refreshRequestedAt;
  const stale = analysis?.stale;
  if (requested) {
    return html`
      <div class="cs-fresh cs-fresh-pending">
        <${Icon} name="loader-circle" class="ck-spinner" size=${15} />
        <span>Re-analysis requested. Copilot is refreshing the board.</span>
        <button class="ck-btn ck-btn-sm" title="Copy the prompt in case you want to run it manually" onClick=${() => copy(REFRESH_PROMPT)}><${Icon} name="copy" size=${13} />Copy prompt</button>
      </div>
    `;
  }
  if (stale) {
    return html`
      <div class="cs-fresh cs-fresh-stale">
        <${Icon} name="triangle-alert" size=${14} />
        <span>The code changed since this was analyzed${analysis?.scannedAt ? ` ${relativeTime(analysis.scannedAt)}` : ""}.</span>
        <button class="ck-btn ck-btn-sm" onClick=${onRefresh}><${Icon} name="refresh-cw" size=${13} />Refresh</button>
      </div>
    `;
  }
  return null;
}

function Header({ state, connected, analysis, onRefresh, level, onLevelPreview, onLevelCommit }) {
  const cb = state.codebase;
  const topics = state.topics ?? [];
  const understood = topics.filter((t) => t.status === "understood").length;
  const fresh = analysis && analysis.configured && analysis.comparable && !analysis.stale && !state.refreshRequestedAt;

  return html`
    <div>
      <div class="cs-hero">
        <div class="cs-hero-top">
          <${BrandTile} size=${22} />
          <div class="cs-hero-title">
            <h1>Code Tutor</h1>
            <span class="cs-hero-tag">learn how your code really works</span>
            <span class="ck-status" style="margin-top:3px">
              <span class=${`ck-dot ${connected ? "ck-dot-live" : "ck-dot-off"}`}></span>${connected ? "live" : "reconnecting…"}
            </span>
          </div>
          ${topics.length ? html`<${ProgressRing} done=${understood} total=${topics.length} />` : null}
        </div>
      </div>

      ${cb
        ? html`
            <div class="cs-codebase">
              <${Tile} color="var(--lvl-wizard)" icon="folder-git-2" size=${17} />
              <div class="cs-cb-body">
                <div class="cs-cb-label">
                  <span>${cb.label}</span>
                  <span class="cs-spacer"></span>
                  ${cb.root
                    ? html`<button class="cs-refresh-btn" type="button" aria-label="Refresh analysis" title="Refresh analysis" onClick=${onRefresh}>
                        <${Icon} name="refresh-cw" size=${13} />
                      </button>`
                    : null}
                </div>
                ${cb.summary ? html`<div class="cs-cb-summary">${cb.summary}</div>` : null}
                <div class="cs-meta">
                  ${(cb.languages ?? []).map((l) => html`<span key=${l} class="cs-chip"><${Icon} name="code" size=${11} />${l}</span>`)}
                  ${cb.fileCount ? html`<span class="cs-chip"><${Icon} name="files" size=${11} />${cb.fileCount} files</span>` : null}
                  ${cb.scannedAt
                    ? html`<span class="ck-caption">
                        ${fresh ? html`<${Icon} name="circle-check" size=${11} style="color:var(--ck-success)" /> ` : ""}analyzed ${relativeTime(cb.scannedAt)}
                      </span>`
                    : null}
                </div>
              </div>
            </div>
            <${Freshness} state=${state} analysis=${analysis} onRefresh=${onRefresh} />
          `
        : null}

      <${LevelPanel}
        level=${level}
        label="Reading level"
        sub="Sets how deep every explanation goes, from ELI5 to Wizard. Drag it and each topic re-explains itself at that level."
        onPreview=${onLevelPreview}
        onCommit=${onLevelCommit}
      />
    </div>
  `;
}

// ---- app -------------------------------------------------------------------
function App({ state, invoke, connected }) {
  const [tab, setTab] = useState("learn");
  const [openIds, setOpenIds] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  // Live preview of the single global level while dragging the slider; null when
  // committed. Cleared once the committed defaultLevel lands via SSE (same value,
  // so no flash). Every topic renders at `level`.
  const [preview, setPreview] = useState(null);
  // The compact level bar shows once the full header slider scrolls out of view.
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef(null);

  const fp = state?.codebase?.fingerprint;
  const scannedAt = state?.codebase?.scannedAt;
  const refreshAt = state?.refreshRequestedAt;
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const a = await invoke("analysis_status");
        if (alive) setAnalysis(a);
      } catch {
        /* transient; the next tick retries */
      }
    };
    tick();
    const stop = pollWhileVisible(tick, 45);
    return () => {
      alive = false;
      stop();
    };
  }, [fp, scannedAt, refreshAt]);

  const committedLevel = state?.defaultLevel ?? "engineer";
  useEffect(() => setPreview(null), [committedLevel]);

  // Stick the compact bar once the sentinel (placed just below the full slider)
  // scrolls above the top. We measure on scroll/resize with getBoundingClientRect
  // rather than using an IntersectionObserver on a 1px sentinel: a viewport-rooted
  // IO never fires when the canvas scrolls an INNER container (as the native host
  // webview can) instead of the window, and a 1px target is fragile under
  // fractional device-pixel ratios. A capture-phase scroll listener catches
  // scrolling on any ancestor container; rAF throttles the measurement.
  const ready = !!state;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      setStuck(el.getBoundingClientRect().top <= 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure(); // initial state (e.g. restored scroll position)
    // Capture phase + passive so we observe scroll from the window OR any inner
    // scroll container (scroll events don't bubble, but capture sees them).
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [ready]);

  if (!state) return html`<div class="cs-app"><p class="ck-muted">Loading curriculum…</p></div>`;

  const level = preview ?? committedLevel;
  const toggle = (id) => setOpenIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const onRefresh = () => invoke("request_refresh");
  const onLevelPreview = (lvl) => setPreview(lvl);
  const onLevelCommit = (lvl) => {
    setPreview(lvl); // hold the new value until SSE confirms it (no flash)
    invoke("set_level", { level: lvl });
  };
  const counts = {
    topics: (state.topics ?? []).length,
    findings: (state.findings ?? []).length,
    pending: (state.questions ?? []).filter((q) => !q.answer).length,
  };

  return html`
    <div class="cs-app">
      <${StickyLevel} level=${level} stuck=${stuck} onPreview=${onLevelPreview} onCommit=${onLevelCommit} />
      <${Header}
        state=${state}
        connected=${connected}
        analysis=${analysis}
        onRefresh=${onRefresh}
        level=${level}
        onLevelPreview=${onLevelPreview}
        onLevelCommit=${onLevelCommit}
      />
      <div ref=${sentinelRef} class="cs-level-sentinel" aria-hidden="true"></div>
      <${Tabs} tab=${tab} setTab=${setTab} counts=${counts} />
      ${tab === "learn"
        ? html`<${LearnTab} state=${state} level=${level} openIds=${openIds} toggle=${toggle} invoke=${invoke} />`
        : tab === "review"
        ? html`<${ReviewTab} state=${state} invoke=${invoke} />`
        : html`<${QuestionsTab} state=${state} invoke=${invoke} />`}
    </div>
  `;
}

mountCanvas({ view: (model) => html`<${App} ...${model} />` });
