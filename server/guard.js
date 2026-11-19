// The server's defences that don't depend on game state: who is asking, how often, and from which site.
import net from 'node:net';

// Scripts only from this origin and no inline code, so injected markup could not run. The Google Fonts entries are for
// the page's one web font.
export const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'none'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com', "img-src 'self' data:", "connect-src 'self'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const unzone = (ip) => String(ip || '').replace(/%.*$/, '');

/** The unit limits apply to: an IPv4 address, or an IPv6 /64 (one customer usually holds a whole /64). */
export function ipKey(value) {
  const ip = unzone(value);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return 'unknown';
  const [left, right] = ip.split('::');
  const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
  const gap = ip.includes('::') ? Array(Math.max(0, 8 - a.length - b.length)).fill('0') : [];
  return `${[...a, ...gap, ...b].slice(0, 4).map((h) => parseInt(h, 16).toString(16)).join(':')}::/64`;
}

const isLoopback = (value) => {
  const ip = unzone(value).replace(/^::ffff:/i, '');
  return ip === '::1' || (net.isIPv4(ip) && ip.startsWith('127.'));
};

/**
 * Who is asking. X-Forwarded-For counts only when the proxy option is on and the connection really comes from a proxy
 * on this machine, and only its last entry: that is the one our proxy wrote, anything before it is client-supplied.
 */
export function clientIp(req, trustProxy) {
  const peer = req.socket.remoteAddress;
  if (trustProxy && isLoopback(peer)) {
    const last = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
    if (net.isIP(unzone(last))) return ipKey(last);
  }
  return ipKey(peer);
}

/** Browsers say where a request came from; refuse the ones another site made. Non-browser clients send neither. */
export function sameSite(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/** Fixed one-minute windows, in a table of bounded size so that many addresses can't exhaust memory. */
export class RateLimiter {
  constructor({ maxEntries = 200_000, now = Date.now } = {}) { this.table = new Map(); this.maxEntries = maxEntries; this.now = now; }
  allow(kind, who, perMinute) {
    const key = `${kind}:${who}`, t = this.now();
    let b = this.table.get(key);
    if (!b || t > b.reset) {
      this.table.delete(key);
      if (this.table.size >= this.maxEntries) this.table.delete(this.table.keys().next().value);
      b = { n: 0, reset: t + 60_000 };
      this.table.set(key, b);
    }
    return ++b.n <= perMinute;
  }
  sweep() { const t = this.now(); for (const [k, b] of this.table) if (t > b.reset) this.table.delete(k); }
}

/** Add to a Map, dropping the oldest entries past `max` (Maps keep insertion order). */
export function putBounded(map, key, value, max) {
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}
