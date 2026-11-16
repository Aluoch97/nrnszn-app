// POST /api/hit: counts one page view, without cookies (see src/edge/analytics.js). Always answers 204.
import { recordHit } from '../../src/edge/analytics.js';

export const onRequestPost = (context) => recordHit(context);
