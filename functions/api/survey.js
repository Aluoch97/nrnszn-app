// /api/survey: takes a survey response (POST) or says it is alive (GET). See src/edge/survey-api.js.
import { handleSurvey, surveyStatus, CORS } from '../../src/edge/survey-api.js';

export const onRequestPost = (context) => handleSurvey(context);
export const onRequestGet = (context) => surveyStatus(context.env || {});
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
