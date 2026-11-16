<script>
  let { profile } = $props();

  function safeUrl(u) {
    if (!u) return "";
    try {
      const x = new URL(u);
      return (x.protocol === "http:" || x.protocol === "https:") ? u : "";
    } catch { return ""; }
  }

  function pageStyle(p) {
    const t = p?.config?.theme || {};
    const bg = t.bg || "#0a0a0f";
    let s = `background-color:${bg};--accent:${t.accent || "#6366f1"};--text:${t.text || "#e7e5e4"};`;
    const img = safeUrl(t.bgImage);
    if (img) s += `background-image:linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5)),url('${img}');background-size:cover;background-position:center;background-attachment:fixed;`;
    return s;
  }
</script>

{#if profile}
  <div class="page" style={pageStyle(profile)}>
    <div class="inner">
      {#if safeUrl(profile.config?.avatar)}
        <img class="avatar" src={safeUrl(profile.config.avatar)} alt="" />
      {/if}
      <h1 class="name">{profile.displayName || "@" + profile.username}</h1>
      <p class="handle">@{profile.username}</p>
      {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}

      <div class="links">
        {#each (profile.config?.links || []) as link}
          {#if safeUrl(link.url)}
            <a class="link" href={safeUrl(link.url)} target="_blank" rel="noopener noreferrer nofollow">
              {link.label || link.url}
            </a>
          {/if}
        {/each}
      </div>

      {#if safeUrl(profile.config?.music?.url)}
        <a class="music" href={safeUrl(profile.config.music.url)} target="_blank" rel="noopener noreferrer">
          🎵 {profile.config.music.label || "Listen"}
        </a>
      {/if}
    </div>
  </div>
{/if}

<style>
  .page { min-height: 100vh; display: grid; place-items: center; color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 2.5rem 1rem; }
  .inner { width: min(440px, 92vw); text-align: center; }
  .avatar { width: 104px; height: 104px; border-radius: 50%; object-fit: cover; border: 3px solid var(--accent); }
  .name { font-size: 1.8rem; margin: 1rem 0 0.1rem; font-weight: 700; }
  .handle { color: var(--accent); margin: 0 0 0.9rem; font-size: 0.95rem; }
  .bio { opacity: 0.85; margin: 0 0 1.6rem; line-height: 1.5; }
  .links { display: flex; flex-direction: column; gap: 0.7rem; }
  .link { display: block; padding: 0.85rem 1rem; border-radius: 12px; background: rgba(255,255,255,0.06); color: var(--text); text-decoration: none; font-weight: 600; border: 1px solid var(--accent); transition: transform 0.1s ease, background 0.15s ease, color 0.15s ease; }
  .link:hover { transform: translateY(-2px); background: var(--accent); color: #fff; }
  .music { display: inline-block; margin-top: 1.6rem; color: var(--accent); text-decoration: none; font-size: 0.9rem; }
</style>
