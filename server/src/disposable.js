// Common disposable / temporary email domains. Not exhaustive — extend anytime.
const DISPOSABLE = new Set([
  "mailinator.com","guerrillamail.com","10minutemail.com","tempmail.com","temp-mail.org",
  "throwawaymail.com","yopmail.com","getnada.com","maildrop.cc","dispostable.com",
  "trashmail.com","fakeinbox.com","sharklasers.com","guerrillamailblock.com","grr.la",
  "spam4.me","mailnesia.com","mintemail.com","mytemp.email","moakt.com",
  "emailondeck.com","tempinbox.com","tempmailo.com","mohmal.com","inboxkitten.com",
  "mailcatch.com","tmpmail.org","tmpmail.net","1secmail.com","1secmail.org",
  "burnermail.io","mailpoof.com","harakirimail.com","nowmymail.com","spambox.us",
  "mvrht.net","tempr.email","discard.email","33mail.com","anonbox.net"
]);

export function isDisposableEmail(email) {
  const domain = String(email).split("@")[1]?.toLowerCase();
  return domain ? DISPOSABLE.has(domain) : false;
}
