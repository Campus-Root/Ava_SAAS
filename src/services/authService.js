import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import 'dotenv/config'
import { User } from '@avakado.ai/schemas';
const { ACCESS_SECRET, REFRESH_SECRET } = process.env
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { GraphQLError } from 'graphql';
import { Log } from '@avakado.ai/schemas';
import { Business } from "@avakado.ai/schemas";
import { fireAndForgetAxios } from "../utils/fireAndForget.js";
import { clearRefreshCookie } from "../utils/authCookies.js";
import { requestPasswordReset as issuePasswordReset, resetPassword as consumePasswordReset } from "./passwordReset.js";
class AuthService {
    generateTokens(userId, expiresIn = '30d') {
        const newAccessToken = jwt.sign({ id: userId }, ACCESS_SECRET, { expiresIn: expiresIn });
        const newRefreshToken = jwt.sign({ id: userId }, REFRESH_SECRET, { expiresIn: expiresIn });
        return { newAccessToken, newRefreshToken };
    }
    verifyAccessToken(accessToken) {
        if (!accessToken) return { success: false, message: 'No access token provided', data: { decoded: null } };
        try {
            const decoded = jwt.verify(accessToken, ACCESS_SECRET);
            if (!decoded || !decoded.id) return { success: false, message: 'Invalid access token payload', data: { decoded: null } };
            return { success: true, message: "Valid Access Token", data: { decoded } };
        } catch (error) {
            const message = error.name === 'JsonWebTokenError' ? 'Invalid access token' : error.name === 'TokenExpiredError' ? 'jwt expired' : error.message;
            return { success: false, message, data: { decoded: null } };
        }
    }
    verifyRefreshToken(refreshToken) {
        if (!refreshToken) return { success: false, message: 'No refresh token provided', data: { decoded: null, accessToken: null, refreshToken: null } };
        try {
            const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
            if (!decoded || !decoded.id) return { success: false, message: 'Invalid refresh token payload', data: { decoded: null, accessToken: null, refreshToken: null } };
            const { newAccessToken, newRefreshToken } = this.generateTokens(decoded.id, '30d');
            return { success: true, message: "Valid Refresh Token", data: { decoded, accessToken: newAccessToken, refreshToken: newRefreshToken } };
        } catch (error) {
            const message = error.name === 'JsonWebTokenError' ? 'Invalid refresh token' : error.name === 'TokenExpiredError' ? 'jwt expired' : error.message;
            return { success: false, message, data: { decoded: null, accessToken: null, refreshToken: null } };
        }
    }
    verifyTokens(accessToken, refreshToken) {
        try {
            if (accessToken) {
                const accessResult = this.verifyAccessToken(accessToken);
                if (accessResult.success) return accessResult;
                if (accessResult.message === "jwt expired" && refreshToken) return this.verifyRefreshToken(refreshToken);
                return { success: false, message: accessResult.message || 'Invalid Access Token', data: { decoded: null, accessToken: null, refreshToken: null } };
            }
            if (refreshToken) return this.verifyRefreshToken(refreshToken);
            return { success: false, message: 'No authentication tokens provided', data: { decoded: null, accessToken: null, refreshToken: null } };
        } catch (error) {
            console.error('Token verification error:', error);
            return { success: false, message: 'Error verifying tokens', data: { decoded: null, accessToken: null, refreshToken: null } };
        }
    }
    async verifyDecodedToken(decoded) {
        if (!decoded || !decoded.id) throw new GraphQLError('Invalid decoded token payload', { extensions: { code: 'UNAUTHENTICATED' } });
        const user = await User.findById(decoded.id).select("-password");
        if (!user || !user._id) throw new GraphQLError('Invalid decoded token payload', { extensions: { code: 'UNAUTHENTICATED' } });
        return { success: true, message: "Valid Decoded Token", data: user };
    }
    async login(email, password, ipAddress, userAgent) {
        const user = await User.findOne({ email: email });
        if (!user || !user._id) throw new GraphQLError('Invalid email', { extensions: { code: 'UNAUTHENTICATED' } });
        if (!bcrypt.compareSync(password, user.password)) throw new GraphQLError('Invalid password', { extensions: { code: 'UNAUTHENTICATED' } });
        if (!user.isVerified) throw new GraphQLError('Email not verified', { extensions: { code: 'UNAUTHENTICATED' } });
        const { newAccessToken, newRefreshToken } = this.generateTokens(user._id, '30d');
        const userResponse = user.toObject();
        delete userResponse.password;
        await Log.create({ user: user._id, business: user.business, level: 'info', event: 'login', category: 'AUTHENTICATION', status: 'SUCCESS', message: 'Login successful', service: 'auth', meta: { ipAddress, userAgent } });
        return { accessToken: newAccessToken, refreshToken: newRefreshToken, user: userResponse };
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



    refreshAccessToken(user) { }
    logout(res) {
        clearRefreshCookie(res);
        return true;
    }
    requestPasswordReset(email) {
        return issuePasswordReset(User, email);
    }
    resetPassword({ token, email, password }) {
        return consumePasswordReset(User, { token, email, password });
    }
    // Email verify is Chat GET /aux/verification — not a SaaS mutation.
    verifyEmail(user) { }
    verifyPhone(user) { }
    verifyOTP(user) { }
    verifyEmailOTP(user) { }
    verifyPhoneOTP(user) { }
}
export default new AuthService();