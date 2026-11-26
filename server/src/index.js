import { hashPassword, verifyPassword, sha256Hex, randomToken, randomCode, uuid } from "./crypto.js";
import { sendVerificationEmail } from "./email.js";
import { isDisposableEmail } from "./disposable.js";
import { isCleanName } from "./filter.js";
import { PLATFORMS, pkceChallenge } from "./oauth.js";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days (seconds)
const CODE_TTL = 60 * 15; // 15 minutes (seconds)
const MAX_CODE_ATTEMPTS = 5;
const MAX_CONFIG_BYTES = 20000;
const MAX_UPLOAD = 20 * 1024 * 1024; // 20 MB
const UPLOAD_TTL = 60 * 60 * 5; // file lifetime: 5 hours (seconds)
const UPLOADS_PER_DAY = 10; // max uploads per user per day
const UPLOAD_LIMIT_WINDOW = 60 * 60 * 24; // rolling window for the daily upload limit (24h)
let uploadEventsReady = false; // per-isolate cache so the DDL below runs at most once
const EXT_BY_TYPE = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/avif": "avif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(url, request, env);
      } catch (err) {
        console.error("api error", err);
        return json({ ok: false, error: "server_error" }, 500);
      }
    }
    if (url.pathname.startsWith("/f/")) {
      try {
        return await serveUpload(url.pathname.slice("/f/".length), request, env);
      } catch (err) {
        console.error("serve error", err);
        return new Response("Error", { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupExpiredUploads(env));
  },
};

async function handleApi(url, request, env) {
  const p = url.pathname;
  const m = request.method;

  if (p === "/api/health" && m === "GET") {
    return json({ ok: true, service: "stygian", time: new Date().toISOString() });
  }
  if (p === "/api/auth/signup" && m === "POST") return signup(request, env);
  if (p === "/api/auth/verify" && m === "POST") return verify(request, env);
  if (p === "/api/auth/resend" && m === "POST") return resend(request, env);
  if (p === "/api/auth/login" && m === "POST") return login(request, env);
  if (p === "/api/auth/logout" && m === "POST") return logout(request, env);
  if (p === "/api/auth/me" && m === "GET") return me(request, env);

  if (p === "/api/me/profile" && m === "GET") return myProfile(request, env);
  if (p === "/api/me/profile" && m === "PUT") return saveProfile(request, env);
  if (p.startsWith("/api/profile/") && m === "GET") return publicProfile(p.slice("/api/profile/".length), env);

  if (p.startsWith("/api/oauth/") && m === "GET") return oauthRoute(p, url, request, env);
  if (p === "/api/me/social" && m === "GET") return mySocial(request, env);
  if (p.startsWith("/api/me/social/") && p.endsWith("/disconnect") && m === "POST") return disconnectSocial(p, request, env);

  if (p === "/api/uploads" && m === "POST") return createUpload(request, env);
  if (p === "/api/me/uploads" && m === "GET") return myUploads(request, env);
  if (p.startsWith("/api/uploads/") && m === "DELETE") return deleteUpload(p, request, env);

  if (p === "/api/cursors" && m === "GET") return listCursors(request, env);

  if (p === "/api/me/username" && m === "PUT") return changeUsername(request, env);

  if (p === "/api/admin/users" && m === "GET") return adminListUsers(request, env);
  if (p.startsWith("/api/admin/users/")) return adminUserRoute(p, request, env);

  return json({ ok: false, error: "not_found" }, 404);
}

// ---------- helpers ----------
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return true; // captcha not configured -> allow
  if (!token) return false;
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", String(token));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json();
    return !!d.success;
  } catch (err) { console.error("turnstile", err); return false; }
}
function validEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}
function validUsername(u) {
  return typeof u === "string" && /^[a-zA-Z0-9_-]{3,20}$/.test(u);
}
function validPassword(p) {
  return typeof p === "string" && p.length >= 8 && p.length <= 200;
}
function sessionCookie(token, maxAge) {
  return [`sid=${token}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${maxAge}`].join("; ");
}
function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
async function createSession(env, userId, request) {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, now, now + SESSION_TTL).run();
  if (request) { try { await recordUserMeta(env, userId, request, now); } catch (e) { console.error("user meta", e); } }
  return token;
}
async function currentUser(request, env) {
  const token = getCookie(request, "sid");
  if (!token) return null;
  const id = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  return await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.email_verified, u.badges
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  ).bind(id, now).first();
}
function publicUser(u) {
  return { id: u.id, email: u.email, username: u.username, emailVerified: !!u.email_verified, isOwner: isOwner(u) };
}

// ---------- auth ----------
async function signup(request, env) {
  const { email, username, displayName, password, turnstileToken } = await body(request);
  if (!(await verifyTurnstile(turnstileToken, request, env))) return json({ ok: false, error: "captcha_failed" }, 400);
  const e = String(email || "").trim().toLowerCase();
  const u = String(username || "").trim();
  const dn = String(displayName || "").trim();
  if (!validEmail(e)) return json({ ok: false, error: "invalid_email" }, 400);
  if (isDisposableEmail(e)) return json({ ok: false, error: "disposable_email" }, 400);
  if (!validUsername(u)) return json({ ok: false, error: "invalid_username" }, 400);
  if (!validPassword(password)) return json({ ok: false, error: "weak_password" }, 400);
  if (!isCleanName(u)) return json({ ok: false, error: "inappropriate_username" }, 400);
  if (dn && (dn.length > 60 || !isCleanName(dn))) return json({ ok: false, error: "inappropriate_name" }, 400);

  const existing = await env.DB.prepare("SELECT email, username_lower FROM users WHERE email = ? OR username_lower = ?")
    .bind(e, u.toLowerCase()).first();
  if (existing) {
    if (existing.email === e) return json({ ok: false, error: "email_taken" }, 409);
    return json({ ok: false, error: "username_taken" }, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = uuid();
  const pwHash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, username_lower, password_hash, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(id, e, u, u.toLowerCase(), pwHash, now, now).run();
  await env.DB.prepare("INSERT INTO profiles (user_id, display_name, bio, config, updated_at) VALUES (?, ?, '', '{}', ?)")
    .bind(id, dn || u, now).run();

  await issueCode(env, id, e);
  return json({ ok: true, needsVerification: true, email: e });
}
async function issueCode(env, userId, email) {
  const code = randomCode();
  const codeHash = await sha256Hex(code);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM email_verifications WHERE user_id = ?").bind(userId).run();
  await env.DB.prepare(
    "INSERT INTO email_verifications (id, user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)"
  ).bind(uuid(), userId, codeHash, now + CODE_TTL, now).run();
  await sendVerificationEmail(env, email, code);
}
async function verify(request, env) {
  const { email, code } = await body(request);
  const e = String(email || "").trim().toLowerCase();
  const c = String(code || "").trim();
  if (!validEmail(e) || !/^\d{6}$/.test(c)) return json({ ok: false, error: "invalid_input" }, 400);
  const user = await env.DB.prepare("SELECT id, email_verified FROM users WHERE email = ?").bind(e).first();
  if (!user) return json({ ok: false, error: "not_found" }, 404);
  if (user.email_verified) return json({ ok: false, error: "already_verified" }, 400);
  const rec = await env.DB.prepare("SELECT id, code_hash, expires_at, attempts FROM email_verifications WHERE user_id = ?")
    .bind(user.id).first();
  const now = Math.floor(Date.now() / 1000);
  if (!rec || rec.expires_at < now) return json({ ok: false, error: "code_expired" }, 400);
  if (rec.attempts >= MAX_CODE_ATTEMPTS) return json({ ok: false, error: "too_many_attempts" }, 429);
  const codeHash = await sha256Hex(c);
  if (codeHash !== rec.code_hash) {
    await env.DB.prepare("UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?").bind(rec.id).run();
    return json({ ok: false, error: "wrong_code" }, 400);
  }
  await env.DB.prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?").bind(now, user.id).run();
  await env.DB.prepare("DELETE FROM email_verifications WHERE user_id = ?").bind(user.id).run();
  const token = await createSession(env, user.id, request);
  const fresh = await env.DB.prepare("SELECT id, email, username, email_verified, badges FROM users WHERE id = ?").bind(user.id).first();
  return json({ ok: true, user: publicUser(fresh) }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL) });
}
async function resend(request, env) {
  const { email } = await body(request);
  const e = String(email || "").trim().toLowerCase();
  if (!validEmail(e)) return json({ ok: false, error: "invalid_email" }, 400);
  const user = await env.DB.prepare("SELECT id, email_verified FROM users WHERE email = ?").bind(e).first();
  if (user && !user.email_verified) await issueCode(env, user.id, e);
  return json({ ok: true });
}
async function login(request, env) {
  const { identifier, password } = await body(request);
  const id = String(identifier || "").trim();
  if (!id || !validPassword(password)) return json({ ok: false, error: "invalid_input" }, 400);
  const user = await env.DB.prepare(
    "SELECT id, email, username, password_hash, email_verified, badges FROM users WHERE email = ? OR username_lower = ?"
  ).bind(id.toLowerCase(), id.toLowerCase()).first();
  if (!user) return json({ ok: false, error: "invalid_credentials" }, 401);
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return json({ ok: false, error: "invalid_credentials" }, 401);
  if (!user.email_verified) {
    await issueCode(env, user.id, user.email);
    return json({ ok: false, error: "not_verified", email: user.email }, 403);
  }
  const token = await createSession(env, user.id, request);
  return json({ ok: true, user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL) });
}
async function logout(request, env) {
  const token = getCookie(request, "sid");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}
async function me(request, env) {
  const u = await currentUser(request, env);
  return json({ ok: true, user: u ? publicUser(u) : null });
}

// ---------- profiles ----------
function parseConfig(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

async function publicProfile(usernameRaw, env) {
  const u = decodeURIComponent(usernameRaw || "").toLowerCase();
  if (!validUsername(u)) return json({ ok: false, error: "not_found" }, 404);
  const row = await env.DB.prepare(
    `SELECT u.id AS uid, u.username, u.badges, p.display_name, p.bio, p.config
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.username_lower = ? AND u.email_verified = 1`
  ).bind(u).first();
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  const socials = await loadPublicSocials(env, row.uid);
  const cfg = parseConfig(row.config);
  const override = await getActiveOverride(env, row.uid);
  if (override) applyOverride(cfg, override);
  const verified = Object.keys(socials).length > 0;
  const badges = String(row.badges || "").split(",").map((b) => b.trim().toLowerCase()).filter(Boolean);
  let nowPlaying = null;
  if (cfg && cfg.spotifyNowPlaying) nowPlaying = await fetchNowPlaying(env, row.uid);
  return json({ ok: true, profile: {
    username: row.username, displayName: row.display_name, bio: row.bio, config: cfg, socials, verified, badges, nowPlaying,
    overrideExpiresAt: override ? override.expires_at : null,
  }});
}
async function myProfile(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const row = await env.DB.prepare("SELECT display_name, bio, config FROM profiles WHERE user_id = ?").bind(user.id).first();
  return json({ ok: true, profile: {
    username: user.username, displayName: row?.display_name || "", bio: row?.bio || "", config: parseConfig(row?.config),
  }});
}
async function saveProfile(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const data = await body(request);
  const displayName = String(data.displayName ?? "").slice(0, 60);
  if (displayName && !isCleanName(displayName)) return json({ ok: false, error: "inappropriate_name" }, 400);
  const bio = String(data.bio ?? "").slice(0, 300);
  const cfg = data.config ?? {};
  if (cfg && Array.isArray(cfg.links) && cfg.links.length > 5) cfg.links = cfg.links.slice(0, 5);
  const configStr = JSON.stringify(cfg);
  if (configStr.length > MAX_CONFIG_BYTES) return json({ ok: false, error: "too_large" }, 413);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE profiles SET display_name = ?, bio = ?, config = ?, updated_at = ? WHERE user_id = ?")
    .bind(displayName, bio, configStr, now, user.id).run();
  return json({ ok: true });
}

// ---------- social connections ----------
function redirect(location) { return new Response(null, { status: 302, headers: { Location: location } }); }
function baseUrl(env) { return env.PUBLIC_BASE_URL || "https://stygian.wtf"; }
function redirectUri(env, platform) { return baseUrl(env) + "/api/oauth/" + platform + "/callback"; }

async function loadPublicSocials(env, userId) {
  const out = {};
  try {
    const res = await env.DB.prepare("SELECT platform, stats FROM social_connections WHERE user_id = ?").bind(userId).all();
    for (const s of (res.results || [])) {
      let st = {}; try { st = JSON.parse(s.stats || "{}"); } catch {}
      out[s.platform] = {
        username: st.username || "", followers: st.followers ?? null,
        likes: st.likes ?? null, following: st.following ?? null, verified: !!st.verified,
      };
    }
  } catch (e) { console.error("loadPublicSocials", e); }
  return out;
}

async function fetchNowPlaying(env, userId) {
  try {
    const row = await env.DB.prepare(
      "SELECT access_token, refresh_token, expires_at FROM social_connections WHERE user_id = ? AND platform = 'spotify'"
    ).bind(userId).first();
    if (!row) return null; // spotify not connected
    let token = row.access_token;
    const now = Math.floor(Date.now() / 1000);
    if (row.expires_at && row.expires_at < now && row.refresh_token) {
      const t = await PLATFORMS.spotify.refresh(env, row.refresh_token);
      if (t.access_token) {
        token = t.access_token;
        const expiresAt = t.expires_in ? now + Number(t.expires_in) : null;
        await env.DB.prepare("UPDATE social_connections SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ? AND platform = 'spotify'")
          .bind(token, t.refresh_token || row.refresh_token, expiresAt, userId).run();
      }
    }
    return await PLATFORMS.spotify.nowPlaying(token);
  } catch (e) { console.error("nowPlaying", e); return { playing: false }; }
}

async function oauthRoute(p, url, request, env) {
  const parts = p.split("/").filter(Boolean); // ["api","oauth","<platform>","<action>"]
  const platform = parts[2], action = parts[3];
  if (!PLATFORMS[platform]) return json({ ok: false, error: "unknown_platform" }, 404);
  if (action === "start") return oauthStart(platform, request, env);
  if (action === "callback") return oauthCallback(platform, url, request, env);
  return json({ ok: false, error: "not_found" }, 404);
}

async function oauthStart(platform, request, env) {
  const user = await currentUser(request, env);
  const base = baseUrl(env);
  if (!user) return redirect(base + "/");
  const prov = PLATFORMS[platform];
  if (!prov.configured(env)) return redirect(base + "/?social_error=" + platform + "_not_configured");
  const state = randomToken(16);
  const now = Math.floor(Date.now() / 1000);
  let verifier = null, challenge = null;
  if (prov.pkce) { verifier = randomToken(48); challenge = await pkceChallenge(verifier); }
  await env.DB.prepare("INSERT INTO oauth_states (state, user_id, platform, code_verifier, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(state, user.id, platform, verifier, now).run();
  return redirect(prov.authorize(env, state, redirectUri(env, platform), challenge));
}

async function oauthCallback(platform, url, request, env) {
  const prov = PLATFORMS[platform];
  const base = baseUrl(env);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return redirect(base + "/?social_error=" + platform);
  const st = await env.DB.prepare("SELECT user_id, platform, code_verifier FROM oauth_states WHERE state = ?").bind(state).first();
  await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!st || st.platform !== platform) return redirect(base + "/?social_error=" + platform);
  try {
    const tok = await prov.exchange(env, code, redirectUri(env, platform), st.code_verifier);
    const accessToken = tok.access_token;
    if (!accessToken) throw new Error("no_access_token");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = tok.expires_in ? now + Number(tok.expires_in) : null;
    const stats = await prov.stats(accessToken);
    await env.DB.prepare(
      `INSERT INTO social_connections (user_id, platform, platform_user_id, platform_username, access_token, refresh_token, expires_at, stats, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, platform) DO UPDATE SET
         platform_user_id = excluded.platform_user_id, platform_username = excluded.platform_username,
         access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at, stats = excluded.stats, updated_at = excluded.updated_at`
    ).bind(st.user_id, platform, tok.open_id || null, stats.username || null, accessToken, tok.refresh_token || null, expiresAt, JSON.stringify(stats), now).run();
    return redirect(base + "/?connected=" + platform);
  } catch (e) {
    console.error("oauth callback", platform, e);
    return redirect(base + "/?social_error=" + platform);
  }
}

async function mySocial(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const res = await env.DB.prepare("SELECT platform, platform_username, access_token, refresh_token, expires_at, stats FROM social_connections WHERE user_id = ?").bind(user.id).all();
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const row of (res.results || [])) {
    let stats = {}; try { stats = JSON.parse(row.stats || "{}"); } catch {}
    try {
      const prov = PLATFORMS[row.platform];
      if (prov && row.expires_at && row.expires_at < now && row.refresh_token) {
        const t = await prov.refresh(env, row.refresh_token);
        if (t.access_token) {
          const expiresAt = t.expires_in ? now + Number(t.expires_in) : null;
          stats = await prov.stats(t.access_token);
          await env.DB.prepare("UPDATE social_connections SET access_token = ?, refresh_token = ?, expires_at = ?, stats = ?, updated_at = ? WHERE user_id = ? AND platform = ?")
            .bind(t.access_token, t.refresh_token || row.refresh_token, expiresAt, JSON.stringify(stats), now, user.id, row.platform).run();
        }
      }
    } catch (e) { console.error("social refresh", row.platform, e); }
    out.push({ platform: row.platform, username: row.platform_username, stats });
  }
  return json({ ok: true, socials: out });
}

async function disconnectSocial(p, request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const platform = p.split("/")[4];
  await env.DB.prepare("DELETE FROM social_connections WHERE user_id = ? AND platform = ?").bind(user.id, platform).run();
  return json({ ok: true });
}

// ---------- cursor catalog (proxied + edge-cached; images load client-side only) ----------
async function listCursors(request, env) {
  // Thin passthrough of custom-cursor.com's catalog. We stream the JSON (no parse,
  // no storage) and let Cloudflare's edge cache it for a day. The client trims the
  // list and caches it in localStorage; cursor images are hotlinked straight from
  // the CDN to each viewer's browser, so our server never touches an image.
  try {
    const upstream = await fetch("https://custom-cursor.com/api/cursors/1/100/all", {
      cf: { cacheTtl: 86400, cacheEverything: true },
      headers: { Accept: "application/json", "User-Agent": "stygian.wtf cursor picker" },
    });
    if (!upstream.ok) return json({ ok: false, error: "cursor_fetch_failed" }, 502);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error("cursors", e);
    return json({ ok: false, error: "cursor_fetch_failed" }, 502);
  }
}

// ---------- uploads (temporary image / gif / video host) ----------
function shortId(n = 8) {
  const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const r = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  for (let i = 0; i < n; i++) out += alpha[r[i] % alpha.length];
  return out;
}

async function ensureUploadEvents(env) {
  if (uploadEventsReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS upload_events (user_id TEXT NOT NULL, created_at INTEGER NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_upload_events_user ON upload_events (user_id, created_at)"
  ).run();
  uploadEventsReady = true;
}

async function createUpload(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  if (!user.email_verified) return json({ ok: false, error: "not_verified" }, 403);
  if (!env.UPLOADS) return json({ ok: false, error: "uploads_unavailable" }, 503);

  try {
    await ensureUploadEvents(env);
    const since = Math.floor(Date.now() / 1000) - UPLOAD_LIMIT_WINDOW;
    const used = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM upload_events WHERE user_id = ? AND created_at > ?"
    ).bind(user.id, since).first();
    if (used && used.n >= UPLOADS_PER_DAY) return json({ ok: false, error: "daily_limit", limit: UPLOADS_PER_DAY }, 429);
  } catch (e) { console.error("upload limit check", e); }

  const ct = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[ct];
  if (!ext) return json({ ok: false, error: "unsupported_type" }, 415);

  const len = Number(request.headers.get("Content-Length") || 0);
  if (!len) return json({ ok: false, error: "missing_length" }, 411);
  if (len > MAX_UPLOAD) return json({ ok: false, error: "too_large" }, 413);
  if (!request.body) return json({ ok: false, error: "empty" }, 400);

  const id = shortId(8);
  const key = id + "." + ext;
  await env.UPLOADS.put(key, request.body, { httpMetadata: { contentType: ct } });

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + UPLOAD_TTL;
  let filename = request.headers.get("X-Filename") || "";
  try { filename = decodeURIComponent(filename); } catch {}
  filename = String(filename).slice(0, 200);

  await env.DB.prepare(
    "INSERT INTO uploads (id, user_id, r2_key, filename, content_type, ext, size, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, user.id, key, filename, ct, ext, len, now, expiresAt).run();
  try { await env.DB.prepare("INSERT INTO upload_events (user_id, created_at) VALUES (?, ?)").bind(user.id, now).run(); } catch (e) { console.error("upload event insert", e); }

  const base = baseUrl(env);
  return json({ ok: true, id, url: base + "/f/" + id + "." + ext, expiresAt, size: len });
}

async function myUploads(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    "SELECT id, filename, content_type, ext, size, created_at, expires_at FROM uploads WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC"
  ).bind(user.id, now).all();
  const base = baseUrl(env);
  const uploads = (res.results || []).map((r) => ({
    id: r.id, url: base + "/f/" + r.id + "." + r.ext, filename: r.filename,
    contentType: r.content_type, size: r.size, createdAt: r.created_at, expiresAt: r.expires_at,
  }));
  return json({ ok: true, uploads });
}

async function deleteUpload(p, request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const id = p.split("/")[3];
  const row = await env.DB.prepare("SELECT r2_key FROM uploads WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (row) {
    if (env.UPLOADS) { try { await env.UPLOADS.delete(row.r2_key); } catch (e) { console.error("r2 delete", e); } }
    await env.DB.prepare("DELETE FROM uploads WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  }
  return json({ ok: true });
}

async function serveUpload(idExt, request, env) {
  const id = String(idExt || "").split("/")[0].split(".")[0];
  if (!id || !env.UPLOADS) return new Response("Not found", { status: 404 });
  const row = await env.DB.prepare("SELECT r2_key, content_type, size, expires_at FROM uploads WHERE id = ?").bind(id).first();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.expires_at < now) return new Response("Not found or expired", { status: 404 });

  const ct = row.content_type || "application/octet-stream";
  const headers = new Headers();
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Disposition", "inline");

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    const mm = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (mm) {
      const total = row.size;
      let start = mm[1] ? parseInt(mm[1], 10) : 0;
      let end = mm[2] ? parseInt(mm[2], 10) : total - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": "bytes */" + total } });
      }
      const length = end - start + 1;
      const obj = await env.UPLOADS.get(row.r2_key, { range: { offset: start, length } });
      if (!obj) return new Response("Not found", { status: 404 });
      headers.set("Content-Range", "bytes " + start + "-" + end + "/" + total);
      headers.set("Content-Length", String(length));
      return new Response(obj.body, { status: 206, headers });
    }
  }

  const obj = await env.UPLOADS.get(row.r2_key);
  if (!obj) return new Response("Not found", { status: 404 });
  headers.set("Content-Length", String(row.size));
  return new Response(obj.body, { status: 200, headers });
}

async function cleanupExpiredUploads(env) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const res = await env.DB.prepare("SELECT id, r2_key FROM uploads WHERE expires_at < ? LIMIT 1000").bind(now).all();
    const rows = res.results || [];
    if (env.UPLOADS) {
      for (const r of rows) { try { await env.UPLOADS.delete(r.r2_key); } catch (e) { console.error("cron r2 delete", e); } }
    }
    if (rows.length) await env.DB.prepare("DELETE FROM uploads WHERE expires_at < ?").bind(now).run();
    try { await ensureUploadEvents(env); await env.DB.prepare("DELETE FROM upload_events WHERE created_at < ?").bind(now - UPLOAD_LIMIT_WINDOW).run(); } catch (e) { console.error("cron event prune", e); }
  } catch (e) { console.error("cleanup", e); }
}

// ---------- owner / admin ----------
function hasBadge(u, name) {
  return String(u?.badges || "").split(",").map((b) => b.trim().toLowerCase()).includes(name);
}
function isOwner(u) { return hasBadge(u, "owner"); }
async function currentOwner(request, env) {
  const u = await currentUser(request, env);
  if (!u || !isOwner(u)) return null;
  return u;
}

let adminSchemaReady = false;
async function ensureAdminSchema(env) {
  if (adminSchemaReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS profile_overrides (user_id TEXT PRIMARY KEY, avatar TEXT, banner TEXT, background TEXT, set_by TEXT, expires_at INTEGER NOT NULL)"
  ).run();
  for (const c of ["last_ip TEXT", "last_ua TEXT", "last_country TEXT", "last_city TEXT", "last_region TEXT", "last_seen_at INTEGER"]) {
    try { await env.DB.prepare("ALTER TABLE users ADD COLUMN " + c).run(); } catch (e) { /* column already exists */ }
  }
  adminSchemaReady = true;
}

async function recordUserMeta(env, userId, request, now) {
  await ensureAdminSchema(env);
  const ip = request.headers.get("CF-Connecting-IP") || null;
  const ua = (request.headers.get("User-Agent") || "").slice(0, 400) || null;
  const cf = request.cf || {};
  await env.DB.prepare(
    "UPDATE users SET last_ip = ?, last_ua = ?, last_country = ?, last_city = ?, last_region = ?, last_seen_at = ? WHERE id = ?"
  ).bind(ip, ua, cf.country || null, cf.city || null, cf.region || null, now, userId).run();
}

// --- temporary profile overrides (the "prank" command) ---
async function getActiveOverride(env, userId) {
  try {
    await ensureAdminSchema(env);
    const now = Math.floor(Date.now() / 1000);
    return (await env.DB.prepare(
      "SELECT avatar, banner, background, expires_at FROM profile_overrides WHERE user_id = ? AND expires_at > ?"
    ).bind(userId, now).first()) || null;
  } catch (e) { console.error("override", e); return null; }
}
function applyOverride(cfg, o) {
  if (o.avatar) cfg.avatar = o.avatar;
  if (o.banner) cfg.banner = o.banner;
  if (o.background) { cfg.theme = cfg.theme || {}; cfg.theme.bgMode = "image"; cfg.theme.bgImage = o.background; }
}

// --- self-serve username change (uniqueness enforced) ---
async function changeUsername(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const { username } = await body(request);
  const u = String(username || "").trim();
  if (!validUsername(u)) return json({ ok: false, error: "invalid_username" }, 400);
  if (!isCleanName(u)) return json({ ok: false, error: "inappropriate_username" }, 400);
  const lower = u.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  if (lower === String(user.username).toLowerCase()) {
    await env.DB.prepare("UPDATE users SET username = ?, updated_at = ? WHERE id = ?").bind(u, now, user.id).run();
    return json({ ok: true, username: u });
  }
  const taken = await env.DB.prepare("SELECT id FROM users WHERE username_lower = ?").bind(lower).first();
  if (taken) return json({ ok: false, error: "username_taken" }, 409);
  await env.DB.prepare("UPDATE users SET username = ?, username_lower = ?, updated_at = ? WHERE id = ?").bind(u, lower, now, user.id).run();
  return json({ ok: true, username: u });
}

async function adminListUsers(request, env) {
  const owner = await currentOwner(request, env);
  if (!owner) return json({ ok: false, error: "forbidden" }, 403);
  await ensureAdminSchema(env);
  const res = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.email_verified, u.badges, u.created_at,
            u.last_ip, u.last_country, u.last_city, u.last_seen_at, p.display_name,
            (SELECT COUNT(*) FROM uploads up WHERE up.user_id = u.id) AS upload_count
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      ORDER BY u.created_at DESC`
  ).all();
  const users = (res.results || []).map((r) => ({
    id: r.id, email: r.email, username: r.username, displayName: r.display_name || "",
    emailVerified: !!r.email_verified, badges: String(r.badges || ""), createdAt: r.created_at,
    lastIp: r.last_ip || null, lastCountry: r.last_country || null, lastCity: r.last_city || null,
    lastSeenAt: r.last_seen_at || null, uploadCount: r.upload_count || 0,
  }));
  return json({ ok: true, users, me: owner.id });
}

async function adminUserRoute(p, request, env) {
  const owner = await currentOwner(request, env);
  if (!owner) return json({ ok: false, error: "forbidden" }, 403);
  const parts = p.split("/").filter(Boolean); // ["api","admin","users",":id",<sub>,<extra>]
  const targetId = parts[3];
  const sub = parts[4] || "";
  const m = request.method;
  if (!targetId) return json({ ok: false, error: "not_found" }, 404);

  if (!sub && m === "GET") return adminUserDetail(targetId, env);
  if (!sub && m === "DELETE") return adminDeleteUser(targetId, owner, env);
  if (!sub && m === "PATCH") return adminUpdateUser(targetId, request, env);
  if (sub === "password" && m === "POST") return adminResetPassword(targetId, env, request);
  if (sub === "wipe" && m === "POST") return adminWipeProfile(targetId, env);
  if (sub === "image" && m === "POST") return adminClearImage(targetId, request, env);
  if (sub === "prank" && m === "POST") return adminPrank(targetId, owner, request, env);
  if (sub === "uploads" && parts[5] && m === "DELETE") return adminDeleteUpload(targetId, parts[5], env);
  return json({ ok: false, error: "not_found" }, 404);
}

async function adminUserDetail(id, env) {
  await ensureAdminSchema(env);
  const u = await env.DB.prepare(
    `SELECT id, email, username, email_verified, badges, created_at, updated_at,
            last_ip, last_ua, last_country, last_city, last_region, last_seen_at
       FROM users WHERE id = ?`
  ).bind(id).first();
  if (!u) return json({ ok: false, error: "not_found" }, 404);
  const prof = await env.DB.prepare("SELECT display_name, bio, config, updated_at FROM profiles WHERE user_id = ?").bind(id).first();
  const now = Math.floor(Date.now() / 1000);
  const ur = await env.DB.prepare("SELECT id, filename, content_type, ext, size, created_at, expires_at FROM uploads WHERE user_id = ? ORDER BY created_at DESC").bind(id).all();
  const base = baseUrl(env);
  const uploads = (ur.results || []).map((r) => ({
    id: r.id, url: base + "/f/" + r.id + "." + r.ext, filename: r.filename, contentType: r.content_type,
    size: r.size, createdAt: r.created_at, expiresAt: r.expires_at, expired: r.expires_at < now,
  }));
  const soc = await env.DB.prepare("SELECT platform, platform_username FROM social_connections WHERE user_id = ?").bind(id).all();
  const socials = (soc.results || []).map((s) => ({ platform: s.platform, username: s.platform_username }));
  const cfg = parseConfig(prof?.config);
  return json({ ok: true, user: {
    id: u.id, email: u.email, username: u.username, emailVerified: !!u.email_verified, badges: String(u.badges || ""),
    createdAt: u.created_at, updatedAt: u.updated_at,
    lastIp: u.last_ip || null, lastUa: u.last_ua || null, lastCountry: u.last_country || null,
    lastCity: u.last_city || null, lastRegion: u.last_region || null, lastSeenAt: u.last_seen_at || null,
    displayName: prof?.display_name || "", bio: prof?.bio || "", layout: cfg.layout || "background",
    avatar: cfg.avatar || null, banner: cfg.banner || null, background: (cfg.theme && cfg.theme.bgImage) || null,
    uploads, socials,
  }});
}

async function adminDeleteUser(id, owner, env) {
  if (id === owner.id) return json({ ok: false, error: "cannot_delete_self" }, 400);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!target) return json({ ok: false, error: "not_found" }, 404);
  if (env.UPLOADS) {
    const ur = await env.DB.prepare("SELECT r2_key FROM uploads WHERE user_id = ?").bind(id).all();
    for (const r of (ur.results || [])) { try { await env.UPLOADS.delete(r.r2_key); } catch (e) { console.error("r2 del", e); } }
  }
  for (const t of ["uploads", "upload_events", "sessions", "social_connections", "oauth_states", "email_verifications", "profile_overrides", "profiles"]) {
    try { await env.DB.prepare("DELETE FROM " + t + " WHERE user_id = ?").bind(id).run(); } catch (e) { /* table may not exist */ }
  }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function adminUpdateUser(id, request, env) {
  const data = await body(request);
  const target = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(id).first();
  if (!target) return json({ ok: false, error: "not_found" }, 404);
  const now = Math.floor(Date.now() / 1000);
  if (typeof data.username === "string" && data.username.trim()) {
    const u = data.username.trim();
    if (!validUsername(u)) return json({ ok: false, error: "invalid_username" }, 400);
    const lower = u.toLowerCase();
    if (lower !== String(target.username).toLowerCase()) {
      const taken = await env.DB.prepare("SELECT id FROM users WHERE username_lower = ? AND id != ?").bind(lower, id).first();
      if (taken) return json({ ok: false, error: "username_taken" }, 409);
    }
    await env.DB.prepare("UPDATE users SET username = ?, username_lower = ?, updated_at = ? WHERE id = ?").bind(u, lower, now, id).run();
  }
  if (typeof data.displayName === "string") {
    const dn = data.displayName.slice(0, 60);
    await env.DB.prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ?").bind(dn, now, id).run();
  }
  return json({ ok: true });
}

async function adminResetPassword(id, env, request) {
  const { password } = await body(request);
  if (!validPassword(password)) return json({ ok: false, error: "weak_password" }, 400);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!target) return json({ ok: false, error: "not_found" }, 404);
  const hash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(hash, now, id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  return json({ ok: true });
}

async function adminWipeProfile(id, env) {
  const target = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(id).first();
  if (!target) return json({ ok: false, error: "not_found" }, 404);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE profiles SET display_name = ?, bio = '', config = '{}', updated_at = ? WHERE user_id = ?").bind(target.username, now, id).run();
  return json({ ok: true });
}

async function adminClearImage(id, request, env) {
  const { which } = await body(request);
  const prof = await env.DB.prepare("SELECT config FROM profiles WHERE user_id = ?").bind(id).first();
  if (!prof) return json({ ok: false, error: "not_found" }, 404);
  const cfg = parseConfig(prof.config);
  if (which === "avatar") delete cfg.avatar;
  else if (which === "banner") delete cfg.banner;
  else if (which === "background") { if (cfg.theme) delete cfg.theme.bgImage; }
  else return json({ ok: false, error: "bad_target" }, 400);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE profiles SET config = ?, updated_at = ? WHERE user_id = ?").bind(JSON.stringify(cfg), now, id).run();
  return json({ ok: true });
}

async function adminDeleteUpload(userId, uploadId, env) {
  const row = await env.DB.prepare("SELECT r2_key FROM uploads WHERE id = ? AND user_id = ?").bind(uploadId, userId).first();
  if (row) {
    if (env.UPLOADS) { try { await env.UPLOADS.delete(row.r2_key); } catch (e) { console.error("r2 delete", e); } }
    await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(uploadId).run();
  }
  return json({ ok: true });
}

async function adminPrank(id, owner, request, env) {
  await ensureAdminSchema(env);
  const data = await body(request);
  const avatar = data.avatar ? String(data.avatar).slice(0, 2000) : null;
  const banner = data.banner ? String(data.banner).slice(0, 2000) : null;
  const background = data.background ? String(data.background).slice(0, 2000) : null;
  let seconds = Number(data.seconds) || 15;
  if (seconds < 1) seconds = 1;
  if (seconds > 300) seconds = 300;
  if (!avatar && !banner && !background) return json({ ok: false, error: "nothing_to_set" }, 400);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!target) return json({ ok: false, error: "not_found" }, 404);
  const now = Math.floor(Date.now() / 1000);
  const expires = now + seconds;
  await env.DB.prepare(
    "INSERT INTO profile_overrides (user_id, avatar, banner, background, set_by, expires_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET avatar=excluded.avatar, banner=excluded.banner, background=excluded.background, set_by=excluded.set_by, expires_at=excluded.expires_at"
  ).bind(id, avatar, banner, background, owner.id, expires).run();
  return json({ ok: true, expiresAt: expires, seconds });
}
