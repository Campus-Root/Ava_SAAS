import mongoose from "mongoose";
import { configureSchemas } from "@avakado.ai/schemas";
import { sendKafkaMessage } from "./kafka.js";
import { PROVIDER_MAP, providerSupportsRefresh } from "./setup.js";
// import { createClient } from 'redis';
import 'dotenv/config'

configureSchemas({
    sendKafkaMessage,
    getAuthProvider: (name) => PROVIDER_MAP[name],
    providerSupportsRefresh,
});
export const connectDB = async (retryCount = 0) => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI environment variable is not set');
    try {
        if (mongoose.connection.readyState === 1) return; // already connected
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
    } catch (err) {
        if (retryCount < 5) {  // Set a maximum number of retries
            console.error('Error connecting to MongoDB. Retrying...', err);
            setTimeout(() => connectDB(retryCount + 1), 5000); // Retry after 5 seconds
        } else {
            console.error('Failed to connect to MongoDB after multiple attempts:', err);
            process.exit(1);  // Exit the process after max retries
        }
    }
};
// export let redisClient;

// export const connectRedis = async () => {
//     if (redisClient) return redisClient
//     try {
//         redisClient = createClient({
//             socket: {
//                 host: process.env.REDIS_HOST,
//                 port: parseInt(process.env.REDIS_PORT),
//             },
//             username: process.env.REDIS_USERNAME,
//             password: process.env.REDIS_PASSWORD,
//             database: parseInt(process.env.REDIS_DATABASE)
//         });
//         // Error handling
//         redisClient.on('error', (err) => console.error('Redis Client Error:', err));
//         redisClient.on('connect', () => console.log('Connected to Redis'));
//         redisClient.on('ready', () => console.log('Redis client ready'));
//         redisClient.on('end', () => console.log('Redis connection ended'));
//         await redisClient.connect();
//         return redisClient;
//     } catch (err) {
//         console.error('Error connecting to Redis:', err);
//     }
// };

// export const getRedisClient = async () => {
//     if (!redisClient) await connectRedis();
//     return redisClient;
// };

export const initialize = async () => {
    try {
        await Promise.all([
            connectDB(),
            // connectRedis()
        ])
        console.log('Application initialized successfully');
    } catch (err) {
        console.error('Error during initialization:', err);
        process.exit(1); // Exit the process if initialization fails
    }
};

export const closeConnections = async () => {
    try {
        // if (redisClient) {
        //     await redisClient.quit();
        //     console.log('Redis connection closed');
        // }
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
            console.log('MongoDB connection closed');
        }
    } catch (error) {
        console.error('Error closing connections:', error);
    }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, closing connections...');
    await closeConnections();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, closing connections...');
    await closeConnections();
    process.exit(0);
});