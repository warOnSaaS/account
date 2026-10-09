// An app that signs people in here can have its own name and mark on the sign-in pages and the sign-in email,
// so a person signing in to StreamText sees StreamText, not this service. Keyed by OIDC client id.
// mark: inline SVG for the pages; png: a hosted PNG for email (mail clients do not show SVG).
export const BRANDS = {
  streamtext: {
    name: 'StreamText',
    site: 'https://streamtext.ai',
    mark: '<svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#18181b"/><path d="M16 24h32M16 33h24M16 42h14" stroke="#7dd3fc" stroke-width="5" stroke-linecap="round"/><rect x="34" y="38" width="4.5" height="8" rx="1" fill="#fafafa"/></svg>',
    png: 'https://streamtext.ai/brand/icon-96.png',
  },
};
export const brandFor = (clientId) => (clientId && Object.prototype.hasOwnProperty.call(BRANDS, clientId) ? BRANDS[clientId] : null);
