// /api/service-lead: saves one lead from the Services intake form (POST) or says it is alive (GET). See src/edge/service-lead.js.
import { handleLead, leadStatus, CORS } from '../../src/edge/service-lead.js';

export const onRequestPost = (context) => handleLead(context);
export const onRequestGet = (context) => leadStatus(context.env || {});
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
