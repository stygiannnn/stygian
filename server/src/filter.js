// Basic inappropriate-content filter for usernames and display names.
// Normalizes common leetspeak, then checks a blocklist. Not exhaustive — extend anytime.
const BLOCKED = [
  "nigger", "nigga", "faggot", "kike", "chink", "tranny", "cunt", "nazi", "hitler",
  "kkk", "beaner", "wetback", "gook", "pedophile", "molest", "retard", "whore",
  "admin", "administrator", "root", "moderator", "official", "support", "system", "staff", "stygian",
];

function normalize(s) {
  return String(s).toLowerCase()
    .replaceAll("@", "a").replaceAll("4", "a")
    .replaceAll("0", "o")
    .replaceAll("1", "i").replaceAll("!", "i").replaceAll("|", "i")
    .replaceAll("3", "e")
    .replaceAll("5", "s").replaceAll("$", "s")
    .replaceAll("7", "t")
    .replace(/[^a-z]/g, "");
}

export function isCleanName(name) {
  const n = normalize(name);
  if (!n) return false;
  return !BLOCKED.some((w) => n.includes(w));
}
