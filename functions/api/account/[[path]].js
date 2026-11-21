// /api/account/*: the one NuRenaissance account for every app (see src/edge/accounts.js for how it works).
import { accountRequest } from '../../../src/edge/accounts.js';

export const onRequest = (context) => accountRequest(context);
