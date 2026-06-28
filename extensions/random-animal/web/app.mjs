// web/app.mjs — Preact view for the Random Animal canvas.

import { html, mountCanvas, useState, Icon, relativeTime } from "/kit/client.mjs";

function AnimalCard({ animal, invoke }) {
  if (!animal) return null;
  const pending = !!animal.aiFactPending;
  return html`
    <div class="ck-card animal-card" style="text-align:center;padding:24px 16px">
      <div class="animal-emoji floating" style="font-size:72px;line-height:1;margin-bottom:12px">${animal.emoji}</div>
      <h2 class="animal-name" style="margin:0 0 8px">${animal.name}</h2>
      <p class="ck-muted animal-fact" style="margin:0;font-size:14px;line-height:1.5">${animal.fact}</p>

      ${animal.aiFact && html`
        <div class="ck-card" style="margin-top:14px;text-align:left;padding:10px 12px">
          <div class="ck-row" style="gap:6px;margin-bottom:4px">
            <${Icon} name="sparkles" size=${14} />
            <strong style="font-size:12px;text-transform:uppercase;letter-spacing:.04em">AI fun fact</strong>
          </div>
          <p class="ck-muted" style="margin:0;font-size:13px;line-height:1.5">${animal.aiFact}</p>
        </div>
      `}

      ${pending && html`
        <p class="ck-muted ck-row" style="justify-content:center;gap:6px;margin:12px 0 0;font-size:12px">
          <${Icon} name="loader" size=${14} /> Asking the AI for a fresh fact…
        </p>
      `}

      ${animal.aiFactError && !pending && html`
        <p class="ck-caption" style="margin:10px 0 0;font-size:12px;color:var(--ck-danger,#f85149)">${animal.aiFactError}</p>
      `}

      <div style="margin-top:14px">
        <button
          class="ck-btn ck-btn-sm"
          disabled=${pending}
          onClick=${() => invoke("request_ai_fact", {})}
        >
          <${Icon} name="sparkles" size=${14} />
          ${pending ? "Thinking…" : animal.aiFact ? "Another AI fact" : "Tell me more (AI)"}
        </button>
      </div>
    </div>
  `;
}

function HistoryItem({ animal, index }) {
  return html`
    <div class="ck-card ck-row history-item" style=${{gap:"10px",padding:"8px 12px",alignItems:"center",animationDelay:`${index*0.05}s`}}>
      <span style="font-size:24px">${animal.emoji}</span>
      <div style="flex:1;min-width:0">
        <strong>${animal.name}</strong>
        <div class="ck-muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${animal.fact}
        </div>
      </div>
      ${animal.rolledAt
        ? html`<span class="ck-caption ck-muted" style="flex:none;white-space:nowrap">${relativeTime(animal.rolledAt)}</span>`
        : null}
    </div>
  `;
}

function App({ state, invoke, connected }) {
  if (!state) return html`<p class="ck-muted">Loading…</p>`;
  const [rolling, setRolling] = useState(false);
  const current = state.current;
  const history = state.history ?? [];

  async function roll() {
    if (rolling) return;
    setRolling(true);
    try { await invoke("roll", {}); } finally { setRolling(false); }
  }

  return html`
    <div>
      <div class="ck-spread" style="margin-bottom:14px">
        <div class="ck-row" style="gap:8px">
          <${Icon} name="shuffle" size=${20} />
          <h1 style="margin:0">Random Animal</h1>
        </div>
        <span class="ck-status">
          <span class=${`ck-dot ${connected ? "ck-dot-live" : "ck-dot-off"}`}></span>
          ${connected ? "live" : "reconnecting…"}
        </span>
      </div>

      <div style="text-align:center;margin:12px 0 16px">
        <button
          class=${`ck-btn ck-btn-primary roll-btn ${rolling ? "roll-btn-rolling" : ""}`}
          style="font-size:16px;padding:10px 24px"
          disabled=${rolling}
          onClick=${roll}
        >
          <${Icon} name="dice-5" size=${20} />
          ${rolling ? "Rolling…" : current ? "Roll Again!" : "Roll a Random Animal!"}
        </button>
      </div>

      ${current && html`<${AnimalCard} key=${current.id} animal=${current} invoke=${invoke} />`}

      ${history.length > 0 && html`
        <div style="margin-top:20px">
          <div class="ck-spread" style="margin-bottom:8px">
            <div class="ck-row" style="gap:6px">
              <${Icon} name="history" size=${16} />
              <strong>History</strong>
              <span class="ck-badge">${history.length}</span>
            </div>
            <button class="ck-btn ck-btn-sm ck-btn-danger" onClick=${() => invoke("clear_history", {})}>
              <${Icon} name="trash-2" size=${14} />Clear
            </button>
          </div>
          <div class="ck-col" style="gap:6px">
            ${history.map((a, i) => html`<${HistoryItem} key=${a.id} animal=${a} index=${i} />`)}
          </div>
        </div>
      `}

      ${!current && !history.length && html`
        <div class="ck-empty" style="margin-top:16px">
          <span class="empty-paw"><${Icon} name="paw-print" size=${20} /></span>
          Click the button to discover a random animal!
        </div>
      `}
    </div>
  `;
}

mountCanvas({ view: (model) => html`<${App} ...${model} />` });
