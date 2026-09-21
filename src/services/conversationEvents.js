export function conversationStatusKafka({ conversationId, businessId, status }) {
    const events = [{
        topic: 'socket-event',
        key: conversationId,
        value: { event: 'conversation.statusUpdated', payload: { conversationId, status }, nameSpace: 'CONVERSATION', roomId: String(businessId || '') },
    }];
    if (status === 'completed') {
        events.push({
            topic: 'agentic-data-summarisation',
            key: 'conversationStatusUpdated',
            value: { conversationId },
        });
    }
    return events;
}

export function workflowTriggerMessages(trigger, conversationId) {
    return (trigger?.workflows ?? []).map((workflowId) => ({
        topic: 'workflow-execution-trigger',
        key: String(workflowId),
        value: { conversationId },
    }));
}

export function humanHandoffSet({
    handoffReason = 'Lead explicitly asked for a human agent',
    handoffUrgency = 'normal',
    assignedTo = 'human',
    now = new Date(),
} = {}) {
    return {
        status: 'pending',
        'config.assignment': {
            agentReply: false,
            handoffReason,
            handoffUrgency,
            assignedAt: now,
            assignedTo,
        },
    };
}

export function humanHandoffSocketValue(conversation) {
    return {
        event: 'conversation.humanHandoff',
        payload: {
            conversationId: conversation._id,
            status: conversation.status,
            assignment: conversation.config?.assignment,
        },
        nameSpace: 'CONVERSATION',
        roomId: String(conversation.business?._id ?? conversation.business ?? ''),
    };
}
