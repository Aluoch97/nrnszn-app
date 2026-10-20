// The Services page talks to its own Apps Script backend (the same one the
// Wix widget used). It's a separate script from PUBLIC_API_URL because it's
// bound to the Services sheet and also handles Calendar booking, Gmail
// confirmations, auto-invoicing and the Fathom webhook.
//
// If you redeploy that script as a NEW deployment, its URL changes: update
// it here. Redeploying as a new version of the existing deployment keeps it.
export const SERVICES_API_URL =
  'https://script.google.com/macros/s/AKfycby9JJPeqlNedlwfec3uMWYF7btoCGJUJB8CJnTmbWxfByhtuO23eCARYziNqdeqT3tfFQ/exec';
