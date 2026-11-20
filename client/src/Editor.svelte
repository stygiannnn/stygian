<script>
  import Profile from "./Profile.svelte";
  let { user, onClose } = $props();

  let loading = $state(true);
  let saving = $state(false);
  let savedMsg = $state("");
  let dragIndex = $state(-1);
  let socials = $state([]);
  let socialBusy = $state("");
  let cursorList = $state([]);
  let cursorLoading = $state(false);
  let cursorErr = $state("");

  let data = $state(defaults());

  function defaults() {
    return {
      displayName: "",
      bio: "",
      config: {
        theme: {
          bg: "#0a0a0f",
          bgMode: "color",
          bgGradient: { from: "#4f46e5", to: "#0a0a0f", angle: 135 },
          bgImage: "",
          text: "#e7e5e4",
          cursor: "",
          card: { mode: "gradient", color: "#111117", from: "#1b1b2e", to: "#111117", angle: 135, scale: 100 },
          name: { effect: "gradient", color: "#ffffff", from: "#8b5cf6", to: "#ec4899" },
        },
        urlStyle: "plain",
        layout: "background",
        banner: "",
        status: "",
        avatar: "",
        links: [],
        music: { url: "", label: "" },
        spotifyNowPlaying: false,
      },
    };
  }

  async function load() {
    try {
      const res = await fetch("/api/me/profile");
      const d = await res.json();
      if (d.ok) {
        const base = defaults().config.theme;
        const c = d.profile.config || {};
        const t = c.theme || {};
        // migrate legacy nameGradient -> name effect
        let name = base.name;
        if (t.name && t.name.effect) name = { effect: t.name.effect, color: t.name.color || base.name.color, from: t.name.from || base.name.from, to: t.name.to || base.name.to };
        else if (t.nameGradient?.enabled) name = { effect: "gradient", color: "#ffffff", from: t.nameGradient.from || base.name.from, to: t.nameGradient.to || base.name.to };
        data = {
          displayName: d.profile.displayName || "",
          bio: d.profile.bio || "",
          config: {
            theme: {
              bg: t.bg || base.bg,
              bgMode: t.bgMode || "color",
              bgGradient: { from: t.bgGradient?.from || base.bgGradient.from, to: t.bgGradient?.to || base.bgGradient.to, angle: t.bgGradient?.angle ?? 135 },
              bgImage: t.bgImage || "",
              text: t.text || base.text,
              cursor: t.cursor || "",
              card: { mode: t.card?.mode === "color" ? "color" : "gradient", color: t.card?.color || base.card.color, from: t.card?.from || base.card.from, to: t.card?.to || base.card.to, angle: t.card?.angle ?? 135, scale: Math.min(140, Math.max(70, Number(t.card?.scale) || 100)) },
              name,
            },
            urlStyle: c.urlStyle === "at" ? "at" : "plain",
            layout: c.layout === "banner" ? "banner" : "background",
            banner: c.banner || "",
            status: c.status || "",
            avatar: c.avatar || "",
            links: Array.isArray(c.links) ? c.links.map((l) => ({ id: l.id || crypto.randomUUID(), label: l.label || "", url: l.url || "" })) : [],
            music: { url: c.music?.url || "", label: c.music?.label || "" },
            spotifyNowPlaying: !!c.spotifyNowPlaying,
          },
        };
      }
    } catch {}
    loading = false;
  }
  load();

  let preview = $derived({ username: user.username, displayName: data.displayName, bio: data.bio, config: data.config });
  let copied = $state(false);
  let saveOk = $state(true);
  const MAX_LINKS = 5;
  let linkMsg = $state("");
  const SAVE_ERR = {
    inappropriate_name: "That display name isn't allowed — it may contain blocked words or be reserved. Pick another.",
    too_large: "That's too much to save — try fewer or smaller links.",
    unauthorized: "Please log in again.",
  };
  let profilePath = $derived("/" + user.username);
  let shareHost = $derived((typeof window !== "undefined" ? window.location.host : "stygian.wtf") + profilePath);
  let shareUrl = $derived((typeof window !== "undefined" ? window.location.origin : "https://stygian.wtf") + profilePath);
  async function copyUrl() {
    try { await navigator.clipboard.writeText(shareUrl); copied = true; setTimeout(() => (copied = false), 1500); } catch {}
  }

  function addLink() {
    if (data.config.links.length >= MAX_LINKS) { linkMsg = `Limit reached — up to ${MAX_LINKS} links. Remove one to add another.`; return; }
    linkMsg = "";
    data.config.links = [...data.config.links, { id: crypto.randomUUID(), label: "", url: "" }];
  }
  function removeLink(i) { data.config.links = data.config.links.filter((_, idx) => idx !== i); linkMsg = ""; }
  function onDrop(i) {
    if (dragIndex === -1 || dragIndex === i) { dragIndex = -1; return; }
    const arr = [...data.config.links];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(i, 0, moved);
    data.config.links = arr;
    dragIndex = -1;
  }

  async function save() {
    saving = true; savedMsg = ""; saveOk = true;
    try {
      const res = await fetch("/api/me/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: data.displayName, bio: data.bio, config: data.config }),
      });
      const d = await res.json();
      if (d.ok) { savedMsg = "Saved ✓"; saveOk = true; }
      else { saveOk = false; savedMsg = SAVE_ERR[d.error] || "Couldn't save."; }
    } catch { saveOk = false; savedMsg = "Couldn't save."; }
    saving = false;
  }
  async function loadSocials() {
    try { const r = await fetch("/api/me/social"); const d = await r.json(); if (d.ok) socials = d.socials; } catch {}
  }
  loadSocials();

  function curUrl() {
    const c = data.config.theme.cursor;
    return typeof c === "string" ? c : (c && c.url) || "";
  }
  async function loadCursors() {
    const KEY = "stygian:cursorlist:v1";
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.t && Date.now() - o.t < 7 * 864e5 && Array.isArray(o.list) && o.list.length) { cursorList = o.list; return; }
      }
    } catch {}
    cursorLoading = true; cursorErr = "";
    try {
      const r = await fetch("/api/cursors");
      const d = await r.json();
      const list = (Array.isArray(d && d.cursors) ? d.cursors : []).slice(0, 150)
        .map((c) => ({ id: c.id, name: c.name, path: c.path, image: c.image || c.path, x: c.offsetX | 0, y: c.offsetY | 0 }))
        .filter((c) => c.path);
      cursorList = list;
      if (list.length) { try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), list })); } catch {} }
      else cursorErr = "Couldn't load cursors right now.";
    } catch { cursorErr = "Couldn't load cursors right now."; }
    cursorLoading = false;
  }
  loadCursors();
  function connected(pf) { return socials.find((x) => x.platform === pf); }
  function connectSocial(pf) { window.location.href = "/api/oauth/" + pf + "/start"; }
  async function disconnectSocial(pf) {
    socialBusy = pf;
    try { await fetch("/api/me/social/" + pf + "/disconnect", { method: "POST" }); await loadSocials(); } catch {}
    socialBusy = "";
  }
  function fmtn(n) {
    if (n == null || isNaN(Number(n))) return "–";
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }
</script>

<div class="editor">
  <div class="panel">
    <div class="head">
      <button class="back" onclick={onClose}>← Back</button>
      <a class="view" href={"/" + user.username} target="_blank" rel="noopener">View page ↗</a>
    </div>

    {#if loading}
      <p class="dim">Loading…</p>
    {:else}
      <div class="section">Profile link</div>
      <div class="urlrow">
        <input class="urlin" readonly value={shareHost} />
        <button class="copy" onclick={copyUrl}>{copied ? "Copied ✓" : "Copy"}</button>
      </div>
      <p class="hint">Copy this to share your page.</p>

      <label>Display name<input bind:value={data.displayName} maxlength="60" placeholder="Your name" /></label>
      <label>Bio<textarea bind:value={data.bio} maxlength="300" rows="3" placeholder="A short bio…"></textarea></label>
      <label>Status<input bind:value={data.config.status} maxlength="50" placeholder="ribbit 🐸" /></label>
      <label>Avatar image URL<input bind:value={data.config.avatar} placeholder="https://…" /></label>

      <div class="section">Display name style</div>
      <div class="seg quad">
        <button class:on={data.config.theme.name.effect === "solid"} onclick={() => (data.config.theme.name.effect = "solid")}>Solid</button>
        <button class:on={data.config.theme.name.effect === "gradient"} onclick={() => (data.config.theme.name.effect = "gradient")}>Gradient</button>
        <button class:on={data.config.theme.name.effect === "neon"} onclick={() => (data.config.theme.name.effect = "neon")}>Neon</button>
        <button class:on={data.config.theme.name.effect === "gummy"} onclick={() => (data.config.theme.name.effect = "gummy")}>Gummy</button>
      </div>
      {#if data.config.theme.name.effect === "solid" || data.config.theme.name.effect === "neon"}
        <label class="c">Name color<input type="color" bind:value={data.config.theme.name.color} /></label>
      {:else}
        <div class="colors">
          <label class="c">Name from<input type="color" bind:value={data.config.theme.name.from} /></label>
          <label class="c">Name to<input type="color" bind:value={data.config.theme.name.to} /></label>
        </div>
      {/if}

      <div class="section">Page style</div>
      <div class="seg">
        <button class:on={data.config.layout === "background"} onclick={() => (data.config.layout = "background")}>Background</button>
        <button class:on={data.config.layout === "banner"} onclick={() => (data.config.layout = "banner")}>Banner</button>
      </div>

      {#if data.config.layout === "banner"}
        <label>Banner image URL<input bind:value={data.config.banner} placeholder="https://…" /></label>
        <div class="section">Card theme</div>
        <div class="seg sm">
          <button class:on={data.config.theme.card.mode === "color"} onclick={() => (data.config.theme.card.mode = "color")}>Solid</button>
          <button class:on={data.config.theme.card.mode === "gradient"} onclick={() => (data.config.theme.card.mode = "gradient")}>Gradient</button>
        </div>
        {#if data.config.theme.card.mode === "color"}
          <label class="c">Card color<input type="color" bind:value={data.config.theme.card.color} /></label>
        {:else}
          <div class="colors">
            <label class="c">Card from<input type="color" bind:value={data.config.theme.card.from} /></label>
            <label class="c">Card to<input type="color" bind:value={data.config.theme.card.to} /></label>
          </div>
          <label>Angle: {data.config.theme.card.angle}°<input type="range" min="0" max="360" bind:value={data.config.theme.card.angle} /></label>
        {/if}
        <div class="section">Card size</div>
        <label>Size: {data.config.theme.card.scale}%<input type="range" min="70" max="140" bind:value={data.config.theme.card.scale} /></label>
      {:else}
        <div class="seg sm">
          <button class:on={data.config.theme.bgMode === "color"} onclick={() => (data.config.theme.bgMode = "color")}>Color</button>
          <button class:on={data.config.theme.bgMode === "gradient"} onclick={() => (data.config.theme.bgMode = "gradient")}>Gradient</button>
          <button class:on={data.config.theme.bgMode === "image"} onclick={() => (data.config.theme.bgMode = "image")}>Image / GIF</button>
        </div>
        {#if data.config.theme.bgMode === "color"}
          <label class="c">Background color<input type="color" bind:value={data.config.theme.bg} /></label>
        {:else if data.config.theme.bgMode === "gradient"}
          <div class="colors">
            <label class="c">From<input type="color" bind:value={data.config.theme.bgGradient.from} /></label>
            <label class="c">To<input type="color" bind:value={data.config.theme.bgGradient.to} /></label>
          </div>
          <label>Angle: {data.config.theme.bgGradient.angle}°<input type="range" min="0" max="360" bind:value={data.config.theme.bgGradient.angle} /></label>
        {:else}
          <label>Image / GIF URL<input bind:value={data.config.theme.bgImage} placeholder="https://…gif" /></label>
        {/if}
      {/if}

      <div class="section">Cursor</div>
      <p class="hint">Pick the cursor visitors see on your profile. Images load from the cursor CDN straight to each visitor's browser and cache there — nothing is stored on our side.</p>
      {#if cursorLoading}<p class="dim small">Loading cursors…</p>{/if}
      {#if cursorErr}<p class="msg err">{cursorErr}</p>{/if}
      <div class="cursorpick">
        <button type="button" class="curopt none {curUrl() ? '' : 'on'}" onclick={() => (data.config.theme.cursor = "")} title="Default cursor">Default</button>
        {#each cursorList as c (c.id)}
          <button type="button" class="curopt {curUrl() === c.path ? 'on' : ''}" onclick={() => (data.config.theme.cursor = { url: c.path, x: c.x, y: c.y })} title={c.name}>
            <img src={c.path} alt="" loading="lazy" />
          </button>
        {/each}
      </div>

      <div class="section">Links <button class="add" onclick={addLink}>+ Add</button></div>
      <p class="hint">Icons are detected automatically — type "discord", a Twitter link, etc. Up to {MAX_LINKS} links.</p>
      {#if linkMsg}<p class="msg err">{linkMsg}</p>{/if}
      <div class="links">
        {#each data.config.links as link, i (link.id)}
          <div class="link-row" draggable="true" ondragstart={() => (dragIndex = i)} ondragover={(e) => e.preventDefault()} ondrop={() => onDrop(i)}>
            <span class="grip" title="Drag to reorder">⠿</span>
            <input bind:value={link.label} placeholder="Label (optional)" />
            <div class="urlfield">
              <span class="scheme">https://</span>
              <input
                class="urlpart"
                value={(link.url || "").replace(/^https?:\/\//i, "")}
                oninput={(e) => { const r = e.currentTarget.value.replace(/^https?:\/\//i, ""); link.url = r ? "https://" + r : ""; }}
                placeholder="x.com" />
            </div>
            <button class="del" onclick={() => removeLink(i)} aria-label="Remove">✕</button>
          </div>
        {/each}
        {#if data.config.links.length === 0}<p class="dim small">No links yet — add one.</p>{/if}
      </div>

      <div class="section">Connected accounts</div>
      <p class="hint">Connecting an account verifies it’s really you — this makes impersonation less likely, and once connected you’ll get a verification badge on your profile card.</p>
      <div class="socials">
        {#each [["spotify", "Spotify"], ["tiktok", "TikTok"], ["pinterest", "Pinterest"], ["roblox", "Roblox"], ["discord", "Discord"]] as [pf, name]}
          {@const c = connected(pf)}
          <div class="social-row">
            <div class="si">
              <strong>{name}</strong>
              {#if c}
                <span class="sm">@{c.username || "connected"}{#if c.stats?.followers != null} · {fmtn(c.stats.followers)} followers{/if}{#if c.stats?.likes != null} · {fmtn(c.stats.likes)} likes{/if} · ✓ connected</span>
              {/if}
            </div>
            {#if c}
              <button class="dconn" onclick={() => disconnectSocial(pf)} disabled={socialBusy === pf}>Disconnect</button>
            {:else}
              <button class="conn" onclick={() => connectSocial(pf)}>Connect</button>
            {/if}
          </div>
        {/each}
      </div>

      <div class="section">Background music</div>
      <label>Audio file URL (.mp3 / .ogg)<input bind:value={data.config.music.url} placeholder="https://…mp3" /></label>
      <p class="hint">Plays on your page after a visitor clicks "enter" (browsers block instant autoplay).</p>
      <label>Music label<input bind:value={data.config.music.label} placeholder="Now playing…" /></label>

      {#if connected("spotify")}
        <label class="ckbox"><input type="checkbox" bind:checked={data.config.spotifyNowPlaying} /> Show my Spotify “now playing” under my profile card</label>
        <p class="hint">When on: shows your current track, or “isn’t listening right now” when nothing’s playing.</p>
      {/if}

      <button class="save" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
      {#if savedMsg}<p class="msg" class:err={!saveOk}>{savedMsg}</p>{/if}
    {/if}
  </div>

  <div class="preview">
    <div class="frame"><Profile profile={preview} preview={true} /></div>
  </div>
</div>

<style>
  .editor { display: grid; grid-template-columns: 420px 1fr; min-height: 100vh; background: #09090b; color: #e7e5e4; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .panel { padding: 1.5rem; width: 100%; margin: 0; border-right: 1px solid #1f1f23; overflow-y: auto; max-height: 100vh; display: flex; flex-direction: column; gap: 0.75rem; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
  .back { background: none; border: 1px solid #27272a; color: #e7e5e4; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; }
  .view { color: #818cf8; text-decoration: none; font-size: 0.9rem; }
  .section { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a; margin-top: 0.7rem; display: flex; justify-content: space-between; align-items: center; }
  label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #a1a1aa; }
  input, textarea { padding: 0.55rem 0.7rem; border-radius: 9px; border: 1px solid #27272a; background: #111113; color: #e7e5e4; font-size: 0.88rem; outline: none; font-family: inherit; }
  input:focus, textarea:focus { border-color: #6366f1; }
  input[type="range"] { padding: 0; }
  .colors { display: flex; gap: 0.7rem; }
  .colors .c, label.c { flex: 1; }
  input[type="color"] { padding: 0; height: 34px; width: 100%; background: none; border: 1px solid #27272a; cursor: pointer; }
  .seg { display: flex; gap: 0.4rem; }
  .seg button { flex: 1; background: #111113; border: 1px solid #27272a; color: #a1a1aa; padding: 0.5rem; border-radius: 8px; cursor: pointer; font-size: 0.82rem; }
  .seg button.on { background: #6366f1; border-color: #6366f1; color: #fff; }
  .seg.sm button { font-size: 0.78rem; padding: 0.45rem 0.3rem; }
  .seg.quad button { font-size: 0.78rem; padding: 0.45rem 0.2rem; }
  .add { background: #27272a; border: none; color: #e7e5e4; padding: 0.3rem 0.6rem; border-radius: 7px; cursor: pointer; font-size: 0.75rem; text-transform: none; letter-spacing: 0; }
  .links { display: flex; flex-direction: column; gap: 0.5rem; }
  .link-row { display: flex; gap: 0.4rem; align-items: center; background: #111113; padding: 0.4rem; border-radius: 9px; border: 1px solid #1f1f23; }
  .link-row input { flex: 1; min-width: 0; }
  .urlfield { flex: 1; min-width: 0; display: flex; align-items: center; background: #111113; border: 1px solid #27272a; border-radius: 9px; padding: 0 0.7rem; }
  .urlfield:focus-within { border-color: #6366f1; }
  .urlfield .scheme { color: #6b7280; font-size: 0.88rem; user-select: none; white-space: nowrap; flex-shrink: 0; }
  .urlfield .urlpart { flex: 1; min-width: 0; border: none; background: transparent; padding: 0.55rem 0 0.55rem 0.1rem; border-radius: 0; }
  .grip { cursor: grab; color: #52525b; padding: 0 0.2rem; user-select: none; }
  .del { background: none; border: none; color: #71717a; cursor: pointer; }
  .del:hover { color: #f87171; }
  .hint { font-size: 0.72rem; color: #71717a; margin: 0; }
  .cursorpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 0.5rem; max-height: 360px; flex-shrink: 0; overflow-y: auto; padding: 0.6rem; background: #0e0e11; border: 1px solid #1f1f23; border-radius: 10px; }
  .curopt { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: #1c1c22; border: 1px solid #27272a; border-radius: 8px; cursor: pointer; padding: 8px; overflow: hidden; }
  .curopt img { width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
  .curopt.on { border-color: #6366f1; box-shadow: 0 0 0 1px #6366f1; }
  .curopt.none { font-size: 0.6rem; color: #a1a1aa; text-transform: none; letter-spacing: 0; line-height: 1.1; }
  .save { background: #6366f1; border: none; color: #fff; padding: 0.75rem; border-radius: 10px; font-weight: 600; cursor: pointer; margin-top: 0.8rem; }
  .save:disabled { opacity: 0.6; }
  .msg { text-align: center; color: #4ade80; font-size: 0.85rem; margin: 0; }
  .msg.err { color: #f87171; }
  .dim { color: #71717a; } .small { font-size: 0.8rem; }
  .preview { background: #000; position: sticky; top: 0; height: 100vh; overflow: hidden; }
  .frame { width: 100%; height: 100%; overflow-y: auto; }
  .socials { display: flex; flex-direction: column; gap: 0.5rem; }
  .social-row { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; background: #111113; padding: 0.6rem 0.75rem; border-radius: 9px; border: 1px solid #1f1f23; }
  .si { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .si strong { color: #e7e5e4; font-size: 0.88rem; }
  .si .sm { color: #71717a; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conn { background: #6366f1; border: none; color: #fff; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; font-size: 0.78rem; font-weight: 600; flex-shrink: 0; }
  .dconn { background: transparent; border: 1px solid #3f3f46; color: #a1a1aa; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; font-size: 0.78rem; flex-shrink: 0; }
  .dconn:disabled { opacity: 0.5; }
    .urlrow { display: flex; gap: 0.4rem; }
  .urlin { flex: 1; min-width: 0; color: #a1a1aa; }
  .copy { background: #27272a; border: none; color: #e7e5e4; padding: 0 0.9rem; border-radius: 9px; cursor: pointer; font-size: 0.82rem; flex-shrink: 0; }
    .ckbox { flex-direction: row; align-items: center; gap: 0.5rem; color: #e7e5e4; }
  .ckbox input { width: auto; padding: 0; }
  @media (max-width: 820px) { .editor { grid-template-columns: 1fr; } .preview { display: none; } }
</style>
