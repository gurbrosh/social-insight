import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { prismaAuth } from "@/lib/auth/prisma-auth";
import bcrypt from "bcryptjs";

// Build providers array dynamically based on environment
const buildProviders = () => {
  const providers = [];

  // Conditionally add email/password provider (enabled by default)
  if (process.env.NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD !== "false") {
    providers.push(
      CredentialsProvider({
        name: "credentials",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) {
            return null;
          }

          try {
            // Find user with roles and profile
            const user = await prismaAuth.user.findUnique({
              where: {
                email: credentials.email as string,
                deleted_at: null,
              },
              include: {
                profile: true,
                roles: {
                  where: { deleted_at: null },
                  include: {
                    role: true,
                  },
                },
              },
            });

            if (!user || !user.password) {
              return null;
            }

            // Verify password using bcrypt
            const isValidPassword = await bcrypt.compare(
              credentials.password as string,
              user.password
            );

            if (!isValidPassword) {
              return null;
            }

            // Update last signed in
            await prismaAuth.user.update({
              where: { id: user.id },
              data: { last_signed_in: new Date() },
            });

            // Return user object for session
            return {
              id: user.id,
              email: user.email,
              name:
                user.name ||
                `${user.profile?.first_name || ""} ${user.profile?.last_name || ""}`.trim() ||
                null,
              image: user.image,
              roles: user.roles.map((ur) => ur.role.name),
            };
          } catch (error) {
            console.error("Auth error:", error);
            return null;
          }
        },
      })
    );
  }

  // Conditionally add Email (Magic Link) provider
  const enableMagicLink = process.env.NEXT_PUBLIC_ENABLE_MAGIC_LINK;
  if (enableMagicLink === "true" || enableMagicLink === "1") {
    providers.push(
      EmailProvider({
        from:
          process.env.CRUNCHYCONE_EMAIL_FROM || process.env.EMAIL_FROM || "noreply@crunchycone.app",
        // Custom email sending function using CrunchyCone email service and templates
        sendVerificationRequest: async ({ identifier: email, url, provider }) => {
          try {
            // Import crunchycone-lib services
            const { createEmailService, getEmailTemplateService } = await import("crunchycone-lib");

            // Set email provider to the configured provider temporarily for template rendering
            const originalProvider = process.env.CRUNCHYCONE_EMAIL_PROVIDER;
            process.env.CRUNCHYCONE_EMAIL_PROVIDER = "console";

            try {
              // Render the magic-link template
              const templateService = getEmailTemplateService();
              const templateData = {
                signInUrl: url,
                appName: process.env.NEXT_PUBLIC_APP_NAME || "Your App",
                supportEmail: process.env.CRUNCHYCONE_EMAIL_FROM || "support@example.com",
              };

              const rendered = await templateService.previewTemplate(
                "magic-link",
                templateData,
                "en"
              );

              // Restore original email provider
              if (originalProvider === undefined) {
                delete process.env.CRUNCHYCONE_EMAIL_PROVIDER;
              } else {
                process.env.CRUNCHYCONE_EMAIL_PROVIDER = originalProvider;
              }

              // Send the email using the actual email service
              const emailService = createEmailService();
              const result = await emailService.sendEmail({
                from: {
                  email: provider.from,
                  name: process.env.CRUNCHYCONE_EMAIL_FROM_DISPLAY || "Your App",
                },
                to: [
                  {
                    email: email,
                    name: "User",
                  },
                ],
                subject: rendered.subject || "Sign in to your account",
                htmlBody: rendered.html || "",
                textBody: rendered.text || "",
              });

              if (!result.success) {
                console.error("Failed to send magic link email:", result.error);
                throw new Error(result.error || "Failed to send magic link email");
              }

              console.log("✅ Magic link email sent successfully to:", email);
            } finally {
              // Ensure email provider is restored even if template rendering fails
              if (originalProvider === undefined) {
                delete process.env.CRUNCHYCONE_EMAIL_PROVIDER;
              } else {
                process.env.CRUNCHYCONE_EMAIL_PROVIDER = originalProvider;
              }
            }
          } catch (error) {
            console.error("Magic link email error:", error);

            // Fallback to console logging for development
            console.log(`
🔗 Magic Link Email (Fallback - Check Email Configuration)
=========================================================
To: ${email}
From: ${provider.from}

Click the link below to sign in:
${url}

This link will expire in 24 hours.
            `);
          }
        },
      })
    );
  }

  // Conditionally add Google OAuth provider
  const enableGoogleAuth = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH;
  if (
    (enableGoogleAuth === "true" || enableGoogleAuth === "1") &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  ) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      })
    );
  }

  // Conditionally add GitHub OAuth provider
  const enableGithubAuth = process.env.NEXT_PUBLIC_ENABLE_GITHUB_AUTH;
  if (
    (enableGithubAuth === "true" || enableGithubAuth === "1") &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET
  ) {
    providers.push(
      GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        authorization: {
          params: {
            scope: "read:user user:email",
          },
        },
        profile: async (profile, tokens) => {
          // If no email in profile, try to fetch it from GitHub API
          if (!profile.email) {
            try {
              const response = await fetch("https://api.github.com/user/emails", {
                headers: {
                  Authorization: `token ${tokens.access_token}`,
                  "User-Agent": "NextAuth",
                },
              });
              const emails = await response.json();

              // Find primary email
              const primaryEmail = emails?.find(
                (email: { primary?: boolean; email?: string }) => email.primary
              );
              if (primaryEmail) {
                profile.email = primaryEmail.email;
                console.log("GitHub: Retrieved primary email from API");
              }
            } catch (error) {
              console.error("Error fetching GitHub emails:", error);
            }
          }

          return {
            id: profile.id.toString(),
            name: profile.name || profile.login,
            email: profile.email,
            image: profile.avatar_url,
          };
        },
      })
    );
  }

  return providers;
};

export const authConfig: NextAuthOptions = {
  adapter: PrismaAdapter(prismaAuth),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/auth/signin",
  },
  providers: buildProviders(),
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Simplified redirect logic to avoid loops
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
    async jwt({ token, user, account }) {
      // Include roles in JWT token
      if (user) {
        console.log("JWT callback - user:", { id: user.id, email: user.email, name: user.name });

        // For OAuth users, we need to fetch roles from database
        if (account?.provider === "google" || account?.provider === "github") {
          try {
            const dbUser = await prismaAuth.user.findUnique({
              where: { id: user.id },
              include: {
                roles: {
                  where: { deleted_at: null },
                  include: { role: true },
                },
              },
            });
            token.roles = dbUser?.roles.map((ur) => ur.role.name) || [];
          } catch (error) {
            // Log detailed error information
            const errorDetails =
              error && typeof error === "object" && "name" in error
                ? {
                    name: (error as any).name,
                    message: (error as any).message,
                    code: (error as any).code,
                    meta: (error as any).meta,
                    cause: (error as any).cause,
                    clientVersion: (error as any).clientVersion,
                    stack: (error as any).stack,
                  }
                : error;
            console.error(
              "Error fetching user roles in JWT callback:",
              JSON.stringify(errorDetails, null, 2)
            );
            token.roles = [];
          }
        } else {
          token.roles = (user as { roles?: string[] }).roles || [];
        }

        token.id = user.id;
        console.log("JWT token created with roles:", token.roles);
      }
      return token;
    },
    async session({ session, token }) {
      // Include roles and user ID in session
      if (token) {
        session.user.id = token.id as string;
        session.user.roles = token.roles as string[];
      }
      return session;
    },
    async signIn({ user, account, profile }) {
      // Handle OAuth account linking and role assignment
      if (account?.provider === "google" || account?.provider === "github") {
        console.log(`${account.provider} sign-in attempt for: ${user.email}`);

        // Check if email is available
        if (!user.email) {
          console.error(`${account.provider} user has no email address available`);

          // For GitHub users with private emails, we could use their GitHub username + provider
          // But for this demo, we'll require email access
          if (account.provider === "github") {
            console.log("GitHub user needs to make email public for this app");
          }
          return false;
        }

        try {
          // Check if user exists in our database
          const dbUser = await prismaAuth.user.findUnique({
            where: {
              email: user.email as string,
              deleted_at: null,
            },
            include: {
              roles: {
                where: { deleted_at: null },
                include: { role: true },
              },
            },
          });

          if (dbUser) {
            console.log(
              `Existing user found: ${user.email}, roles:`,
              dbUser.roles.map((r) => r.role.name)
            );

            // Check if user has any roles, if not assign default "user" role
            if (dbUser.roles.length === 0) {
              const userRole = await prismaAuth.role.findUnique({
                where: { name: "user" },
              });

              if (userRole) {
                await prismaAuth.userRole.create({
                  data: {
                    user_id: dbUser.id,
                    role_id: userRole.id,
                  },
                });
                console.log(`Assigned user role to: ${user.email}`);
              }
            }

            // Update user profile with OAuth provider data
            if (profile) {
              const updates: { name?: string; image?: string } = {};

              // Update name if missing
              if (!dbUser.name && profile.name) {
                updates.name = profile.name;
                console.log(`Updating user name from ${account.provider}: ${profile.name}`);
              }

              // Update avatar if missing OR if it has changed
              const avatarUrl =
                account.provider === "google"
                  ? (profile as { picture?: string }).picture
                  : (profile as { avatar_url?: string }).avatar_url;

              console.log(`${account.provider} profile data:`, {
                name: profile.name,
                avatarUrl,
                picture: (profile as { picture?: string }).picture,
                avatar_url: (profile as { avatar_url?: string }).avatar_url,
              });

              if (avatarUrl) {
                if (!dbUser.image) {
                  updates.image = avatarUrl;
                  console.log(`Setting user avatar from ${account.provider}: ${avatarUrl}`);
                } else if (dbUser.image !== avatarUrl) {
                  updates.image = avatarUrl;
                  console.log(
                    `Updating changed user avatar from ${account.provider}: ${avatarUrl}`
                  );
                }
              } else {
                console.log(`No avatar URL found for ${account.provider} user`);
              }

              if (Object.keys(updates).length > 0) {
                await prismaAuth.user.update({
                  where: { id: dbUser.id },
                  data: updates,
                });
                console.log(`Updated profile for user: ${user.email}`);
              }
            }
          } else {
            console.log(`New ${account.provider} user: ${user.email}`);
            // User will be created by Auth.js, but we need to assign role after creation
            // This will be handled in the events.signIn callback
          }
        } catch (error) {
          console.error("Error in signIn callback:", error);
        }
      }

      return true;
    },
  },
  events: {
    async signIn({ user, account, profile: _profile, isNewUser }) {
      console.log(`User signed in: ${user.email}, isNewUser: ${isNewUser}`);

      // Assign default role to new OAuth users
      if (isNewUser && (account?.provider === "google" || account?.provider === "github")) {
        try {
          const userRole = await prismaAuth.role.findUnique({
            where: { name: "user" },
          });

          if (userRole) {
            await prismaAuth.userRole.create({
              data: {
                user_id: user.id,
                role_id: userRole.id,
              },
            });
            console.log(`Assigned user role to new ${account.provider} user: ${user.email}`);
          }
        } catch (error) {
          console.error("Error assigning role to new user:", error);
        }
      }
    },
  },
};
