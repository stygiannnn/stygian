<script>
  let { onClose } = $props();

  const MAX = 20 * 1024 * 1024;

  let uploads = $state([]);
  let uploading = $state(false);
  let progress = $state(0);
  let error = $state("");
  let dragOver = $state(false);
  let copiedId = $state("");
  let fileInput = $state(null);
  let now = $state(Math.floor(Date.now() / 1000));

  const ERR = {
    too_large: "That file is over 20MB.",
    unsupported_type: "Only images, GIFs and videos are allowed.",
    not_verified: "You need a verified email to upload.",
    unauthorized: "Please log in again.",
    uploads_unavailable: "Uploads aren't set up yet.",
    missing_length: "Couldn't read that file.",
  };

  async function load() {
    try { const r = await fetch("/api/me/uploads"); const d = await r.json(); if (d.ok) uploads = d.uploads; } catch {}
  }
  load();
  setInterval(() => (now = Math.floor(Date.now() / 1000)), 1000);

  function pick() { fileInput?.click(); }
  function onFile(e) { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }
  function onDrop(e) { e.preventDefault(); dragOver = false; const f = e.dataTransfer?.files?.[0]; if (f) upload(f); }

  function upload(file) {
    error = "";
    if (file.size > MAX) { error = ERR.too_large; return; }
    if (!/^(image|video)\//.test(file.type)) { error = ERR.unsupported_type; return; }
    uploading = true; progress = 0;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) progress = Math.round((ev.loaded / ev.total) * 100); };
    xhr.onload = () => {
      uploading = false;
      try {
        const d = JSON.parse(xhr.responseText);
        if (d.ok) load();
        else error = ERR[d.error] || "Upload failed.";
      } catch { error = "Upload failed."; }
    };
    xhr.onerror = () => { uploading = false; error = "Upload failed."; };
    xhr.send(file);
  }

  async function remove(id) {
    try { await fetch("/api/uploads/" + id, { method: "DELETE" }); } catch {}
    uploads = uploads.filter((u) => u.id !== id);
  }

  async function copy(u) {
    try { await navigator.clipboard.writeText(u.url); copiedId = u.id; setTimeout(() => (copiedId = ""), 1500); } catch {}
  }

  function fmtSize(b) {
    if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
    if (b >= 1e3) return Math.round(b / 1e3) + " KB";
    return b + " B";
  }
  function remaining(expiresAt) {
    let s = expiresAt - now;
    if (s <= 0) return "expired";
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }
  const isVideo = (u) => (u.contentType || "").startsWith("video/");
</script>

<div class="wrap">
  <div class="head">
    <button class="back" onclick={onClose}>← Back</button>
    <h2>Uploads</h2>
  </div>
  <p class="sub">Drop an image, GIF or video (max 20MB). Links auto-delete after 24 hours and embed in Discord.</p>

  <div class="drop" class:over={dragOver} class:busy={uploading}
       ondragover={(e) => { e.preventDefault(); dragOver = true; }}
       ondragleave={() => (dragOver = false)}
       ondrop={onDrop}
       onclick={pick} role="button" tabindex="0">
    {#if uploading}
      <div class="bar"><div class="fill" style={`width:${progress}%`}></div></div>
      <p class="dim">Uploading… {progress}%</p>
    {:else}
      <p class="big">Drop a file here</p>
      <p class="dim">or click to choose · images, GIFs, videos · up to 20MB</p>
    {/if}
  </div>
  <input bind:this={fileInput} type="file" accept="image/*,video/*" onchange={onFile} hidden />
  {#if error}<p class="err">{error}</p>{/if}

  {#if uploads.length}
    <div class="section">Your files</div>
    <div class="list">
      {#each uploads as u (u.id)}
        <div class="row">
          <div class="thumb">
            {#if isVideo(u)}<video src={u.url} muted></video>{:else}<img src={u.url} alt="" />{/if}
          </div>
          <div class="info">
            <span class="name">{u.filename || u.id + "." + u.url.split(".").pop()}</span>
            <span class="meta">{fmtSize(u.size)} · {remaining(u.expiresAt)}</span>
          </div>
          <div class="actions">
            <button class="copy" onclick={() => copy(u)}>{copiedId === u.id ? "Copied ✓" : "Copy link"}</button>
            <button class="del" onclick={() => remove(u.id)} aria-label="Delete">✕</button>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty">No active uploads.</p>
  {/if}
</div>

<style>
  .wrap { min-height: 100vh; background: #09090b; color: #e7e5e4; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 640px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  .head { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.3rem; }
  .back { background: none; border: 1px solid #27272a; color: #e7e5e4; padding: 0.4rem 0.8rem; border-radius: 8px; cursor: pointer; }
  h2 { margin: 0; font-size: 1.3rem; }
  .sub { color: #a1a1aa; font-size: 0.85rem; margin: 0.2rem 0 1.2rem; line-height: 1.5; }
  .drop { border: 1.5px dashed #3f3f46; border-radius: 14px; padding: 2.5rem 1rem; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; background: #0e0e11; }
  .drop.over { border-color: #6366f1; background: #14141b; }
  .drop.busy { cursor: default; }
  .drop .big { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.3rem; }
  .drop .dim { color: #71717a; font-size: 0.82rem; margin: 0; }
  .bar { height: 8px; background: #27272a; border-radius: 999px; overflow: hidden; margin: 0 0 0.7rem; }
  .fill { height: 100%; background: #6366f1; transition: width 0.15s; }
  .err { color: #f87171; font-size: 0.85rem; margin: 0.8rem 0 0; }
  .section { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a; margin: 1.6rem 0 0.6rem; }
  .empty { color: #52525b; font-size: 0.85rem; text-align: center; margin-top: 2rem; }
  .list { display: flex; flex-direction: column; gap: 0.6rem; }
  .row { display: flex; align-items: center; gap: 0.8rem; background: #111113; border: 1px solid #1f1f23; border-radius: 11px; padding: 0.6rem; }
  .thumb { width: 52px; height: 52px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: #000; }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; }
  .info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 0.72rem; color: #71717a; }
  .actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
  .copy { background: #6366f1; border: none; color: #fff; padding: 0.4rem 0.7rem; border-radius: 8px; cursor: pointer; font-size: 0.78rem; font-weight: 600; }
  .del { background: none; border: none; color: #71717a; cursor: pointer; font-size: 0.95rem; }
  .del:hover { color: #f87171; }
</style>
