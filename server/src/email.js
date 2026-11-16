// Pluggable email sender. No provider is wired yet, so in dev mode it logs the
// code (visible in Worker logs). When ready, set EMAIL_PROVIDER + its API key.
export async function sendVerificationEmail(env, to, code) {
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "stygian <noreply@stygian.wtf>",
        to,
        subject: "Your stygian verification code",
        text: `Your stygian verification code is ${code}. It expires in 15 minutes.`,
      }),
    });
    return { ok: res.ok, provider: "resend" };
  }
  // Dev fallback — code shows in Worker logs (dashboard > Observability/Logs).
  console.log(`[email:dev] verification code for ${to}: ${code}`);
  return { ok: true, dev: true };
}
