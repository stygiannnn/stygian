<script>
  let { onClose } = $props();

  let users = $state([]);
  let loading = $state(true);
  let err = $state("");
  let q = $state("");
  let meId = $state("");

  let selId = $state("");
  let sel = $state(null);
  let detailLoading = $state(false);
  let actionErr = $state("");
  let notice = $state("");

  let fUsername = $state("");
  let fDisplay = $state("");
  let fPassword = $state("");
  let pAvatar = $state("");
  let pBanner = $state("");
  let pBackground = $state("");
  let pSeconds = $state(15);

  async function req(path, method = "GET", data) {
    const opt = { method, headers: {} };
    if (data !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(data); }
    const res = await fetch(path, opt);
    let j = {};
    try { j = await res.json(); } catch {}
    return { status: res.status, ...j };
  }

  async function load() {
    loading = true; err = "";
    const r = await req("/api/admin/users");
    loading = false;
    if (r.ok) { users = r.users || []; meId = r.me || ""; }
    else err = r.error === "forbidden" ? "You don't have owner access." : "Failed to load users.";
  }
  load();

  let filtered = $derived(
    q.trim()
      ? users.filter((u) => ((u.username + " " + (u.displayName || "") + " " + (u.email || "")).toLowerCase().includes(q.trim().toLowerCase())))
      : users
  );

  function fmtDate(sec) {
    if (!sec) return "—";
    try { return new Date(sec * 1000).toLocaleString(); } catch { return "—"; }
  }
  function flash(m) { notice = m; setTimeout(() => { if (notice === m) notice = ""; }, 2600); }

  async function open(u) {
    if (selId === u.id) { selId = ""; sel = null; return; }
    selId = u.id; sel = null; detailLoading = true; actionErr = "";
    const r = await req("/api/admin/users/" + u.id);
    detailLoading = false;
    if (r.ok) {
      sel = r.user;
      fUsername = r.user.username;
      fDisplay = r.user.displayName || "";
      fPassword = ""; pAvatar = ""; pBanner = ""; pBackground = ""; pSeconds = 15;
    } else { actionErr = "Could not load this user."; }
  }
  async function refreshDetail() {
    if (!selId) return;
    const r = await req("/api/admin/users/" + selId);
    if (r.ok) sel = r.user;
  }

  async function saveNames() {
    actionErr = "";
    const payload = {};
    if (fUsername.trim() && fUsername.trim() !== sel.username) payload.username = fUsername.trim();
    if (fDisplay !== (sel.displayName || "")) payload.displayName = fDisplay;
    if (!Object.keys(payload).length) { flash("Nothing changed."); return; }
    const r = await req("/api/admin/users/" + sel.id, "PATCH", payload);
    if (r.ok) { flash("Saved."); await refreshDetail(); await load(); fUsername = sel.username; }
    else actionErr = r.error === "username_taken" ? "That username is already taken."
      : r.error === "invalid_username" ? "Invalid username (3–20 letters, numbers, _ or -)."
      : "Update failed.";
  }

  async function resetPassword() {
    actionErr = "";
    if (fPassword.length < 8) { actionErr = "Password must be at least 8 characters."; return; }
    const r = await req("/api/admin/users/" + sel.id + "/password", "POST", { password: fPassword });
    if (r.ok) { fPassword = ""; flash("Password reset — their sessions were logged out."); }
    else actionErr = r.error === "weak_password" ? "Password must be at least 8 characters." : "Reset failed.";
  }

  async function clearImage(which) {
    const r = await req("/api/admin/users/" + sel.id + "/image", "POST", { which });
    if (r.ok) { flash("Cleared " + which + "."); await refreshDetail(); }
    else actionErr = "Could not clear " + which + ".";
  }

  async function wipeProfile() {
    if (!confirm("Wipe @" + sel.username + "'s profile back to default? Bio and all page config are cleared. This cannot be undone.")) return;
    const r = await req("/api/admin/users/" + sel.id + "/wipe", "POST", {});
    if (r.ok) { flash("Profile wiped."); await refreshDetail(); await load(); }
    else actionErr = "Wipe failed.";
  }

  async function delUpload(uploadId) {
    const r = await req("/api/admin/users/" + sel.id + "/uploads/" + uploadId, "DELETE");
    if (r.ok) { await refreshDetail(); await load(); }
  }

  async function delAccount(u) {
    const who = u.username;
    if (!confirm("Permanently delete @" + who + "? Removes their account, profile, uploads and sessions. This cannot be undone.")) return;
    const typed = prompt('Type the username "' + who + '" to confirm deletion:');
    if (typed !== who) { flash("Deletion cancelled."); return; }
    const r = await req("/api/admin/users/" + u.id, "DELETE");
    if (r.ok) { if (selId === u.id) { selId = ""; sel = null; } flash("@" + who + " deleted."); await load(); }
    else actionErr = r.error === "cannot_delete_self" ? "You can't delete your own owner account here." : "Delete failed.";
  }

  async function prank() {
    actionErr = "";
    if (!pAvatar.trim() && !pBanner.trim() && !pBackground.trim()) { actionErr = "Enter at least one image URL to prank with."; return; }
    const r = await req("/api/admin/users/" + sel.id + "/prank", "POST", {
      avatar: pAvatar.trim() || undefined,
      banner: pBanner.trim() || undefined,
      background: pBackground.trim() || undefined,
      seconds: Number(pSeconds) || 15,
    });
    if (r.ok) flash("Prank live for " + r.seconds + "s on @" + sel.username + ".");
    else actionErr = r.error === "nothing_to_set" ? "Enter at least one image URL." : "Prank failed.";
  }
</script>

<div class="wrap">
  <header>
    <button class="back" onclick={onClose}>← Dashboard</button>
    <h1>Owner panel</h1>
    <button class="back" onclick={load}>Refresh</button>
  </header>

  {#if notice}<div class="toast">{notice}</div>{/if}

  {#if loading}
    <p class="dim">Loading users…</p>
  {:else if err}
    <p class="err">{err}</p>
  {:else}
    <input class="search" placeholder="Search username, display name or email…" bind:value={q} />
    <p class="count">{filtered.length} user{filtered.length === 1 ? "" : "s"}</p>

    <div class="list">
      {#each filtered as u (u.id)}
        <div class="urow" class:open={selId === u.id}>
          <button class="uhead" onclick={() => open(u)}>
            <span class="uname">@{u.username}{#if u.id === meId}<span class="youtag">you</span>{/if}</span>
            <span class="udisp">{u.displayName || "—"}</span>
            <span class="uloc">{[u.lastCity, u.lastCountry].filter(Boolean).join(", ") || "—"}</span>
            <span class="ucount">{u.uploadCount} up</span>
            <span class="ubadges">{u.badges || ""}</span>
          </button>

          {#if selId === u.id}
            <div class="detail">
              {#if detailLoading}
                <p class="dim">Loading…</p>
              {:else if sel}
                {#if actionErr}<p class="err">{actionErr}</p>{/if}

                <div class="grid">
                  <div><span class="k">Email</span><span class="v">{sel.email}</span></div>
                  <div><span class="k">Verified</span><span class="v">{sel.emailVerified ? "yes" : "no"}</span></div>
                  <div><span class="k">IP</span><span class="v">{sel.lastIp || "—"}</span></div>
                  <div><span class="k">Location</span><span class="v">{[sel.lastCity, sel.lastRegion, sel.lastCountry].filter(Boolean).join(", ") || "—"}</span></div>
                  <div><span class="k">Last seen</span><span class="v">{fmtDate(sel.lastSeenAt)}</span></div>
                  <div><span class="k">Joined</span><span class="v">{fmtDate(sel.createdAt)}</span></div>
                  <div class="wide"><span class="k">Browser</span><span class="v ua">{sel.lastUa || "—"}</span></div>
                  <div class="wide"><span class="k">Badges</span><span class="v">{sel.badges || "—"}</span></div>
                </div>

                <a class="view" href={"/" + sel.username} target="_blank" rel="noopener">View profile ↗</a>

                <div class="sec">
                  <h3>Images</h3>
                  <div class="imgs">
                    <div class="imgcell">
                      <span class="k">Avatar</span>
                      {#if sel.avatar}<img src={sel.avatar} alt="" /><button class="mini" onclick={() => clearImage("avatar")}>Clear</button>{:else}<span class="none">none</span>{/if}
                    </div>
                    <div class="imgcell">
                      <span class="k">Banner</span>
                      {#if sel.banner}<img src={sel.banner} alt="" /><button class="mini" onclick={() => clearImage("banner")}>Clear</button>{:else}<span class="none">none</span>{/if}
                    </div>
                    <div class="imgcell">
                      <span class="k">Background</span>
                      {#if sel.background}<img src={sel.background} alt="" /><button class="mini" onclick={() => clearImage("background")}>Clear</button>{:else}<span class="none">none</span>{/if}
                    </div>
                  </div>
                </div>

                <div class="sec">
                  <h3>Uploads ({sel.uploads.length})</h3>
                  {#if sel.uploads.length}
                    <div class="ups">
                      {#each sel.uploads as up (up.id)}
                        <div class="up">
                          <a href={up.url} target="_blank" rel="noopener">{up.filename || up.id}</a>
                          <span class="updim">{Math.round((up.size || 0) / 1024)}kb{up.expired ? " · expired" : ""}</span>
                          <button class="mini danger" onclick={() => delUpload(up.id)}>Delete</button>
                        </div>
                      {/each}
                    </div>
                  {:else}<p class="dim">No uploads.</p>{/if}
                </div>

                <div class="sec">
                  <h3>Identity</h3>
                  <label class="fld"><span>Username</span><input bind:value={fUsername} maxlength="20" /></label>
                  <label class="fld"><span>Display name</span><input bind:value={fDisplay} maxlength="60" /></label>
                  <button class="act" onclick={saveNames}>Save identity</button>
                </div>

                <div class="sec">
                  <h3>Reset password</h3>
                  <label class="fld"><span>New password</span><input type="text" bind:value={fPassword} placeholder="8+ characters" /></label>
                  <button class="act" onclick={resetPassword}>Set new password</button>
                  <p class="hint">Sets the password directly and logs out their active sessions.</p>
                </div>

                <div class="sec prank">
                  <h3>Prank — temporary image override</h3>
                  <label class="fld"><span>Avatar URL</span><input bind:value={pAvatar} placeholder="https://…" /></label>
                  <label class="fld"><span>Banner URL</span><input bind:value={pBanner} placeholder="https://…" /></label>
                  <label class="fld"><span>Background URL</span><input bind:value={pBackground} placeholder="https://…" /></label>
                  <label class="fld narrow"><span>Seconds (1–300)</span><input type="number" min="1" max="300" bind:value={pSeconds} /></label>
                  <button class="act fun" onclick={prank}>Prank @{sel.username}</button>
                  <p class="hint">Overrides their live profile images for the chosen time, then it reverts automatically.</p>
                </div>

                <div class="sec danger-sec">
                  <h3>Danger zone</h3>
                  <button class="act warn" onclick={wipeProfile}>Wipe profile to default</button>
                  <button class="act danger" onclick={() => delAccount(sel)} disabled={sel.id === meId}>Delete account</button>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { min-height: 100vh; background: #0a0a0f; color: #e7e5e4; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 1.2rem; max-width: 760px; margin: 0 auto; box-sizing: border-box; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  header h1 { font-size: 1.25rem; margin: 0; letter-spacing: -0.02em; }
  .back { background: transparent; border: 1px solid #3f3f46; color: #e7e5e4; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; font-size: 0.82rem; }
  .back:hover { background: rgba(255,255,255,0.06); }
  .search { width: 100%; padding: 0.6rem 0.8rem; border-radius: 10px; border: 1px solid #27272a; background: #111113; color: #e7e5e4; font-size: 0.9rem; outline: none; box-sizing: border-box; }
  .search:focus { border-color: #6366f1; }
  .count { color: #a8a29e; font-size: 0.78rem; margin: 0.5rem 0 0.7rem; }
  .toast { position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); background: #6366f1; color: #fff; padding: 0.5rem 1rem; border-radius: 10px; font-size: 0.85rem; z-index: 20; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
  .dim { color: #a8a29e; font-size: 0.88rem; }
  .err { color: #f87171; font-size: 0.84rem; margin: 0.4rem 0; }
  .list { display: flex; flex-direction: column; gap: 0.5rem; }
  .urow { border: 1px solid #1f1f25; border-radius: 12px; background: #111113; overflow: hidden; }
  .urow.open { border-color: #3730a3; }
  .uhead { width: 100%; display: grid; grid-template-columns: 1.3fr 1.1fr 1.1fr auto auto; gap: 0.6rem; align-items: center; text-align: left; background: transparent; border: none; color: #e7e5e4; padding: 0.7rem 0.9rem; cursor: pointer; font-size: 0.84rem; }
  .uhead:hover { background: rgba(255,255,255,0.03); }
  .uname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .youtag { font-size: 0.58rem; background: #6366f1; color: #fff; padding: 1px 5px; border-radius: 6px; margin-left: 5px; vertical-align: middle; }
  .udisp, .uloc { color: #a8a29e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ucount, .ubadges { color: #a8a29e; font-size: 0.72rem; text-align: right; white-space: nowrap; }
  .ubadges { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
  .detail { border-top: 1px solid #1f1f25; padding: 0.9rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; margin-bottom: 0.8rem; }
  .grid .wide { grid-column: 1 / -1; }
  .grid .k, .imgcell .k { display: block; color: #71717a; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 1px; }
  .grid .v { font-size: 0.84rem; word-break: break-word; }
  .grid .v.ua { font-size: 0.72rem; color: #a8a29e; }
  .view { display: inline-block; color: #818cf8; font-size: 0.84rem; text-decoration: none; margin-bottom: 0.4rem; }
  .sec { border-top: 1px solid #1a1a1f; padding-top: 0.8rem; margin-top: 0.8rem; }
  .sec h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; margin: 0 0 0.6rem; }
  .imgs { display: flex; gap: 0.9rem; flex-wrap: wrap; }
  .imgcell { display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start; }
  .imgcell img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #27272a; display: block; }
  .none { color: #52525b; font-size: 0.8rem; }
  .ups { display: flex; flex-direction: column; gap: 0.4rem; }
  .up { display: flex; align-items: center; gap: 0.6rem; font-size: 0.82rem; }
  .up a { color: #818cf8; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; }
  .updim { color: #71717a; font-size: 0.72rem; flex: 1; }
  .fld { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
  .fld.narrow { max-width: 160px; }
  .fld span { font-size: 0.7rem; color: #a1a1aa; }
  .fld input { padding: 0.5rem 0.7rem; border-radius: 8px; border: 1px solid #27272a; background: #0d0d10; color: #e7e5e4; font-size: 0.85rem; outline: none; }
  .fld input:focus { border-color: #6366f1; }
  .act { padding: 0.5rem 0.9rem; border-radius: 8px; border: none; background: #6366f1; color: #fff; font-size: 0.82rem; font-weight: 600; cursor: pointer; margin-top: 0.2rem; }
  .act:hover { opacity: 0.9; }
  .act:disabled { opacity: 0.4; cursor: default; }
  .act.fun { background: #db2777; }
  .act.warn { background: #b45309; margin-right: 0.5rem; }
  .act.danger { background: #b91c1c; }
  .mini { padding: 0.25rem 0.55rem; border-radius: 6px; border: 1px solid #3f3f46; background: transparent; color: #e7e5e4; font-size: 0.72rem; cursor: pointer; }
  .mini.danger { border-color: #7f1d1d; color: #fca5a5; }
  .mini:hover { background: rgba(255,255,255,0.06); }
  .hint { color: #71717a; font-size: 0.72rem; margin: 0.4rem 0 0; }
  .prank h3 { color: #f472b6; }
  .danger-sec { border-top-color: #3f1d1d; }
  .danger-sec h3 { color: #f87171; }
</style>
