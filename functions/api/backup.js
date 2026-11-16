// /api/backup: runs the daily sheet backup (POST, needs the secret token) or says whether it is set up and when the last one ran (GET). See src/edge/backup.js.
import { handleBackup, backupStatus } from '../../src/edge/backup.js';

export const onRequestPost = (context) => handleBackup(context);
export const onRequestGet = (context) => backupStatus(context.env || {});
