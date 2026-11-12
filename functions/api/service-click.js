// /api/service-click: counts one click on a service card (POST ?id=…; a GET never counts) or says it is alive (GET). See src/edge/service-click.js.
import { handleClick, clickStatus, CORS } from '../../src/edge/service-click.js';

export const onRequestPost = (context) => handleClick(context);
export const onRequestGet = (context) => clickStatus(context.env || {});
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
