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
import { sendEmail, sendMail } from "./utils/sendEmail.js";
import { generateMeetingUrl } from "./utils/tools.js";
import { DateTime } from "luxon";
import { Ticket } from "./models/Tickets.js";
import { ensureWhatsAppWebhookSubscription } from './utils/whatsapp-app-bootstrap.js';
const whitelist = ["https://ava-saas.onrender.com","https://www.avakado.ai", "https://api-builder-eight.vercel.app", "https://avakado.ai", "http://localhost:5174", "http://localhost:3000", "https://studio.apollographql.com", "https://app.avakado.ai", "https://api-builder-eight.vercel.app/"];
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
        app.get('/', (_, res) => res.status(200).send('Server running'));
        app.put("/reaction", openCors, async (req, res) => {
            const { messageId, reaction } = req.body;
            // Validation for messageId and reaction
            if (!messageId || !reaction) return res.status(400).json({ message: "Message ID and reaction are required" });
            if (!["neutral", "like", "dislike"].includes(reaction)) return res.status(400).json({ message: "Undefined reaction" });
            try {
                // Assuming messageId is the _id of the document in the database
                const updatedMessage = await Message.findByIdAndUpdate(messageId, { $set: { reaction: reaction } }, { new: true });
                if (!updatedMessage) return res.status(404).json({ message: "Message not found" });
                return res.status(200).json({ success: true, message: "message updated" });
            } catch (err) {
                return res.status(500).json({ message: "An error occurred", error: err.message });
            }
        });
        app.post('/send-invite', openCors, async (req, res) => {
            try {
                const { meetingDetails = {}, attendees = [], organizerDetails = {}, sender = "AVA" } = req.body;
                // attendees must be an array of senders
                if (!Array.isArray(attendees) || attendees.length === 0) return res.status(400).json({ error: 'Attendees must be a non-empty array' });
                let { subject = 'Appointment Schedule Invitation', text, html, event = 'Appointment Invitation', start, end, timezone, summary = "Meeting Invitation", description = "You are invited to a meeting.", location = "Online", url = generateMeetingUrl("Invitation") } = meetingDetails
                if (!start || !end) return res.status(400).json({ error: 'Start and end time are required.' });
                const calendar = ical({ name: event });
                calendar.method(ICalCalendarMethod.REQUEST);
                if (sender === "AVA") {
                    calendar.createEvent({ start: new Date(start), end: new Date(end), timezone: timezone || DateTime.fromISO(new Date(start), { setZone: true }).zoneName, organizer: { name: "AVA", email: process.env.EMAIL_SMTP_AUTH }, summary, description, location, url, attendees: attendees.map(email => ({ email, name: email.split('@')[0], rsvp: true, partstat: 'NEEDS-ACTION', role: 'REQ-PARTICIPANT' })) });
                    sendMail({ to: attendees.join(" "), subject, text, html, attachments: [{ filename: 'invite.ics', content: calendar.toString(), contentType: 'text/calendar' }] });
                    return res.json({ success: true, message: 'Appointment Scheduled Successfully you will get email shorty to your inbox' });
                }
                let { host, port, secure, user, pass, name, bcc, cc, service, clientId, clientSecret, refreshToken } = organizerDetails
                if (!host || !port || !user || !pass) return res.status(400).json({ error: 'SMTP details are missing or invalid' });
                calendar.createEvent({ start: new Date(start), end: new Date(end), timezone: timezone || DateTime.fromISO(new Date(start), { setZone: true }).zoneName, organizer: { name, email: user }, summary, description, location, url, attendees: attendees.map(email => ({ email, name: email.split('@')[0], rsvp: true, partstat: 'NEEDS-ACTION', role: 'REQ-PARTICIPANT' })) });
                sendEmail({ config: { host, port, secure, auth: { user, pass } }, emailData: { from: `${name} <${user}>`, to: attendees.join(" "), cc, bcc, subject, text, html, attachments: [{ filename: 'invite.ics', content: calendar.toString(), contentType: 'text/calendar' }] } })
                res.status(200).json({ success: true, message: 'Appointment Scheduled Successfully you will get email shorty to your inbox' });
            } catch (error) {
                console.error(error);
                return res.status(500).json({ error: error.message })
            }
        });
        app.post('/send-mail', openCors, async (req, res) => {
            try {
                const { to, subject, text, html, attachments = [] } = req.body;
                if (!to || !subject || !text) return res.status(400).json({ error: 'To, subject and text are required' });
                const emailResp = await sendMail({ to, subject, text, html, attachments });
                return res.json({ success: true, message: 'Email sent successfully', data: emailResp });
            } catch (error) {
                console.error(error);
                return res.status(500).json({ success: false, error: error.message, message: 'Internal server error' });
            }
        });
        app.post('/contact-us', openCors, async (req, res) => {
            try {
                const { name, contactDetails, purpose } = req.body;
                if (!name || !contactDetails || !purpose) return res.status(400).json({ error: 'Missing required fields' });
                const { email, phone } = contactDetails;
                if (!email && !phone) return res.status(400).json({ error: 'At least one contact detail (email or phone) is required' });
                const subject = `New Contact Request from ${name}`;
                const text = ` New contact form submission:
                        Name: ${name}
                        Email: ${email || 'N/A'}
                        Phone: ${phone || 'N/A'}
                        Purpose: ${purpose}`.trim();
                const html = `
            <h2>New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email || 'N/A'}</p>
            <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
            <p><strong>Purpose:</strong><br>${purpose}</p>
        `;
                Promise.all([
                    // await Lead.create({ name, purpose, contactDetails: { email: email || null, phone: phone || null } }),
                    await sendMail({ to: "ankit@onewindow.co anurag@onewindow.co vishnu.teja101.vt@gmail.com", subject, text, html })
                ]);
                return res.json({ success: true, message: 'we will get back to you soon', data: null });
            } catch (error) {
                console.error(error);
                return res.status(500).json({ success: false, error: error.message, message: 'Internal server error' });
            }
        })
        app.post("/raise-ticket", openCors, async (req, res) => {
            try {
                const { business, issueSummary, channel, priority, contactDetails, notifierEmail } = req.body;
                await Ticket.create({ business, issueSummary, channel, priority, contactDetails, notifierEmail });
                return res.status(201).json({ message: "ticket raised successfully" });
            } catch (err) {
                console.error(err);
                res.status(400).json({ error: err.message });
            }
        })
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
