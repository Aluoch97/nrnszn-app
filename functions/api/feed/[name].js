// /api/feed/services | cinema | gallery | latest: cached copies of the read-only Google feeds (see src/edge/feeds.js).
import { serveFeed } from '../../../src/edge/feeds.js';

export const onRequestGet = (context) => serveFeed(String(context.params.name || ''), context);
