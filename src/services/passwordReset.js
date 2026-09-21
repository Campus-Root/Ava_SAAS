import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { GraphQLError } from 'graphql';
import { fireAndForgetAxios } from '../utils/fireAndForget.js';

export function dashboardOrigin() {
    return String(process.env.SERVER_URL || 'https://app.avakado.ai').trim().replace(/\/+$/, '');
}

function defaultSendResetEmail(user, url) {
    fireAndForgetAxios('POST', `${process.env.WEBHOOKS_URL}aux/trigger-email`, {
        mode: 'SYSTEM',
        config: { to: user.email },
        body: {
            template: 'passwordReset',
            data: {
                subject: '[AVA] Reset your password',
                url,
                name: user.name,
            },
        },
    });
}

/**
 * Always returns the same message so the caller cannot probe which emails exist.
 * Only verified users get a mail; unverified accounts keep using the register link.
 */
export async function requestPasswordReset(User, email, { sendEmail } = {}) {
    const user = await User.findOne({ email });
    if (user?.isVerified) {
        const token = crypto.randomBytes(7).toString('hex');
        user.emailToken = token;
        await user.save();
        const url = `${dashboardOrigin()}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
        (sendEmail || defaultSendResetEmail)(user, url);
    }
    return { success: true, message: 'If that email exists, a reset link was sent.' };
}

export async function resetPassword(User, { token, email, password }) {
    if (!token || !email || !password) {
        throw new GraphQLError('Missing required fields', { extensions: { code: 'MISSING_FIELDS' } });
    }
    const previous = await User.findOneAndUpdate(
        { emailToken: String(token), email: String(email) },
        { $set: { password: await bcrypt.hash(password, 12) }, $unset: { emailToken: 1 } },
        { new: false },
    );
    if (!previous) {
        throw new GraphQLError('Invalid or expired reset link', { extensions: { code: 'UNAUTHENTICATED' } });
    }
    return { success: true, message: 'Password updated. You can log in.' };
}
