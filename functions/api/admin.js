// /api/admin: the owner's sign-in and the owner-only facts behind the /admin page. See src/edge/admin.js.
import { adminGet, adminPost } from '../../src/edge/admin.js';

export const onRequestGet = (context) => adminGet(context);
export const onRequestPost = (context) => adminPost(context);
