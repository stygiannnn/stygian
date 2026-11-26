<script>
  import Profile from "./Profile.svelte";
  import Editor from "./Editor.svelte";
  import Uploads from "./Uploads.svelte";
  import Admin from "./Admin.svelte";

  let view = $state("loading"); // loading | public | notfound | landing | signup | verify | login | dashboard | editor
  let user = $state(null);
  let publicProfile = $state(null);
  let error = $state("");
  let busy = $state(false);

  let email = $state("");
  let username = $state("");
  let displayName = $state("");
  let password = $state("");
  let identifier = $state("");
  let code = $state("");
  let pendingEmail = $state("");

  const TURNSTILE_SITE_KEY = ""; // paste your Cloudflare Turnstile site key here to enable the signup captcha
  let turnstileToken = $state("");
  let turnstileEl = $state(null);
  let turnstileWidget = null;
  function renderTurnstile() {
    if (!TURNSTILE_SITE_KEY || !turnstileEl || turnstileWidget !== null) return;
    if (!window.turnstile) { setTimeout(renderTurnstile, 200); return; }
    turnstileWidget = window.turnstile.render(turnstileEl, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (t) => (turnstileToken = t),
      "expired-callback": () => (turnstileToken = ""),
      "error-callback": () => (turnstileToken = ""),
    });
  }
  function resetTurnstile() {
    turnstileToken = "";
    if (TURNSTILE_SITE_KEY && window.turnstile && turnstileWidget !== null) { try { window.turnstile.reset(turnstileWidget); } catch {} }
  }
  $effect(() => {
    if (view === "signup") { if (turnstileEl) renderTurnstile(); }
    else { turnstileWidget = null; turnstileToken = ""; }
  });

  const routeMatch = decodeURIComponent(window.location.pathname).match(/^\/@?([a-zA-Z0-9_-]{3,20})$/);

  const ERRORS = {
    invalid_email: "That email doesn't look right.",
    disposable_email: "Temporary / disposable emails aren't allowed.",
    invalid_username: "Username must be 3–20 letters, numbers, _ or -.",
    inappropriate_username: "That username isn\u2019t allowed \u2014 it may contain blocked words or be reserved. Pick another.",
    inappropriate_name: "That display name isn\u2019t allowed \u2014 it may contain blocked words or be reserved. Pick another.",
    weak_password: "Password must be at least 8 characters.",
    email_taken: "That email is already registered.",
    username_taken: "That username is taken.",
    invalid_credentials: "Wrong email/username or password.",
    not_verified: "Please verify your email first — we sent a new code.",
    wrong_code: "That code is incorrect.",
    code_expired: "That code expired. Request a new one.",
    too_many_attempts: "Too many attempts. Request a new code.",
    invalid_input: "Please check your details and try again.",
    captcha_failed: "Captcha check failed. Please try again.",
    server_error: "Something went wrong. Try again.",
  };
  const msg = (e) => ERRORS[e] || "Something went wrong.";

  async function api(path, data) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async function init() {
    if (routeMatch) {
      try {
        const res = await fetch("/api/profile/" + routeMatch[1]);
        const d = await res.json();
        if (d.ok) { publicProfile = d.profile; view = "public"; }
        else view = "notfound";
      } catch { view = "notfound"; }
      return;
    }
    try {
      const res = await fetch("/api/auth/me");
      const d = await res.json();
      if (d.user) { user = d.user; view = "dashboard"; }
      else view = "landing";
    } catch { view = "landing"; }
  }
  init();

  function go(v) { error = ""; view = v; }

  async function doSignup(e) {
    e.preventDefault(); error = "";
    if (TURNSTILE_SITE_KEY && !turnstileToken) { error = "Please complete the captcha."; return; }
    busy = true;
    const r = await api("/api/auth/signup", { email, username, displayName, password, turnstileToken });
    busy = false;
    if (r.ok) { pendingEmail = r.email; code = ""; view = "verify"; resetTurnstile(); }
    else { error = msg(r.error); resetTurnstile(); }
  }
  async function doVerify(e) {
    e.preventDefault(); error = ""; busy = true;
    const r = await api("/api/auth/verify", { email: pendingEmail, code });
    busy = false;
    if (r.ok) { user = r.user; view = "dashboard"; }
    else error = msg(r.error);
  }
  async function doResend() {
    await api("/api/auth/resend", { email: pendingEmail });
    error = "A new code is on its way.";
  }
  async function doLogin(e) {
    e.preventDefault(); error = ""; busy = true;
    const r = await api("/api/auth/login", { identifier, password });
    busy = false;
    if (r.ok) { user = r.user; view = "dashboard"; }
    else if (r.error === "not_verified") { pendingEmail = r.email; code = ""; error = msg(r.error); view = "verify"; }
    else error = msg(r.error);
  }
  async function doLogout() {
    await api("/api/auth/logout", {});
    user = null; email = username = displayName = password = identifier = code = ""; view = "landing";
  }
</script>

{#if view === "public"}
  <Profile profile={publicProfile} />

{:else if view === "editor"}
  <Editor {user} onClose={() => (view = "dashboard")} />

{:else if view === "uploads"}
  <Uploads onClose={() => (view = "dashboard")} />

{:else if view === "admin"}
  <Admin onClose={() => (view = "dashboard")} />

{:else if view === "notfound"}
  <main><div class="card"><h1>stygian</h1><p class="tag">no one here by that name.</p><a class="link" href="/">← home</a></div></main>

{:else}
  <main>
    <div class="card">
      <h1>stygian</h1>

      {#if view === "loading"}
        <p class="tag">loading…</p>

      {:else if view === "landing"}
        <p class="tag">profiles, your way</p>
        <div class="row">
          <button onclick={() => go("signup")}>Create account</button>
          <button class="ghost" onclick={() => go("login")}>Log in</button>
        </div>

      {:else if view === "signup"}
        <p class="tag">create your account</p>
        <form onsubmit={doSignup}>
          <input type="email" placeholder="email" bind:value={email} autocomplete="email" />
          <input type="text" placeholder="username (permanent)" bind:value={username} autocomplete="username" maxlength="20" />
          <input type="text" placeholder="display name (optional)" bind:value={displayName} maxlength="60" />
          <input type="password" placeholder="password (8+ chars)" bind:value={password} autocomplete="new-password" />
          {#if TURNSTILE_SITE_KEY}<div bind:this={turnstileEl} class="turnstile"></div>{/if}
          <button type="submit" disabled={busy}>{busy ? "…" : "Sign up"}</button>
        </form>
        <button class="link" onclick={() => go("login")}>Already have an account? Log in</button>

      {:else if view === "verify"}
        <p class="tag">enter the 6-digit code sent to<br /><strong>{pendingEmail}</strong></p>
        <form onsubmit={doVerify}>
          <input type="text" inputmode="numeric" maxlength="6" placeholder="______" bind:value={code} class="code" />
          <button type="submit" disabled={busy}>{busy ? "…" : "Verify"}</button>
        </form>
        <button class="link" onclick={doResend}>Resend code</button>

      {:else if view === "login"}
        <p class="tag">welcome back</p>
        <form onsubmit={doLogin}>
          <input type="text" placeholder="email or username" bind:value={identifier} autocomplete="username" />
          <input type="password" placeholder="password" bind:value={password} autocomplete="current-password" />
          <button type="submit" disabled={busy}>{busy ? "…" : "Log in"}</button>
        </form>
        <button class="link" onclick={() => go("signup")}>Need an account? Sign up</button>

      {:else if view === "dashboard"}
        <p class="tag">signed in as <strong>@{user.username}</strong></p>
        <div class="row">
          <button onclick={() => go("editor")}>Edit my page</button>
          <button onclick={() => go("uploads")}>Upload files</button>
          {#if user.isOwner}<button class="owner" onclick={() => go("admin")}>⚙ Owner panel</button>{/if}
          <a class="btnlink" href={"/" + user.username} target="_blank" rel="noopener">View my page ↗</a>
          <button class="ghost" onclick={doLogout}>Log out</button>
        </div>
      {/if}

      {#if error}<p class="error">{error}</p>{/if}
    </div>
  </main>
{/if}

<style>
  main { min-height: 100vh; display: grid; place-items: center; background: radial-gradient(1200px 600px at 50% -10%, #1b1b2e, #0a0a0f 60%); color: #e7e5e4; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { text-align: center; padding: 2rem; width: min(360px, 90vw); }
  h1 { font-size: clamp(2.5rem, 10vw, 4.5rem); margin: 0 0 0.25rem; letter-spacing: -0.04em; font-weight: 700; }
  .tag { color: #a8a29e; margin: 0 0 1.5rem; line-height: 1.5; }
  form { display: flex; flex-direction: column; gap: 0.6rem; }
  input { padding: 0.7rem 0.9rem; border-radius: 10px; border: 1px solid #27272a; background: #111113; color: #e7e5e4; font-size: 0.95rem; outline: none; }
  input:focus { border-color: #6366f1; }
  .code { text-align: center; letter-spacing: 0.5em; font-size: 1.2rem; }
  button { padding: 0.7rem 1rem; border-radius: 10px; border: none; cursor: pointer; background: #6366f1; color: white; font-size: 0.95rem; font-weight: 600; }
  button:hover { opacity: 0.9; }
  button:disabled { opacity: 0.5; cursor: default; }
  button.ghost { background: transparent; border: 1px solid #3f3f46; color: #e7e5e4; }
  .link, button.link { background: none; border: none; color: #818cf8; font-weight: 400; font-size: 0.85rem; margin-top: 1rem; padding: 0; text-decoration: none; display: inline-block; cursor: pointer; }
  .btnlink { padding: 0.7rem 1rem; border-radius: 10px; background: transparent; border: 1px solid #3f3f46; color: #e7e5e4; font-size: 0.95rem; font-weight: 600; text-decoration: none; }
  .row { display: flex; gap: 0.6rem; flex-direction: column; }
  .error { color: #f87171; font-size: 0.85rem; margin-top: 1rem; }
  strong { color: #e7e5e4; }
  button.owner { background: linear-gradient(135deg, #7c3aed, #db2777); }
</style>
