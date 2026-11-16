<script>
  import Profile from "./Profile.svelte";
  let { user, onClose } = $props();

  let loading = $state(true);
  let saving = $state(false);
  let savedMsg = $state("");
  let dragIndex = $state(-1);

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
          accent: "#6366f1",
          text: "#e7e5e4",
          nameGradient: { enabled: false, from: "#6366f1", to: "#ec4899" },
          cursor: "",
        },
        layout: "background",
        banner: "",
        avatar: "",
        links: [],
        music: { url: "", label: "" },
      },
    };
  }

  async function load() {
    try {
      const res = await fetch("/api/me/profile");
      const d = await res.json();
      if (d.ok) {
        const base = defaults();
        const c = d.profile.config || {};
        const t = c.theme || {};
        data = {
          displayName: d.profile.displayName || "",
          bio: d.profile.bio || "",
          config: {
            theme: {
              bg: t.bg || base.config.theme.bg,
              bgMode: t.bgMode || "color",
              bgGradient: { from: t.bgGradient?.from || base.config.theme.bgGradient.from, to: t.bgGradient?.to || base.config.theme.bgGradient.to, angle: t.bgGradient?.angle ?? 135 },
              bgImage: t.bgImage || "",
              accent: t.accent || base.config.theme.accent,
              text: t.text || base.config.theme.text,
              nameGradient: { enabled: !!t.nameGradient?.enabled, from: t.nameGradient?.from || base.config.theme.nameGradient.from, to: t.nameGradient?.to || base.config.theme.nameGradient.to },
              cursor: t.cursor || "",
            },
            layout: c.layout === "banner" ? "banner" : "background",
            banner: c.banner || "",
            avatar: c.avatar || "",
            links: Array.isArray(c.links) ? c.links.map((l) => ({ id: l.id || crypto.randomUUID(), label: l.label || "", url: l.url || "" })) : [],
            music: { url: c.music?.url || "", label: c.music?.label || "" },
          },
        };
      }
    } catch {}
    loading = false;
  }
  load();

  let preview = $derived({ username: user.username, displayName: data.displayName, bio: data.bio, config: data.config });

  function addLink() { data.config.links = [...data.config.links, { id: crypto.randomUUID(), label: "", url: "" }]; }
  function removeLink(i) { data.config.links = data.config.links.filter((_, idx) => idx !== i); }
  function onDrop(i) {
    if (dragIndex === -1 || dragIndex === i) { dragIndex = -1; return; }
    const arr = [...data.config.links];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(i, 0, moved);
    data.config.links = arr;
    dragIndex = -1;
  }

  async function save() {
    saving = true; savedMsg = "";
    try {
      const res = await fetch("/api/me/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: data.displayName, bio: data.bio, config: data.config }),
      });
      const d = await res.json();
      savedMsg = d.ok ? "Saved ✓" : "Couldn't save";
    } catch { savedMsg = "Couldn't save"; }
    saving = false;
  }

</script>

<div class="editor">
  <div class="panel">
    <div class="head">
      <button class="back" onclick={onClose}>← Back</button>
      <a class="view" href={"/@" + user.username} target="_blank" rel="noopener">View page ↗</a>
    </div>

    {#if loading}
      <p class="dim">Loading…</p>
    {:else}
      <label>Display name<input bind:value={data.displayName} maxlength="60" placeholder="Your name" /></label>
      <label>Bio<textarea bind:value={data.bio} maxlength="300" rows="3" placeholder="A short bio…"></textarea></label>
      <label>Avatar image URL<input bind:value={data.config.avatar} placeholder="https://…" /></label>

      <div class="section">Page style</div>
      <div class="seg">
        <button class:on={data.config.layout === "background"} onclick={() => (data.config.layout = "background")}>Background</button>
        <button class:on={data.config.layout === "banner"} onclick={() => (data.config.layout = "banner")}>Banner</button>
      </div>

      {#if data.config.layout === "banner"}
        <label>Banner image URL<input bind:value={data.config.banner} placeholder="https://…" /></label>
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

      <div class="section">Colors</div>
      <div class="colors">
        <label class="c">Accent<input type="color" bind:value={data.config.theme.accent} /></label>
        <label class="c">Text<input type="color" bind:value={data.config.theme.text} /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={data.config.theme.nameGradient.enabled} /> Gradient title</label>
      {#if data.config.theme.nameGradient.enabled}
        <div class="colors">
          <label class="c">Title from<input type="color" bind:value={data.config.theme.nameGradient.from} /></label>
          <label class="c">Title to<input type="color" bind:value={data.config.theme.nameGradient.to} /></label>
        </div>
      {/if}

      <label>Custom cursor image URL (PNG, ≤128px)<input bind:value={data.config.theme.cursor} placeholder="https://…png" /></label>

      <div class="section">Links <button class="add" onclick={addLink}>+ Add</button></div>
      <div class="links">
        {#each data.config.links as link, i (link.id)}
          <div class="link-row" draggable="true" ondragstart={() => (dragIndex = i)} ondragover={(e) => e.preventDefault()} ondrop={() => onDrop(i)}>
            <span class="grip" title="Drag to reorder">⠿</span>
            <input bind:value={link.label} placeholder="Label" />
            <input bind:value={link.url} placeholder="https://…" />
            <button class="del" onclick={() => removeLink(i)} aria-label="Remove">✕</button>
          </div>
        {/each}
        {#if data.config.links.length === 0}<p class="dim small">No links yet — add one.</p>{/if}
      </div>

      <div class="section">Background music</div>
      <label>Audio file URL (.mp3 / .ogg)<input bind:value={data.config.music.url} placeholder="https://…mp3" /></label>
      <p class="hint">Plays on your page after a visitor clicks "enter" (browsers block instant autoplay).</p>
      <label>Music label<input bind:value={data.config.music.label} placeholder="Now playing…" /></label>

      <button class="save" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
      {#if savedMsg}<p class="msg">{savedMsg}</p>{/if}
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
  label.check { flex-direction: row; align-items: center; gap: 0.5rem; }
  input, textarea { padding: 0.55rem 0.7rem; border-radius: 9px; border: 1px solid #27272a; background: #111113; color: #e7e5e4; font-size: 0.88rem; outline: none; font-family: inherit; }
  input:focus, textarea:focus { border-color: #6366f1; }
  input[type="range"] { padding: 0; }
  input[type="checkbox"] { width: auto; }
  .colors { display: flex; gap: 0.7rem; }
  .colors .c, label.c { flex: 1; }
  input[type="color"] { padding: 0; height: 34px; width: 100%; background: none; border: 1px solid #27272a; cursor: pointer; }
  .seg { display: flex; gap: 0.4rem; }
  .seg button { flex: 1; background: #111113; border: 1px solid #27272a; color: #a1a1aa; padding: 0.5rem; border-radius: 8px; cursor: pointer; font-size: 0.82rem; }
  .seg button.on { background: #6366f1; border-color: #6366f1; color: #fff; }
  .seg.sm button { font-size: 0.78rem; padding: 0.45rem 0.3rem; }
  .add { background: #27272a; border: none; color: #e7e5e4; padding: 0.3rem 0.6rem; border-radius: 7px; cursor: pointer; font-size: 0.75rem; text-transform: none; letter-spacing: 0; }
  .links { display: flex; flex-direction: column; gap: 0.5rem; }
  .link-row { display: flex; gap: 0.4rem; align-items: center; background: #111113; padding: 0.4rem; border-radius: 9px; border: 1px solid #1f1f23; }
  .link-row input { flex: 1; min-width: 0; }
  .grip { cursor: grab; color: #52525b; padding: 0 0.2rem; user-select: none; }
  .del { background: none; border: none; color: #71717a; cursor: pointer; }
  .del:hover { color: #f87171; }
  .hint { font-size: 0.72rem; color: #71717a; margin: 0; }
  .save { background: #6366f1; border: none; color: #fff; padding: 0.75rem; border-radius: 10px; font-weight: 600; cursor: pointer; margin-top: 0.8rem; }
  .save:disabled { opacity: 0.6; }
  .msg { text-align: center; color: #4ade80; font-size: 0.85rem; margin: 0; }
  .dim { color: #71717a; } .small { font-size: 0.8rem; }
  .preview { background: #000; position: sticky; top: 0; height: 100vh; overflow: hidden; }
  .frame { width: 100%; height: 100%; overflow-y: auto; }
  @media (max-width: 820px) { .editor { grid-template-columns: 1fr; } .preview { display: none; } }
</style>
