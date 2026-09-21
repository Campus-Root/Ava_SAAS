
import { Kafka, logLevel } from 'kafkajs'

export function kafkaBrokers(env = process.env) {
    const raw = env.KAFKA_BROKERS;
    if (!raw || !String(raw).trim()) throw new Error('KAFKA_BROKERS environment variable is not set');
    const brokers = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (!brokers.length) throw new Error('KAFKA_BROKERS environment variable is not set');
    return brokers;
}

export function toKafkaBatch({ message, messages }) {
    return messages ?? (message ? [message] : [])
}

export async function sendKafkaMessage({ topic, message, messages, acks = -1, }) {
    const kafka = new Kafka({ clientId: 'avakado-producer', brokers: kafkaBrokers(), logLevel: logLevel.ERROR })
    const producer = kafka.producer()
    const batch = toKafkaBatch({ message, messages })
    try {
        await producer.connect()
        await producer.send({ topic, messages: batch, acks })
    } catch (error) {
        console.error('Error sending Kafka message:', error)
    } finally {
        await producer.disconnect()
    }
}