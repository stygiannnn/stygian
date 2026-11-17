import { hashPassword, verifyPassword, sha256Hex, randomToken, randomCode, uuid } from "./crypto.js";
import { sendVerificationEmail } from "./email.js";
import { isDisposableEmail } from "./disposable.js";
import { isCleanName } from "./filter.js";
import { PLATFORMS, pkceChallenge } from "./oauth.js";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days (seconds)
const CODE_TTL = 60 * 15; // 15 minutes (seconds)
const MAX_CODE_ATTEMPTS = 5;
const MAX_CONFIG_BYTES = 20000;

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
    return env.ASSETS.fetch(request);
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
async function createSession(env, userId) {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, now, now + SESSION_TTL).run();
  return token;
}
async function currentUser(request, env) {
  const token = getCookie(request, "sid");
  if (!token) return null;
  const id = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  return await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.email_verified
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  ).bind(id, now).first();
}
function publicUser(u) {
  return { id: u.id, email: u.email, username: u.username, emailVerified: !!u.email_verified };
}

// ---------- auth ----------
async function signup(request, env) {
  const { email, username, displayName, password } = await body(request);
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
  const token = await createSession(env, user.id);
  const fresh = await env.DB.prepare("SELECT id, email, username, email_verified FROM users WHERE id = ?").bind(user.id).first();
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
    "SELECT id, email, username, password_hash, email_verified FROM users WHERE email = ? OR username_lower = ?"
  ).bind(id.toLowerCase(), id.toLowerCase()).first();
  if (!user) return json({ ok: false, error: "invalid_credentials" }, 401);
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return json({ ok: false, error: "invalid_credentials" }, 401);
  if (!user.email_verified) {
    await issueCode(env, user.id, user.email);
    return json({ ok: false, error: "not_verified", email: user.email }, 403);
  }
  const token = await createSession(env, user.id);
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
    `SELECT u.id AS uid, u.username, p.display_name, p.bio, p.config
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.username_lower = ? AND u.email_verified = 1`
  ).bind(u).first();
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  const socials = await loadPublicSocials(env, row.uid);
  return json({ ok: true, profile: {
    username: row.username, displayName: row.display_name, bio: row.bio, config: parseConfig(row.config), socials,
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
  const configStr = JSON.stringify(data.config ?? {});
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
