// OAuth providers for social stat connections (TikTok, Pinterest, Twitter/X).
// Each provider: configured(env), authorize(env,state,redirect,challenge),
// exchange(env,code,redirect,verifier)->token json, refresh(env,refreshToken)->token json,
// stats(accessToken)-> { username, followers, likes, following, verified, ... }

function b64url(buf) {
  let str = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function pkceChallenge(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(d);
}

export const PLATFORMS = {
  tiktok: {
    pkce: false,
    scopes: "user.info.basic,user.info.profile,user.info.stats",
    configured(env) { return !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET); },
    authorize(env, state, redirect) {
      const p = new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY, scope: this.scopes,
        response_type: "code", redirect_uri: redirect, state,
      });
      return "https://www.tiktok.com/v2/auth/authorize/?" + p.toString();
    },
    async exchange(env, code, redirect) {
      const body = new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET,
        code, grant_type: "authorization_code", redirect_uri: redirect,
      });
      const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      return r.json();
    },
    async refresh(env, refreshToken) {
      const body = new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token", refresh_token: refreshToken,
      });
      const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      return r.json();
    },
    async stats(accessToken) {
      const fields = "open_id,username,display_name,is_verified,follower_count,following_count,likes_count,video_count";
      const r = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=" + encodeURIComponent(fields), {
        headers: { Authorization: "Bearer " + accessToken },
      });
      const d = await r.json();
      const u = (d && d.data && d.data.user) || {};
      return {
        username: u.username || "", followers: u.follower_count ?? null,
        likes: u.likes_count ?? null, following: u.following_count ?? null,
        videos: u.video_count ?? null, verified: !!u.is_verified,
      };
    },
  },

  pinterest: {
    pkce: true,
    scopes: "user_accounts:read",
    configured(env) { return !!(env.PINTEREST_CLIENT_ID && env.PINTEREST_CLIENT_SECRET); },
    authorize(env, state, redirect, challenge) {
      const p = new URLSearchParams({
        client_id: env.PINTEREST_CLIENT_ID, redirect_uri: redirect,
        response_type: "code", scope: this.scopes, state,
        code_challenge: challenge, code_challenge_method: "S256",
      });
      return "https://www.pinterest.com/oauth/?" + p.toString();
    },
    async exchange(env, code, redirect, verifier) {
      const basic = btoa(env.PINTEREST_CLIENT_ID + ":" + env.PINTEREST_CLIENT_SECRET);
      const body = new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier || "",
      });
      const r = await fetch("https://api.pinterest.com/v5/oauth/token", {
        method: "POST", headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      return r.json();
    },
    async refresh(env, refreshToken) {
      const basic = btoa(env.PINTEREST_CLIENT_ID + ":" + env.PINTEREST_CLIENT_SECRET);
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
      const r = await fetch("https://api.pinterest.com/v5/oauth/token", {
        method: "POST", headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      return r.json();
    },
    async stats(accessToken) {
      const r = await fetch("https://api.pinterest.com/v5/user_account", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      const d = await r.json();
      return {
        username: d.username || "", followers: d.follower_count ?? null,
        following: d.following_count ?? null, pins: d.pin_count ?? null,
        boards: d.board_count ?? null, verified: false,
      };
    },
  },

  twitter: {
    pkce: true,
    scopes: "users.read tweet.read offline.access",
    configured(env) { return !!env.TWITTER_CLIENT_ID; },
    authorize(env, state, redirect, challenge) {
      const p = new URLSearchParams({
        response_type: "code", client_id: env.TWITTER_CLIENT_ID, redirect_uri: redirect,
        scope: this.scopes, state, code_challenge: challenge, code_challenge_method: "S256",
      });
      return "https://twitter.com/i/oauth2/authorize?" + p.toString();
    },
    _headers(env) {
      const h = { "Content-Type": "application/x-www-form-urlencoded" };
      if (env.TWITTER_CLIENT_SECRET) h["Authorization"] = "Basic " + btoa(env.TWITTER_CLIENT_ID + ":" + env.TWITTER_CLIENT_SECRET);
      return h;
    },
    async exchange(env, code, redirect, verifier) {
      const body = new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: redirect,
        code_verifier: verifier || "", client_id: env.TWITTER_CLIENT_ID,
      });
      const r = await fetch("https://api.twitter.com/2/oauth2/token", { method: "POST", headers: this._headers(env), body });
      return r.json();
    },
    async refresh(env, refreshToken) {
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: env.TWITTER_CLIENT_ID });
      const r = await fetch("https://api.twitter.com/2/oauth2/token", { method: "POST", headers: this._headers(env), body });
      return r.json();
    },
    async stats(accessToken) {
      const r = await fetch("https://api.twitter.com/2/users/me?user.fields=public_metrics,verified,verified_type,username", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      const d = await r.json();
      const u = (d && d.data) || {};
      return {
        username: u.username || "", followers: u.public_metrics?.followers_count ?? null,
        likes: null, following: u.public_metrics?.following_count ?? null,
        verified: !!u.verified, verifiedType: u.verified_type || null,
      };
    },
  },
};
