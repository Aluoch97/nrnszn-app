// /api/survey: takes a survey response (POST), shows the unsubscribe page (GET ?unsub=1) or says it is alive (GET). See src/edge/survey-api.js.
import { handleSurvey, handleUnsubscribe, surveyStatus, CORS } from '../../src/edge/survey-api.js';

export const onRequestPost = (context) => handleSurvey(context);
export const onRequestGet = (context) => (new URL(context.request.url).searchParams.get('unsub') === '1' ? handleUnsubscribe(context) : surveyStatus(context.env || {}));
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
