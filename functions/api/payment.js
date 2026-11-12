// /api/payment: logs a click on a payment button (POST) or says it is alive (GET). See src/edge/payments.js.
import { handlePayment, paymentStatus, CORS } from '../../src/edge/payments.js';

export const onRequestPost = (context) => handlePayment(context);
export const onRequestGet = (context) => paymentStatus(context.env || {});
// The widget may be embedded on another site; its click is a plain "no-cors" POST, so this is only for completeness.
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
