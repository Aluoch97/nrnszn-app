// /api/hero: the page header videos (see src/edge/hero.js).
import { heroRequest } from '../../src/edge/hero.js';

export const onRequest = (context) => heroRequest(context);
