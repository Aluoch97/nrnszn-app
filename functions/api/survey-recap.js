// /api/survey-recap: runs the daily recap check (POST, needs the secret token) or says it is alive (GET). See src/edge/survey-recap-api.js.
import { handleRecap, recapStatus } from '../../src/edge/survey-recap-api.js';

export const onRequestPost = (context) => handleRecap(context);
export const onRequestGet = (context) => recapStatus(context.env || {});
