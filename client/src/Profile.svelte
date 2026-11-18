<script>
  import { detectPlatform, iconSvg, platformName } from "./icons.js";

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
  let status = $derived((cfg.status || "").slice(0, 50));
  let musicUrl = $derived(safeUrl(cfg.music?.url));
  let hasAudio = $derived(!!musicUrl && !preview);
  let socials = $derived(profile?.socials ?? {});

  function statFor(key) {
    const map = { x: "twitter", tiktok: "tiktok", pinterest: "pinterest" };
    const pk = map[key];
    return pk ? (socials[pk] || null) : null;
  }
  function fmt(n) {
    if (n == null || isNaN(Number(n))) return "";
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }
  function badgeSvg() {
    return '<svg class="verified" viewBox="0 0 22 22" width="15" height="15" aria-label="verified"><path fill="currentColor" d="M11 1.6l2 1.5 2.5-.2.9 2.3 2.2 1.2-.6 2.5 1.2 2.2-1.6 1.9.1 2.5-2.4.7L14 20.5l-2.3-.6-2 .6-2.3-1.2L4.9 18l-2.4-.7.1-2.5-1.6-1.9 1.2-2.2L1.6 8l2.2-1.2.9-2.3 2.5.2z"/><path fill="#fff" d="M9.7 13.1L7.5 10.9l1-1 1.2 1.2 3-3 1 1z"/></svg>';
  }

  function pageStyle() {
    const t = theme;
    let s = `--text:${t.text || "#e7e5e4"};`;
    if (layout === "banner") {
      s += `background:transparent;`;
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

  // Display name effect: solid | gradient | neon | gummy (with legacy nameGradient fallback)
  function nameStyle() {
    const base = { effect: "gradient", color: "#ffffff", from: "#8b5cf6", to: "#ec4899" };
    let n = theme.name;
    if (!n || !n.effect) {
      if (theme.nameGradient?.enabled) n = { effect: "gradient", color: "#ffffff", from: theme.nameGradient.from || base.from, to: theme.nameGradient.to || base.to };
      else n = base;
    }
    const c = n.color || "#ffffff", from = n.from || base.from, to = n.to || base.to;
    if (n.effect === "gradient") return `background:linear-gradient(90deg,${from},${to});-webkit-background-clip:text;background-clip:text;color:transparent;`;
    if (n.effect === "neon") return `color:${c};text-shadow:0 0 4px ${c},0 0 11px ${c},0 0 22px ${c}99,0 0 40px ${c}55;`;
    if (n.effect === "gummy") return `background:linear-gradient(180deg,${from},${to});-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 1px rgba(0,0,0,0.55));-webkit-text-stroke:0.5px rgba(0,0,0,0.3);`;
    return `color:${c};`;
  }

  // Banner-mode glass card: translucent colour tint over a blurred banner backdrop
  function withAlpha(c, a) { return (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) ? c + a : c; }
  function tintStyle() {
    const c = theme.card || {};
    const A = "80"; // ~50% — glassy
    if (c.mode === "color") return `background:${withAlpha(c.color || "#111117", A)};`;
    return `background:linear-gradient(${c.angle ?? 135}deg,${withAlpha(c.from || "#1b1b2e", A)},${withAlpha(c.to || "#111117", A)});`;
  }
  function cardBgStyle() {
    const b = safeUrl(cfg.banner);
    return b ? `background-image:url('${b}');` : "display:none;";
  }
  function cardSizeStyle() {
    const sc = Math.min(140, Math.max(70, Number(theme.card?.scale) || 100)) / 100;
    return `zoom:${sc};`;
  }

  function enter() { entered = true; if (audioEl) audioEl.play().catch(() => {}); }
</script>

{#if profile}
  <div class="page" class:banner={layout === "banner"} style={pageStyle()}>
    {#if hasAudio}
      <audio bind:this={audioEl} src={musicUrl} loop></audio>
      {#if !entered}<button class="enter" onclick={enter}>click to enter</button>{/if}
    {/if}

    {#if layout === "banner"}
      <div class="card" style={cardSizeStyle()}>
        <div class="cardbg" style={cardBgStyle()}></div>
        <div class="cardtint" style={tintStyle()}></div>
        <div class="bannerimg" style={safeUrl(cfg.banner) ? `background-image:url('${safeUrl(cfg.banner)}')` : "background:rgba(255,255,255,0.03)"}></div>
        <div class="avwrap">
          {#if safeUrl(cfg.avatar)}<img class="avatar" src={safeUrl(cfg.avatar)} alt="" />{/if}
          {#if status}<span class="status">{status}</span>{/if}
        </div>
        <div class="body">
          <h1 class="name" style={nameStyle()}>{profile.displayName || "@" + profile.username}</h1>
          <p class="handle">@{profile.username}</p>
          {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}
          <div class="links">
            {#each (cfg.links || []) as link}
              {#if safeUrl(link.url)}
                {@const key = detectPlatform(link)}
                {@const s = statFor(key)}
                <a class="link" href={safeUrl(link.url)} target="_blank" rel="noopener noreferrer nofollow">
                  <span class="ico">{@html iconSvg(key)}</span>
                  <span class="meta">
                    <span class="lbl">{link.label || platformName(key)}{#if s?.verified}{@html badgeSvg()}{/if}</span>
                    {#if s && (s.followers != null || s.likes != null)}
                      <span class="stat">{#if s.followers != null}{fmt(s.followers)} followers{/if}{#if s.likes != null}{s.followers != null ? " · " : ""}{fmt(s.likes)} likes{/if}</span>
                    {/if}
                  </span>
                </a>
              {/if}
            {/each}
          </div>
          {#if musicUrl || cfg.music?.label}<p class="np">🎵 {cfg.music?.label || "Now playing"}</p>{/if}
        </div>
      </div>
    {:else}
      <div class="inner">
        {#if safeUrl(cfg.avatar)}<img class="avatar" src={safeUrl(cfg.avatar)} alt="" />{/if}
        <h1 class="name" style={nameStyle()}>{profile.displayName || "@" + profile.username}</h1>
        <p class="handle">@{profile.username}</p>
        {#if status}<span class="status center">{status}</span>{/if}
        {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}
        <div class="links">
          {#each (cfg.links || []) as link}
            {#if safeUrl(link.url)}
              {@const key = detectPlatform(link)}
              {@const s = statFor(key)}
              <a class="link" href={safeUrl(link.url)} target="_blank" rel="noopener noreferrer nofollow">
                <span class="ico">{@html iconSvg(key)}</span>
                <span class="meta">
                  <span class="lbl">{link.label || platformName(key)}{#if s?.verified}{@html badgeSvg()}{/if}</span>
                  {#if s && (s.followers != null || s.likes != null)}
                    <span class="stat">{#if s.followers != null}{fmt(s.followers)} followers{/if}{#if s.likes != null}{s.followers != null ? " · " : ""}{fmt(s.likes)} likes{/if}</span>
                  {/if}
                </span>
              </a>
            {/if}
          {/each}
        </div>
        {#if musicUrl || cfg.music?.label}<p class="np">🎵 {cfg.music?.label || "Now playing"}</p>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .page { position: relative; min-height: 100vh; display: grid; place-items: center; color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 2.5rem 1rem; }
  .enter { position: fixed; inset: 0; z-index: 10; border: none; background: rgba(0,0,0,0.75); color: #fff; font-size: 1.1rem; letter-spacing: 0.15em; text-transform: uppercase; cursor: pointer; backdrop-filter: blur(6px); }

  /* banner card (Discord-style) */
  .card { position: relative; width: min(440px, 94vw); background: rgba(12,12,16,0.3); backdrop-filter: blur(20px) saturate(1.3); -webkit-backdrop-filter: blur(20px) saturate(1.3); border: none; border-radius: 20px; overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,0.5); }
  .cardbg { position: absolute; inset: 0; background-size: cover; background-position: center; filter: blur(26px) brightness(0.5); transform: scale(1.3); z-index: 0; }
  .cardtint { position: absolute; inset: 0; z-index: 1; }
  .bannerimg { position: relative; z-index: 2; height: 150px; background-size: cover; background-position: center; }
  .avwrap { position: relative; z-index: 2; display: flex; align-items: flex-end; gap: 0.5rem; padding: 0 1.1rem; margin-top: -46px; }
  .card .avatar { width: 90px; height: 90px; border-radius: 50%; object-fit: cover; border: 5px solid rgba(17,17,23,0.95); background: #15151b; flex-shrink: 0; }
  .status { position: relative; display: inline-block; width: fit-content; max-width: 60%; background: rgba(23,23,29,0.97); color: #dcddde; padding: 0.42rem 0.85rem; border-radius: 16px; font-size: 0.82rem; line-height: 1.3; margin-bottom: 0.6rem; border: 1px solid rgba(255,255,255,0.08); word-break: break-word; }
  .status::before, .status::after { content: ""; position: absolute; background: rgba(23,23,29,0.97); border-radius: 50%; }
  .status::before { width: 9px; height: 9px; left: 4px; top: -11px; }
  .status::after { width: 6px; height: 6px; left: -8px; top: -21px; }
  .body { position: relative; z-index: 2; padding: 0.7rem 1.25rem 1.5rem; }
  .body .name { font-size: 1.55rem; margin: 0.3rem 0 0.1rem; font-weight: 700; display: inline-block; }
  .body .handle { color: #9aa0ab; margin: 0 0 0.8rem; font-size: 0.9rem; }
  .body .bio { opacity: 0.85; margin: 0 0 1.2rem; line-height: 1.5; font-size: 0.92rem; }
  .body .links { display: flex; flex-direction: column; gap: 0.6rem; }
  .body .np { color: #9aa0ab; font-size: 0.88rem; margin: 1.2rem 0 0; }

  /* full-page background layout */
  .inner { width: min(440px, 92vw); text-align: center; position: relative; z-index: 1; }
  .inner .avatar { display: block; margin: 0 auto; width: 108px; height: 108px; border-radius: 50%; object-fit: cover; border: 3px solid rgba(255,255,255,0.18); }
  .inner .name { font-size: 1.9rem; margin: 1rem 0 0.1rem; font-weight: 700; display: inline-block; }
  .inner .handle { color: #9aa0ab; margin: 0 0 0.6rem; font-size: 0.95rem; }
  .inner .bio { opacity: 0.85; margin: 0 0 1.6rem; line-height: 1.5; }
  .inner .links { display: flex; flex-direction: column; gap: 0.7rem; }
  .inner .np { display: inline-block; margin-top: 1.6rem; color: #9aa0ab; font-size: 0.9rem; }
  .status.center { margin: 0.2rem 0 1rem; }
  .status.center::before, .status.center::after { display: none; }

  /* social buttons — neutral, platform icon auto-detected (no accent theming) */
  .link { display: flex; align-items: center; gap: 0.7rem; padding: 0.8rem 1rem; border-radius: 12px; background: rgba(255,255,255,0.06); color: var(--text); text-decoration: none; font-weight: 600; border: 1px solid rgba(255,255,255,0.1); transition: transform 0.1s ease, background 0.15s ease, border-color 0.15s ease; }
  .link:hover { transform: translateY(-2px); background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.22); }
  .link .ico { display: inline-flex; align-items: center; flex-shrink: 0; opacity: 0.95; }
  .link .meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  .link .lbl { display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link .stat { font-size: 0.72rem; opacity: 0.6; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .link :global(.verified) { width: 15px; height: 15px; flex-shrink: 0; color: #1d9bf0; }
</style>
