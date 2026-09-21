export function campaignCronJobSpec(campaign, scheduledAt) {
    return {
        id: String(campaign._id),
        name: campaign.name,
        scheduleType: 'once',
        runAt: scheduledAt,
        type: 'http',
        url: `https://chat.avakado.ai/aux/trigger/${campaign._id}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        params: {},
        body: {},
        enabled: true,
        miscIds: {},
    };
}

export function nextCampaignTrigger({ campaign, pendingTask } = {}) {
    if (!campaign) return { ok: false, status: 404, message: 'Campaign not found' };
    if (campaign.cancel_requested) {
        return { ok: true, skipRemaining: true, message: 'Campaign cancel requested; pending tasks skipped' };
    }
    if (pendingTask) {
        return {
            ok: true,
            kafka: {
                topic: 'task-trigger',
                key: String(pendingTask._id),
                value: { taskId: String(pendingTask._id), campaignId: String(campaign._id) },
            },
        };
    }
    return {
        ok: true,
        complete: true,
        kafka: {
            topic: 'socket-event',
            key: String(campaign._id),
            value: {
                event: 'campaign.completed',
                payload: { id: campaign._id, name: campaign.name },
                nameSpace: 'CAMPAIGN',
                roomId: String(campaign.business),
            },
        },
    };
}

export function shouldAdvanceCampaign(conversation) {
    return Boolean(conversation?.campaign);
}
