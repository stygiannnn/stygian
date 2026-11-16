<script>
  let { profile, preview = false } = $props();

  let entered = $state(false);
  let audioEl = $state(null);

  function safeUrl(u) {
    if (!u) return "";
    try { const x = new URL(u); return (x.protocol === "http:" || x.protocol === "https:") ? u : ""; } catch { return ""; }
  }

  let cfg = $derived(profile?.config ?? {});
  let theme = $derived(cfg.theme ?? {});
  let layout = $derived(cfg.layout === "banner" ? "banner" : "background");
  let musicUrl = $derived(safeUrl(cfg.music?.url));
  let hasAudio = $derived(!!musicUrl && !preview);

  function pageStyle() {
    const t = theme;
    let s = `--accent:${t.accent || "#6366f1"};--text:${t.text || "#e7e5e4"};`;
    if (layout === "banner") {
      s += `background-color:${t.bg || "#0a0a0f"};`;
    } else {
      const mode = t.bgMode || "color";
      if (mode === "gradient") {
        const g = t.bgGradient || {};
        s += `background:linear-gradient(${g.angle ?? 135}deg, ${g.from || "#1b1b2e"}, ${g.to || "#0a0a0f"});background-attachment:fixed;`;
      } else if (mode === "image" && safeUrl(t.bgImage)) {
        s += `background-color:${t.bg || "#0a0a0f"};background-image:linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)),url('${safeUrl(t.bgImage)}');background-size:cover;background-position:center;background-attachment:fixed;`;
      } else {
        s += `background-color:${t.bg || "#0a0a0f"};`;
      }
    }
    const cur = safeUrl(t.cursor);
    if (cur) s += `cursor:url('${cur}'),auto;`;
    return s;
  }

  function nameStyle() {
    const ng = theme.nameGradient;
    if (ng?.enabled) {
      return `background:linear-gradient(90deg, ${ng.from || "#6366f1"}, ${ng.to || "#ec4899"});-webkit-background-clip:text;background-clip:text;color:transparent;`;
    }
    return "";
  }

  function enter() {
    entered = true;
    if (audioEl) audioEl.play().catch(() => {});
  }
</script>

{#if profile}
  <div class="page" style={pageStyle()}>
    {#if hasAudio}
      <audio bind:this={audioEl} src={musicUrl} loop></audio>
      {#if !entered}
        <button class="enter" onclick={enter}>click to enter</button>
      {/if}
    {/if}

    {#if layout === "banner"}
      <div class="banner" style={safeUrl(cfg.banner) ? `background-image:url('${safeUrl(cfg.banner)}')` : "background:#15151b"}></div>
    {/if}

    <div class="inner" class:withbanner={layout === "banner"}>
      {#if safeUrl(cfg.avatar)}
        <img class="avatar" src={safeUrl(cfg.avatar)} alt="" />
      {/if}
      <h1 class="name" style={nameStyle()}>{profile.displayName || "@" + profile.username}</h1>
      <p class="handle">@{profile.username}</p>
      {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}

      <div class="links">
        {#each (cfg.links || []) as link}
          {#if safeUrl(link.url)}
            <a class="link" href={safeUrl(link.url)} target="_blank" rel="noopener noreferrer nofollow">{link.label || link.url}</a>
          {/if}
        {/each}
      </div>

      {#if musicUrl || cfg.music?.label}
        <p class="np">🎵 {cfg.music?.label || "Now playing"}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .page { position: relative; min-height: 100vh; display: grid; place-items: center; color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 2.5rem 1rem; }
  .enter { position: fixed; inset: 0; z-index: 10; border: none; background: rgba(0,0,0,0.75); color: #fff; font-size: 1.1rem; letter-spacing: 0.15em; text-transform: uppercase; cursor: pointer; backdrop-filter: blur(6px); }
  .banner { position: absolute; top: 0; left: 0; right: 0; height: 180px; background-size: cover; background-position: center; }
  .inner { width: min(440px, 92vw); text-align: center; position: relative; z-index: 1; }
  .inner.withbanner { margin-top: 120px; }
  .avatar { width: 108px; height: 108px; border-radius: 50%; object-fit: cover; border: 3px solid var(--accent); }
  .name { font-size: 1.9rem; margin: 1rem 0 0.1rem; font-weight: 700; display: inline-block; }
  .handle { color: var(--accent); margin: 0 0 0.9rem; font-size: 0.95rem; }
  .bio { opacity: 0.85; margin: 0 0 1.6rem; line-height: 1.5; }
  .links { display: flex; flex-direction: column; gap: 0.7rem; }
  .link { display: block; padding: 0.85rem 1rem; border-radius: 12px; background: rgba(255,255,255,0.07); color: var(--text); text-decoration: none; font-weight: 600; border: 1px solid var(--accent); transition: transform 0.1s ease, background 0.15s ease, color 0.15s ease; }
  .link:hover { transform: translateY(-2px); background: var(--accent); color: #fff; }
  .np { display: inline-block; margin-top: 1.6rem; color: var(--accent); font-size: 0.9rem; }
</style>
