export interface EmailProvider {
  sendEmail(options: EmailOptions): Promise<void>;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class ConsoleEmailProvider implements EmailProvider {
  async sendEmail(options: EmailOptions): Promise<void> {
    console.log("=== EMAIL SENT ===");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log("--- Content ---");
    console.log(options.text || options.html);
    console.log("=================");
  }
}

// Email templates
export function getVerificationEmailTemplate(token: string, appUrl: string): EmailOptions {
  const verificationUrl = `${appUrl}/auth/verify-email?token=${token}`;

  return {
    to: "", // Will be set by caller
    subject: "Verify your email address",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Email Address</h2>
        <p>Thank you for signing up! Please click the link below to verify your email address:</p>
        <p style="margin: 20px 0;">
          <a href="${verificationUrl}" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Verify Email
          </a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
        </p>
      </div>
    `,
    text: `
Verify Your Email Address

Thank you for signing up! Please click the link below to verify your email address:

${verificationUrl}

This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
    `.trim(),
  };
}

export function getPasswordResetEmailTemplate(token: string, appUrl: string): EmailOptions {
  const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;

  return {
    to: "", // Will be set by caller
    subject: "Reset your password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Reset Your Password</h2>
        <p>You requested to reset your password. Click the link below to create a new password:</p>
        <p style="margin: 20px 0;">
          <a href="${resetUrl}" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Reset Password
          </a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${resetUrl}</p>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
    `,
    text: `
Reset Your Password

You requested to reset your password. Click the link below to create a new password:

${resetUrl}

This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
    `.trim(),
  };
}

export function getMagicLinkEmailTemplate(token: string, appUrl: string): EmailOptions {
  const magicLinkUrl = `${appUrl}/api/auth/magic-link?token=${token}`;

  return {
    to: "", // Will be set by caller
    subject: "Sign in to your account",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Sign In to Your Account</h2>
        <p>Click the link below to sign in to your account:</p>
        <p style="margin: 20px 0;">
          <a href="${magicLinkUrl}" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Sign In
          </a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${magicLinkUrl}</p>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          This link will expire in 24 hours. If you didn't request to sign in, you can safely ignore this email.
        </p>
      </div>
    `,
    text: `
Sign In to Your Account

Click the link below to sign in to your account:

${magicLinkUrl}

This link will expire in 24 hours. If you didn't request to sign in, you can safely ignore this email.
    `.trim(),
  };
}

// Global email provider instance
let emailProvider: EmailProvider = new ConsoleEmailProvider();

export function setEmailProvider(provider: EmailProvider) {
  emailProvider = provider;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const fromAddress = process.env.EMAIL_FROM || "noreply@crunchycone.app";

  // Add from address to options
  const fullOptions = {
    ...options,
    from: fromAddress,
  };

  await emailProvider.sendEmail(fullOptions);
}
