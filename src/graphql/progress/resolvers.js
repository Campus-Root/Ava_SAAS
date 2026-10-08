import { validateBulkCreateLeadsStream, bulkCreateLeadsStream } from '../leads/subscriptions.js';
import { validateCampaignStream, createCampaignStream } from '../campaigns/subscriptions.js';

export const progressResolvers = {
  ProgressFeed: {
    validateBulkCreateLeadsProgress: { subscribe: validateBulkCreateLeadsStream },
    bulkCreateLeadsProgress: { subscribe: bulkCreateLeadsStream },
    validateCampaignProgress: { subscribe: validateCampaignStream },
    createCampaignProgress: { subscribe: createCampaignStream },
  },
};
