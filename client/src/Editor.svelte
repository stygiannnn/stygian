<script>
  import Profile from "./Profile.svelte";
  let { user, onClose } = $props();

  let loading = $state(true);
  let saving = $state(false);
  let savedMsg = $state("");
  let dragIndex = $state(-1);

  let data = $state({
    displayName: "",
    bio: "",
    config: {
      theme: { bg: "#0a0a0f", accent: "#6366f1", text: "#e7e5e4", bgImage: "" },
      avatar: "",
      links: [],
      music: { url: "", label: "" },
    },
  });

  async function load() {
    try {
      const res = await fetch("/api/me/profile");
      const d = await res.json();
      if (d.ok) {
        const c = d.profile.config || {};
        data = {
          displayName: d.profile.displayName || "",
          bio: d.profile.bio || "",
          config: {
            theme: {
              bg: c.theme?.bg || "#0a0a0f",
              accent: c.theme?.accent || "#6366f1",
              text: c.theme?.text || "#e7e5e4",
              bgImage: c.theme?.bgImage || "",
            },
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

  function addLink() {
    data.config.links = [...data.config.links, { id: crypto.randomUUID(), label: "", url: "" }];
  }
  function removeLink(i) {
    data.config.links = data.config.links.filter((_, idx) => idx !== i);
  }
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
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
      <label>Display name
        <input bind:value={data.displayName} maxlength="60" placeholder="Your name" />
      </label>
      <label>Bio
        <textarea bind:value={data.bio} maxlength="300" rows="3" placeholder="A short bio…"></textarea>
      </label>
      <label>Avatar image URL
        <input bind:value={data.config.avatar} placeholder="https://…" />
      </label>

      <div class="colors">
        <label class="c">Background<input type="color" bind:value={data.config.theme.bg} /></label>
        <label class="c">Accent<input type="color" bind:value={data.config.theme.accent} /></label>
        <label class="c">Text<input type="color" bind:value={data.config.theme.text} /></label>
      </div>
      <label>Background image URL (optional)
        <input bind:value={data.config.theme.bgImage} placeholder="https://…" />
      </label>

      <div class="links-head">
        <span>Links</span>
        <button class="add" onclick={addLink}>+ Add</button>
      </div>
      <div class="links">
        {#each data.config.links as link, i (link.id)}
          <div class="link-row" draggable="true"
               ondragstart={() => (dragIndex = i)}
               ondragover={(e) => e.preventDefault()}
               ondrop={() => onDrop(i)}>
            <span class="grip" title="Drag to reorder">⠿</span>
            <input bind:value={link.label} placeholder="Label" />
            <input bind:value={link.url} placeholder="https://…" />
            <button class="del" onclick={() => removeLink(i)} aria-label="Remove">✕</button>
          </div>
        {/each}
        {#if data.config.links.length === 0}<p class="dim small">No links yet — add one.</p>{/if}
      </div>

      <label>Music link
        <input bind:value={data.config.music.url} placeholder="Spotify / SoundCloud / YouTube URL" />
      </label>
      <label>Music label
        <input bind:value={data.config.music.label} placeholder="Now playing…" />
      </label>

      <button class="save" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
      {#if savedMsg}<p class="msg">{savedMsg}</p>{/if}
    {/if}
  </div>

  <div class="preview">
    <div class="frame"><Profile profile={preview} /></div>
  </div>
</div>

<style>
  .editor { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; background: #09090b; color: #e7e5e4; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .panel { padding: 1.5rem; max-width: 520px; width: 100%; margin: 0 auto; overflow-y: auto; max-height: 100vh; display: flex; flex-direction: column; gap: 0.9rem; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .back { background: none; border: 1px solid #27272a; color: #e7e5e4; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; }
  .view { color: #818cf8; text-decoration: none; font-size: 0.9rem; }
  label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8rem; color: #a1a1aa; }
  input, textarea { padding: 0.6rem 0.75rem; border-radius: 9px; border: 1px solid #27272a; background: #111113; color: #e7e5e4; font-size: 0.9rem; outline: none; font-family: inherit; }
  input:focus, textarea:focus { border-color: #6366f1; }
  .colors { display: flex; gap: 0.75rem; }
  .colors .c { flex: 1; align-items: flex-start; }
  input[type="color"] { padding: 0; height: 36px; width: 100%; background: none; border: 1px solid #27272a; cursor: pointer; }
  .links-head { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #a1a1aa; margin-top: 0.4rem; }
  .add { background: #27272a; border: none; color: #e7e5e4; padding: 0.35rem 0.7rem; border-radius: 8px; cursor: pointer; font-size: 0.8rem; }
  .links { display: flex; flex-direction: column; gap: 0.5rem; }
  .link-row { display: flex; gap: 0.4rem; align-items: center; background: #111113; padding: 0.4rem; border-radius: 9px; border: 1px solid #1f1f23; }
  .link-row input { flex: 1; min-width: 0; }
  .grip { cursor: grab; color: #52525b; padding: 0 0.2rem; user-select: none; }
  .del { background: none; border: none; color: #71717a; cursor: pointer; font-size: 0.9rem; }
  .del:hover { color: #f87171; }
  .save { background: #6366f1; border: none; color: #fff; padding: 0.75rem; border-radius: 10px; font-weight: 600; cursor: pointer; margin-top: 0.6rem; }
  .save:disabled { opacity: 0.6; }
  .msg { text-align: center; color: #4ade80; font-size: 0.85rem; margin: 0; }
  .dim { color: #71717a; }
  .small { font-size: 0.8rem; }
  .preview { background: #000; display: grid; place-items: center; position: sticky; top: 0; height: 100vh; overflow: hidden; }
  .frame { width: 100%; height: 100%; overflow-y: auto; }
  @media (max-width: 820px) {
    .editor { grid-template-columns: 1fr; }
    .preview { display: none; }
  }
</style>
