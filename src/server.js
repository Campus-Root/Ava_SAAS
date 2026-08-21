import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import { initialize } from "./utils/dbConnect.js";
import errorHandlerMiddleware from './middleware/errorHandler.js';
import { registerApollo } from './graphql/index.js';
import sanitize from 'mongo-sanitize';
import 'dotenv/config'
// weighted imports
import { Message } from "./models/Messages.js";
import ical, { ICalCalendarMethod } from 'ical-generator';
import { generateMeetingUrl } from "./utils/tools.js";
import { DateTime } from "luxon";
import { Ticket } from "./models/Tickets.js";
import { ensureWhatsAppWebhookSubscription } from './utils/whatsapp-app-bootstrap.js';
import { builtInRoutes } from './controller/index.js';
const whitelist = ["https://ava-saas.onrender.com", "https://www.avakado.ai", "https://api-builder-eight.vercel.app", "https://avakado.ai", "http://localhost:5174", "http://localhost:3000", "https://studio.apollographql.com", "https://app.avakado.ai", "https://api-builder-eight.vercel.app/"];
export const corsOptions = {
    origin: (origin, callback) => (!origin || whitelist.indexOf(origin) !== -1) ? callback(null, true) : callback(new Error('Not allowed by CORS')),
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        "Cache-Control",   // ✅ allow cache control header
        "Pragma",           // ✅ allow pragma header
        "apollo-require-preflight",
        "x-apollo-operation-name",
    ],
    credentials: true,
    optionsSuccessStatus: 200,
    preflightContinue: false
};
export const openCors = cors(corsOptions);
export const createApp = async () => {
    try {
        await initialize();
        const app = express();
        const server = http.createServer(app);
        // Middleware
        app.set('trust proxy', 1);
        app.use(cors(corsOptions))
        app.use(helmet({
            contentSecurityPolicy: false, // Temporarily disable CSP
            frameguard: { action: 'sameorigin' },
            noSniff: true,
            referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
            permittedCrossDomainPolicies: { permittedPolicies: 'none' },
            crossOriginResourcePolicy: { policy: 'cross-origin' }, // Add this line
            crossOriginOpenerPolicy: false, // Add this line
            crossOriginEmbedderPolicy: false // Add this line
        }));
        app.use(cookieParser());
        app.use(morgan(':date[web] :method :url :status - :response-time ms'));
        app.use(express.json({ type: ["application/json", "text/plain"], limit: '50mb' }));
        // Apollo setup
        try {
            await registerApollo(app, server);
        } catch (error) {
            console.error("error with Apollo setup", error);
            throw error;
        }
        app.use((req, res, next) => {
            req.body = sanitize(req.body);
            req.params = sanitize(req.params);
            if (JSON.stringify(req.query) !== JSON.stringify(sanitize(req.query))) return res.status(400).json({ error: 'Invalid query parameters detected', message: 'Query contains potentially malicious content' });
            next();
        });
        app.use(express.urlencoded({ limit: '50mb', extended: true }));
        app.use(bodyParser.urlencoded({ extended: true }));
        // Routes
        const allowAllCors = cors({
            origin: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true
        });
        app.use('/', allowAllCors, builtInRoutes);
        // Error handling
        try {
            app.use(errorHandlerMiddleware);
        } catch (error) {
            console.error("error with Error handling", error);
            throw error;
        }
        try {
            app.use("/{*splat}", (_, res) => res.status(404).send("Route does not exist"))
        } catch (error) {
            console.error("error with Route does not exist", error);
            throw error;
        }
        try {
            await ensureWhatsAppWebhookSubscription();
        } catch (error) {
            console.error("error with WhatsApp webhook subscription", error);
            throw error;
        }
        return { app, server };
    } catch (error) {
        console.error("failed to start server", error);
        throw error;
    }
};
