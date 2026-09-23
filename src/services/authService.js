import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import 'dotenv/config'
import { User } from '@avakado.ai/schemas';
const { ACCESS_SECRET } = process.env
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { GraphQLError } from 'graphql';
import { Log } from '@avakado.ai/schemas';
import { Business } from "@avakado.ai/schemas";
import { fireAndForgetAxios } from "../utils/fireAndForget.js";
import { clearRefreshCookie, clearSsoCookie } from "../utils/authCookies.js";
import { requestPasswordReset as issuePasswordReset, resetPassword as consumePasswordReset } from "./passwordReset.js";
import {
    authenticatePassword,
    issueDashboardTokens,
    verifyAccessJwt,
    revokeRefreshFamily,
    findActiveClient,
    clientIdFromUserId,
    issueTokenSet,
    ensureDashboardClient,
} from "./oauthService.js";

class AuthService {
    generateTokens(userId, expiresIn = '1h') {
        const newAccessToken = jwt.sign({ id: userId }, ACCESS_SECRET, { expiresIn });
        return { newAccessToken };
    }
    async verifyAccessToken(accessToken) {
        return verifyAccessJwt(accessToken);
    }
    async verifyTokens(accessToken) {
        try {
            return await verifyAccessJwt(accessToken);
        } catch (error) {
            console.error('Token verification error:', error);
            return { success: false, message: 'Error verifying tokens', data: { decoded: null } };
        }
    }
    async verifyDecodedToken(decoded) {
        if (!decoded || !decoded.id) throw new GraphQLError('Invalid decoded token payload', { extensions: { code: 'UNAUTHENTICATED' } });
        const user = await User.findById(decoded.id).select("-password");
        if (!user || !user._id) throw new GraphQLError('Invalid decoded token payload', { extensions: { code: 'UNAUTHENTICATED' } });
        return { success: true, message: "Valid Decoded Token", data: user };
    }
    async login(email, password, ipAddress, userAgent) {
        const { user, userResponse } = await authenticatePassword(email, password);
        const tokens = await issueDashboardTokens(user);
        await Log.create({ user: user._id, business: user.business, level: 'info', event: 'login', category: 'AUTHENTICATION', status: 'SUCCESS', message: 'Login successful', service: 'auth', meta: { ipAddress, userAgent } });
        return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in, user: userResponse };
    }

    async register(user, ipAddress, userAgent) {
        const { name, email, password, BusinessName, logoURL="" } = user;
        if (!name || !email || !password || !BusinessName) {
            throw new GraphQLError("Missing required fields", { extensions: { code: "MISSING_FIELDS" } });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const emailToken = crypto.randomBytes(7).toString("hex");
        let userDoc;

        await mongoose.connection.transaction(async (session) => {
            const existingBusiness = await Business.findOne({ name: BusinessName }).session(session);
            if (existingBusiness) {
                throw new GraphQLError("Business already exists", { extensions: { code: "BUSINESS_ALREADY_EXISTS" } });
            }

            const existingUser = await User.findOne({ email }).session(session);
            if (existingUser) {
                throw new GraphQLError("Email already exists", { extensions: { code: "EMAIL_ALREADY_EXISTS" } });
            }

            const [business] = await Business.create([{ name: BusinessName, logoURL }], { session });
            const [createdUser] = await User.create([{
                name,
                email,
                password: hashedPassword,
                role: "admin",
                isVerified: false,
                emailToken,
            }], { session });

            business.createdBy = createdUser._id;
            createdUser.business = business._id;

            await business.save({ session });
            await createdUser.save({ session });
            await Log.create([{
                user: createdUser._id,
                business: business._id,
                level: "info",
                event: "email verification",
                category: "AUTHENTICATION",
                status: "SUCCESS",
                message: "Email verification sent",
                service: "auth",
                meta: { ipAddress, userAgent },
            }], { session });

            userDoc = createdUser;
        });

        this.sendRegistrationEmails(userDoc);
        return { success: true, message: "Registration successful. Verification email sent." };
    }

    sendRegistrationEmails(user) {
        fireAndForgetAxios("POST", `${process.env.WEBHOOKS_URL}aux/trigger-email`, {
            mode: "SYSTEM",
            config: { to: user.email },
            body: {
                template: "emailVerification",
                data: {
                    subject: "[AVA] Click this link to confirm your email address",
                    url: `${process.env.WEBHOOKS_URL}aux/verification?service=email&code=${user.emailToken}&email=${user.email}`,
                    name: user.name
                }
            }
        });
    }

    async issueAccessForUser(user) {
        const own = await findActiveClient(clientIdFromUserId(user._id));
        if (own) return issueTokenSet(user, own);
        const dashboard = await ensureDashboardClient();
        return issueTokenSet(user, {
            clientId: dashboard.clientId,
            secretVersion: dashboard.secretVersion,
            grantMode: "access_only",
        });
    }

    async logout(res, user) {
        if (user?._id) await revokeRefreshFamily({ userId: user._id });
        clearRefreshCookie(res);
        clearSsoCookie(res);
        return true;
    }
    requestPasswordReset(email) {
        return issuePasswordReset(User, email);
    }
    async resetPassword({ token, email, password }) {
        const result = await consumePasswordReset(User, { token, email, password });
        const user = await User.findOne({ email });
        if (user) await revokeRefreshFamily({ userId: user._id });
        return result;
    }
    verifyEmail(user) { }
    verifyPhone(user) { }
    verifyOTP(user) { }
    verifyEmailOTP(user) { }
    verifyPhoneOTP(user) { }
}
export default new AuthService();
