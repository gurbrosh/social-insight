# OAuth Providers Setup Guide

This guide explains how to enable OAuth authentication providers in the CrunchyCone Vanilla Starter Project using Auth.js v4.

## Overview

The authentication system currently supports:

- **Email/Password**: Traditional credentials-based authentication
- **Magic Link**: Email-based passwordless authentication (optional)
- **Google OAuth**: Social login with Google (requires setup)
- **GitHub OAuth**: Social login with GitHub (requires setup)

The application uses Auth.js v4 with dynamic provider configuration - OAuth providers are automatically enabled based on environment variables.

## Quick Start

Both Google and GitHub OAuth are already integrated and just need configuration:

### For Google OAuth:

1. [Google Cloud Console](https://console.cloud.google.com/) → Create OAuth app
2. Set callback URL: `http://localhost:3000/api/auth/callback/google`
3. Add to `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true`

### For GitHub OAuth:

1. [GitHub Settings → OAuth Apps](https://github.com/settings/developers) → New OAuth app
2. Set callback URL: `http://localhost:3000/api/auth/callback/github`
3. Add to `.env`: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `NEXT_PUBLIC_ENABLE_GITHUB_AUTH=true`

Both providers will automatically appear on the sign-in page and in profile account linking once configured.

## Auth.js Architecture

```
User → Auth.js Provider → OAuth Service → Callback → Auth.js Session → Redirect
```

Auth.js handles all the OAuth complexity including:

- Token exchange and validation
- User session creation
- Security (CSRF, state validation)
- Database integration via Prisma adapter

## Implementing OAuth Providers with Auth.js

### Prerequisites

Auth.js is already installed and configured. To add OAuth providers, you simply need to:

1. Install the provider package
2. Add environment variables
3. Update the Auth.js configuration
4. Add provider buttons to the UI

> **🚀 Recommended Providers**: Google OAuth is the easiest for consumer apps, GitHub OAuth is preferred for developer tools. Both are simple to set up.

## Google OAuth Setup

Google OAuth is already integrated into the application via Auth.js v4. You just need to configure the credentials and enable it.

### Step 1: Create Google OAuth Application

1. **Go to [Google Cloud Console](https://console.cloud.google.com/)**
2. **Create or select a project**
3. **Configure OAuth consent screen**:
   - Go to "APIs & Services" → "OAuth consent screen"
   - Choose "External" user type (unless you have Google Workspace)
   - Fill in required fields: App name, User support email, Developer contact
   - Add your domain to authorized domains if deploying to production
4. **Create OAuth 2.0 Credentials**:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth 2.0 Client IDs"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - **Development**: `http://localhost:3000/api/auth/callback/google`
     - **Production**: `https://yourdomain.com/api/auth/callback/google`
5. **Copy Client ID and Secret** from the credentials page

### Step 2: Environment Variables

Add to your `.env` file:

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id-here.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret-here

# Enable Google OAuth in the application
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
```

> **🔐 Security**: Keep credentials secure and never commit them to version control.

### Step 3: Restart Development Server

That's it! The application will automatically:

- Detect the Google OAuth credentials in environment variables
- Enable the Google OAuth provider in Auth.js configuration
- Show the "Continue with Google" button on the sign-in page

Restart your development server to apply the changes:

```bash
npm run dev
```

### Step 4: Test Google OAuth

1. **Go to the sign-in page**: `http://localhost:3000/auth/signin`
2. **Click "Continue with Google"** button
3. **Complete OAuth flow**:
   - You'll be redirected to Google's login page
   - Sign in with your Google account
   - Grant permissions to your app
   - You'll be redirected back and automatically signed in
4. **Verify user creation**: Check your profile at `/profile` or admin dashboard

> **🎉 Success**: If you can sign in with Google and see your user information, Google OAuth is working correctly!

## GitHub OAuth Setup

GitHub OAuth is already integrated into the application via Auth.js v4. You just need to configure the credentials and enable it.

### Step 1: Create GitHub OAuth Application

1. **Go to [GitHub Settings](https://github.com/settings/developers)**
2. **Navigate to "Developer settings" → "OAuth Apps"**
3. **Click "New OAuth App"**
4. **Fill in the application details**:
   - **Application name**: Your app name (e.g., "CrunchyCone App")
   - **Homepage URL**:
     - **Development**: `http://localhost:3000`
     - **Production**: `https://yourdomain.com`
   - **Application description**: Brief description of your app
   - **Authorization callback URL**:
     - **Development**: `http://localhost:3000/api/auth/callback/github`
     - **Production**: `https://yourdomain.com/api/auth/callback/github`
5. **Click "Register application"**
6. **Copy Client ID and generate Client Secret** from the application page

### Step 2: Environment Variables

Add to your `.env` file:

```env
# GitHub OAuth Configuration
GITHUB_CLIENT_ID=your-github-client-id-here
GITHUB_CLIENT_SECRET=your-github-client-secret-here

# Enable GitHub OAuth in the application
NEXT_PUBLIC_ENABLE_GITHUB_AUTH=true
```

> **🔐 Security**: Keep credentials secure and never commit them to version control.

### Step 3: Restart Development Server

That's it! The application will automatically:

- Detect the GitHub OAuth credentials in environment variables
- Enable the GitHub OAuth provider in Auth.js configuration
- Show the "Continue with GitHub" button on the sign-in page

Restart your development server to apply the changes:

```bash
npm run dev
```

### Step 4: Test GitHub OAuth

1. **Go to the sign-in page**: `http://localhost:3000/auth/signin`
2. **Click "Continue with GitHub"** button
3. **Complete OAuth flow**:
   - You'll be redirected to GitHub's login page
   - Sign in with your GitHub account
   - Grant permissions to your app
   - You'll be redirected back and automatically signed in
4. **Verify user creation**: Check your profile at `/profile` or admin dashboard

> **🎉 Success**: If you can sign in with GitHub and see your user information, GitHub OAuth is working correctly!

## Current Implementation Details

The OAuth integration includes several advanced features for both Google and GitHub:

### Dynamic Provider Configuration

The application uses environment-based provider detection:

**Google OAuth** is enabled when:

- `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true`
- `GOOGLE_CLIENT_ID` is set
- `GOOGLE_CLIENT_SECRET` is set

**GitHub OAuth** is enabled when:

- `NEXT_PUBLIC_ENABLE_GITHUB_AUTH=true`
- `GITHUB_CLIENT_ID` is set
- `GITHUB_CLIENT_SECRET` is set

If any required variables are missing, the provider button won't appear on the sign-in form.

### Automatic Features

The OAuth integration includes several automatic features:

**1. Dynamic Provider Loading**

```typescript
// lib/auth/providers.ts automatically detects provider availability
export function isGoogleAuthEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true" &&
    !!process.env.GOOGLE_CLIENT_ID &&
    !!process.env.GOOGLE_CLIENT_SECRET
  );
}

export function isGitHubAuthEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_ENABLE_GITHUB_AUTH === "true" &&
    !!process.env.GITHUB_CLIENT_ID &&
    !!process.env.GITHUB_CLIENT_SECRET
  );
}
```

**2. Automatic Role Assignment**

- New OAuth users automatically get the "user" role
- Existing users logging in via OAuth maintain their existing roles
- Admin users signing in with OAuth keep admin privileges

**3. Profile Data Sync**

- Name and avatar automatically populated from OAuth profiles
- Missing profile data fetched when linking OAuth to existing accounts
- Avatar URLs stay synchronized with provider profile changes

**4. Account Linking**

- Users can link OAuth accounts to existing email/password accounts
- Automatic profile enrichment when linking accounts
- Users can disconnect OAuth if they have email/password backup

## Profile Management Features

Once OAuth providers are set up, users get access to comprehensive profile management:

### User Profile Page (`/profile`)

**Features available:**

- View user information (email, name, member since, last sign-in)
- Display user avatar with fallback to initials
- Show role badges (admin role highlighted)
- Manage OAuth account connections

### Account Linking & Disconnection

**Linking OAuth to Existing Accounts:**

1. Sign in with email/password
2. Go to `/profile`
3. Click "Link [Provider] Account" in the Account Linking section
4. Complete OAuth flow
5. Profile automatically enriched with provider data (name, avatar)

**Disconnecting OAuth:**

1. Go to `/profile`
2. Find connected OAuth account
3. Click the disconnect icon (⚡) next to "Connected" badge
4. Confirm disconnection

**Safety Features:**

- Can only disconnect if user has email/password authentication OR multiple OAuth providers
- Server-side validation prevents account lockout
- Clear error messages if disconnection not allowed

## Environment Configuration

### Complete Environment Setup

Here's a complete `.env` example with both OAuth providers enabled:

```env
# Database
DATABASE_URL="file:./db/prod.db"

# Auth.js
AUTH_SECRET="your-secret-key-at-least-32-characters-long"
AUTH_URL="http://localhost:3000"

# Google OAuth
GOOGLE_CLIENT_ID="123456789-abcdef.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-your-google-client-secret"

# GitHub OAuth
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"

# Provider Controls (all optional, defaults shown)
NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD=true    # Email/password auth
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true       # Google OAuth
NEXT_PUBLIC_ENABLE_GITHUB_AUTH=true       # GitHub OAuth
NEXT_PUBLIC_ENABLE_MAGIC_LINK=false       # Magic link auth

# Application
NEXT_PUBLIC_APP_URL="http://localhost:3000"
EMAIL_FROM="noreply@crunchycone.app"
```

### Disable/Enable Providers

**To disable Google OAuth:**

```env
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=false
# or remove the variable entirely
```

**To disable GitHub OAuth:**

```env
NEXT_PUBLIC_ENABLE_GITHUB_AUTH=false
# or remove the variable entirely
```

**To disable email/password:**

```env
NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD=false
```

**To enable magic link:**

```env
NEXT_PUBLIC_ENABLE_MAGIC_LINK=true
```

## Troubleshooting OAuth Providers

### Common Issues

**1. OAuth button not appearing**

- Check `NEXT_PUBLIC_ENABLE_[PROVIDER]_AUTH=true` in `.env`
- Verify `[PROVIDER]_CLIENT_ID` and `[PROVIDER]_CLIENT_SECRET` are set
- Restart development server after changing environment variables

**2. "Redirect URI mismatch" error**

- Ensure provider console redirect URI exactly matches:
  - **Google Dev**: `http://localhost:3000/api/auth/callback/google`
  - **Google Prod**: `https://yourdomain.com/api/auth/callback/google`
  - **GitHub Dev**: `http://localhost:3000/api/auth/callback/github`
  - **GitHub Prod**: `https://yourdomain.com/api/auth/callback/github`
- Check for trailing slashes (should not have them)
- Verify protocol (http vs https)

**3. Invalid credentials errors**

- **Google**: Client ID format should be: `123456789-abcdef.apps.googleusercontent.com`
- **Google**: Secret format should be: `GOCSPX-your-secret-here`
- **GitHub**: Client ID is typically shorter: `Iv1.1234567890abcdef`
- **GitHub**: Secret is a 40-character hex string
- Check for extra spaces or quotes in environment variables

**4. "Sign in failed" after OAuth redirect**

- Check browser console for detailed error messages
- Verify your account email is accessible
- **Google**: Some users hide email - they must enable email sharing
- **GitHub**: Ensure email is public or app has email scope

**5. Profile data not syncing**

- **Google**: Ensure account has public name and picture
- **GitHub**: Check that profile name and avatar are set
- Name and avatar sync happens on next sign-in

### Debug Mode

Enable detailed Auth.js logging:

```env
NEXTAUTH_DEBUG=true
```

### Testing Checklist

✅ OAuth app configured in provider console
✅ Redirect URIs match exactly  
✅ Environment variables set correctly  
✅ Development server restarted  
✅ OAuth consent screen/app settings configured  
✅ Test account ready

## Adding Additional Providers

The architecture supports adding more OAuth providers in the future. The pattern would be:

1. **Environment Variables**: Add provider credentials to `.env`
2. **Dynamic Detection**: Update `lib/auth/providers.ts` to detect new provider
3. **Auth Configuration**: Add provider to `lib/auth/auth-config.ts` build function
4. **UI Components**: Update sign-in form to show new provider button

Popular providers that could be added:

- **Facebook**: Consumer applications
- **Discord**: Gaming/community applications
- **Microsoft**: Enterprise applications
- **Apple**: iOS app integration
- **Twitter/X**: Social media applications

## Summary

OAuth authentication is now fully integrated with:

✅ **Easy Setup**: Just add credentials to environment variables  
✅ **Dynamic Configuration**: Automatically enables when credentials present  
✅ **Multiple Providers**: Google and GitHub with consistent interface
✅ **Profile Management**: Full account linking and disconnection features  
✅ **Data Sync**: Automatic profile enrichment and avatar updates  
✅ **Security**: Safe disconnection with account lockout prevention  
✅ **User Experience**: Seamless sign-in and profile management

**Next Steps:**

1. Follow the setup guide to configure provider consoles
2. Add credentials to your `.env` file
3. Test the complete OAuth flows
4. Explore profile management features at `/profile`
5. Consider adding additional providers as needed

The OAuth integration provides a solid foundation for social authentication while maintaining security and user control.
