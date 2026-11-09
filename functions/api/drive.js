// /api/drive?id=<Drive file id>&sz=w500: Gallery photos, cached at Cloudflare (see src/edge/feeds.js).
import { serveDrive } from '../../src/edge/feeds.js';

export const onRequestGet = (context) => serveDrive(context);
