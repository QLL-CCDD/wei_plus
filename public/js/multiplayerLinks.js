// Pure URL helpers shared by room invitations and the ruleset picker.
export function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host);
}

function httpUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; }
  catch { return null; }
}

/** Localhost invites prefer a LAN origin; public / LAN invites keep their original address and port. */
export function shareableInviteLink(code, href, localOrigins = []) {
  const url = httpUrl(href);
  if (!url) return `?room=${encodeURIComponent(code)}`;
  if (isLoopbackHost(url.hostname)) {
    const lan = localOrigins.map(httpUrl).find((candidate) => candidate && !isLoopbackHost(candidate.hostname));
    if (lan) { url.protocol = lan.protocol; url.host = lan.host; }
  }
  url.search = ''; url.hash = ''; url.searchParams.set('room', code);
  return url.href;
}

/** A reverse proxy needs a separately configured public URL, rather than its server's internal port. */
export function alternateRulesetUrl(info, href) {
  const page = httpUrl(href);
  if (!page) return null;
  const configured = httpUrl(info?.alternateUrl);
  if (configured) {
    configured.searchParams.delete('room'); configured.searchParams.delete('join'); configured.hash = '';
    return configured.href;
  }
  const target = Number(info?.alternatePort);
  if (!Number.isInteger(target) || target < 1 || target > 65535) return null;
  const actualPort = Number(page.port || (page.protocol === 'https:' ? 443 : 80));
  if (actualPort !== Number(info?.port)) return null;
  page.port = String(target); page.searchParams.delete('room'); page.searchParams.delete('join'); page.hash = '';
  return page.href;
}
