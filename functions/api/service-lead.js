// /api/service-lead: saves one lead from the Services intake form (POST) or says it is alive (GET). See src/edge/service-lead.js.
// A signed-in visitor's request also shows in Your projects as "Quote requested" (recordRequest in src/edge/accounts.js).
import { handleLead, leadStatus, CORS } from '../../src/edge/service-lead.js';
import { recordRequest } from '../../src/edge/accounts.js';
import { leadEmails, sendMail } from '../../src/edge/client-mail.js';
import { NOTIFY_EMAIL } from '../../src/edge/survey.js';

export async function onRequestPost(context) {
  const text = await context.request.clone().text().catch(() => '');
  const res = await handleLead(context);
  try {
    const j = res.ok ? await res.clone().json() : null;
    if (j && j.success) {
      const env = context.env || {};
      let p = {}; try { p = JSON.parse(text) || {}; } catch { /* the lead is saved either way */ }
      // The client hears "we got your request" and Nick gets the details (src/edge/client-mail.js), after the lead is saved.
      const mails = leadEmails(p);
      const job = Promise.all([recordRequest(context.request, env, text), sendMail(env, p.email, mails.client), sendMail(env, env.LEADS_NOTIFY_EMAIL || NOTIFY_EMAIL, mails.owner)]);
      if (context.waitUntil) context.waitUntil(job); else await job;
    }
  } catch { /* the lead is saved either way */ }
  return res;
}
export const onRequestGet = (context) => leadStatus(context.env || {});
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
