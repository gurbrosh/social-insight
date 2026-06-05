# Twitter OAuth 2.0 Integration

## Overview

This implementation allows users to connect their Twitter accounts for API access, enabling engagement tracking and reply detection without requiring each user to create their own Twitter Developer account.

## Architecture

### Key Components

1. **OAuth Flow**: Twitter OAuth 2.0 Authorization Code Flow with PKCE (secure)
2. **Token Storage**: Uses existing `Account` model with `provider: "twitter-api"`
3. **Auto-Refresh**: Automatically refreshes expired tokens
4. **User-Specific**: Each user has their own Twitter API access token

### Database

- **Account Model**: Stores OAuth tokens (access_token, refresh_token, expires_at)
- **UserPlatformIdentity**: Stores Twitter username for identity matching

## Setup Required

### 1. Create Twitter OAuth 2.0 App

**Important**: You need to create a **new app specifically for OAuth 2.0**. Existing apps with only OAuth 1.0a credentials won't work.

1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Click **"+ Create App"** or **"Create App"**
3. **Select OAuth 2.0** as the authentication method (not OAuth 1.0a)
4. Configure with the following settings:
   - **App name**: Your app name (e.g., "Social Insight")
   - **App permissions**: Read and Write (or Read only if you only need read access)
   - **Type of App**: Web App, Automated App or Bot
   - **Callback URI**: 
     - Development: `http://localhost:3007/api/auth/twitter/callback`
     - Production: `https://yourdomain.com/api/auth/twitter/callback`
   - **Website URL**: Your app's domain

**Note**: If you only see OAuth 1.0a options, you may need to:
- Check if your Twitter Developer account has OAuth 2.0 access enabled
- Some older developer accounts may need to upgrade
- Contact Twitter Developer Support if OAuth 2.0 option is not available

### 2. Get OAuth Credentials

**Important**: These are different from the App ID or API Keys!

1. In your Twitter App settings, go to the **"Keys and tokens"** or **"OAuth 2.0"** section
2. Look for **"OAuth 2.0 Client ID and Client Secret"** (not the OAuth 1.0a Consumer Keys)
3. You need:
   - **Client ID** (OAuth 2.0 Client ID) - This is a separate identifier from your App ID
   - **Client Secret** (OAuth 2.0 Client Secret) - This is different from your API Secret

**Note**: 
- If you don't see OAuth 2.0 Client ID/Secret, you may need to:
  - Enable OAuth 2.0 in your app settings
  - Convert your app to use OAuth 2.0 (Twitter may require this for new apps)
  - The Client ID looks like a long alphanumeric string (different format from App ID)

### 3. Environment Variables

Add to your `.env` file or CrunchyCone settings:

```bash
# Twitter OAuth 2.0 (for user connections)
TWITTER_CLIENT_ID=your_client_id_here
TWITTER_CLIENT_SECRET=your_client_secret_here

# Optional: Custom redirect URI (defaults to NEXT_PUBLIC_APP_URL + /api/auth/twitter/callback)
TWITTER_OAUTH_REDIRECT_URI=https://yourdomain.com/api/auth/twitter/callback
```

**Note**: These are different from `TWITTER_BEARER_TOKEN` (which is for admin/global access).

## User Flow

1. User goes to Profile page
2. Clicks "Connect Twitter Account"
3. Redirected to Twitter authorization
4. User authorizes the app
5. Redirected back to app with tokens
6. Tokens stored in `Account` table
7. Username stored in `UserPlatformIdentity`

## API Endpoints

### `/api/auth/twitter/authorize`
- **Method**: GET
- **Auth**: Required
- **Returns**: Authorization URL
- **Purpose**: Initiates OAuth flow

### `/api/auth/twitter/callback`
- **Method**: GET
- **Query Params**: `code`, `state`
- **Purpose**: Handles OAuth callback, exchanges code for tokens

### `/api/auth/twitter/disconnect`
- **Method**: POST
- **Auth**: Required
- **Purpose**: Disconnects user's Twitter account

## Token Management

### Automatic Token Refresh

The system automatically refreshes expired tokens:
- Checks expiration before each API call
- Refreshes if token expires within 5 minutes
- Updates stored tokens automatically

### Token Priority

When making Twitter API calls:
1. **First**: User's OAuth token (if connected)
2. **Fallback**: Global `TWITTER_BEARER_TOKEN` (for backward compatibility)

## Integration Points

### Engagement Tracking

- `app/api/engagement/refresh/route.ts` uses `getTwitterAccessToken(userId)` to get user-specific tokens
- Falls back to global bearer token if user hasn't connected

### User Identities

- When user connects Twitter, their username is automatically added to `UserPlatformIdentity`
- Used for reply detection matching

## Security Considerations

1. **PKCE**: Uses Proof Key for Code Exchange (most secure OAuth flow)
2. **State Parameter**: CSRF protection via state parameter
3. **Token Storage**: Tokens stored securely in database
4. **Scope**: Requests minimal necessary permissions (tweet.read, tweet.write, users.read, offline.access)

## Migration from Bearer Token

The system supports both approaches:
- **New users**: Can connect via OAuth (recommended)
- **Existing deployments**: Can continue using global bearer token as fallback
- **Gradual migration**: Users can connect at their own pace

## Limitations

1. **Rate Limits**: Each user's tokens use their own rate limits
2. **Permissions**: Users must grant permissions to your app
3. **Token Expiry**: Refresh tokens may expire (handled automatically)

## Testing

1. Add OAuth credentials to `.env`
2. Restart dev server
3. Go to Profile page
4. Click "Connect Twitter Account"
5. Complete OAuth flow
6. Verify connection status

## Troubleshooting

### "Twitter OAuth not configured"
- Check that `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` are set

### "Invalid state parameter"
- State expired (5 minute timeout) - try again

### "User mismatch"
- Security check failed - ensure you're using the correct session

### Tokens not refreshing
- Check refresh token is stored
- Verify Twitter App has refresh token enabled

