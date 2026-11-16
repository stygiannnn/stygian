<script>
  let health = $state("checking…");

  async function ping() {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      health = data.ok ? "online" : "error";
    } catch {
      health = "offline";
    }
  }
  ping();
</script>

<main>
  <div class="card">
    <h1>stygian</h1>
    <p class="tag">profiles, your way — coming soon</p>
    <p class="status">backend: <span class:ok={health === "online"}>{health}</span></p>
  </div>
</main>

<style>
  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: radial-gradient(1200px 600px at 50% -10%, #1b1b2e, #0a0a0f 60%);
    color: #e7e5e4;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { text-align: center; padding: 2rem; }
  h1 {
    font-size: clamp(2.5rem, 10vw, 5rem);
    margin: 0;
    letter-spacing: -0.04em;
    font-weight: 700;
  }
  .tag { color: #a8a29e; margin-top: 0.5rem; }
  .status { margin-top: 2rem; font-size: 0.85rem; color: #57534e; }
  .status span { color: #eab308; }
  .status span.ok { color: #22c55e; }
</style>
