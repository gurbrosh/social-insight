# Reddit OAuth 2.0 Integration

## Overview

This implementation allows users to connect their Reddit accounts for better engagement tracking and identity verification.

## Benefits of Reddit OAuth

**Compared to Public JSON Endpoints:**
- ✅ **Better Rate Limits**: 60 requests/minute authenticated vs public limits
- ✅ **More Reliable**: Authenticated endpoints have higher availability
- ✅ **Auto-Refresh Tokens**: Tokens automatically refresh when expired
- ✅ **Better Identity Matching**: Authenticated user info for reply detection
- ✅ **Can Fetch User's Own Comments**: Access to user's own posts and comments

**Note**: The app works with public Reddit JSON endpoints without OAuth, but authenticated access provides better reliability and rate limits.

## Architecture

### Key Components

1. **OAuth Flow**: Reddit OAuth 2.0 Authorization Code Flow
2. **Token Storage**: Uses existing `Account` model with `provider: "reddit-api"`
3. **Token Refresh**: Automatic token refresh (tokens expire after 1 hour)
4. **Identity Matching**: Stores Reddit username in `UserPlatformIdentity` for reply detection

### Database

- **Account Model**: Stores OAuth tokens (access_token, refresh_token, expires_at)
- **UserPlatformIdentity**: Stores Reddit username for identity matching

## Setup Required

### 1. Create Reddit App

1. Go to [Reddit App Preferences](https://www.reddit.com/prefs/apps)
2. Scroll down and click **"create another app"** or **"create app"**
3. Fill in app details:
   - **Name**: Your app name (e.g., "Social Insight")
   - **App Type**: Select **"web app"**
   - **Description**: Brief description of your app
   - **About URL**: (Optional) Your app's website
   - **Redirect URI**: 
     - Development: `http://localhost:3007/api/auth/reddit/callback`
     - Production: `https://yourdomain.com/api/auth/reddit/callback`
4. Click **"create app"**

### 2. Get Credentials

After creating the app, you'll see:
- **Client ID**: Displayed under "personal use script" (looks like: `abc123def456ghi789`)
- **Client Secret**: Displayed as "secret" (looks like: `xyz789uvw456rst123`)

**Important**: Copy these values immediately - the secret is only shown once.

### 3. Environment Variables

Add to your `.env` file or CrunchyCone settings:

```bash
# Reddit OAuth 2.0 (for user connections)
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here

# Optional: Custom redirect URI (defaults to NEXT_PUBLIC_APP_URL + /api/auth/reddit/callback)
REDDIT_OAUTH_REDIRECT_URI=https://yourdomain.com/api/auth/reddit/callback
```

### 4. User-Agent Header

Reddit requires a descriptive `User-Agent` header in all requests. This is automatically set as:
```
SocialInsight:RedditOAuth:1.0.0 (by /u/socialinsight)
```

You can customize this in `lib/reddit-oauth.ts` if needed (replace `socialinsight` with your Reddit username).

## User Flow

1. User goes to Profile page
2. Clicks "Connect Reddit Account" (only visible if OAuth is configured)
3. Redirected to Reddit authorization
4. User authorizes the app
5. Redirected back to app with tokens
6. Tokens stored in `Account` table
7. Reddit username stored in `UserPlatformIdentity`

## API Endpoints

### `/api/auth/reddit/authorize`
- **Method**: GET
- **Auth**: Required
- **Returns**: Authorization URL
- **Purpose**: Initiates OAuth flow

### `/api/auth/reddit/callback`
- **Method**: GET
- **Query Params**: `code`, `state`
- **Purpose**: Handles OAuth callback, exchanges code for tokens

### `/api/auth/reddit/disconnect`
- **Method**: POST
- **Auth**: Required
- **Purpose**: Disconnects user's Reddit account

## Token Management

### Token Expiration

- Reddit access tokens expire after **1 hour**
- Refresh tokens are permanent (with `duration=permanent`)
- Tokens automatically refresh when expired (with 5-minute buffer)

### Token Refresh Flow

1. Check if token is expired (within 5 minutes)
2. Use refresh token to get new access token
3. Update stored tokens in database
4. Return new access token

This is handled automatically by `getRedditAccessToken()` function.

### Token Usage

Reddit tokens are used for:
- Authenticated API requests (better rate limits)
- Fetching conversation threads via `oauth.reddit.com`
- Identity verification (matching user's Reddit username)
- Getting user's own comments and posts

## Integration Points

### Engagement Tracking

- Reddit engagement tracking uses both:
  1. **Scraped data from database** (primary source)
  2. **On-demand fetching** via `fetchRedditThreadLight()` (fallback)
- OAuth tokens can be used to improve reliability of on-demand fetching
- Better rate limits allow more frequent checks

### User Identities

- When user connects Reddit, their username is automatically added to `UserPlatformIdentity`
- Used for reply detection matching in scraped conversation data
- Format: Just the username (e.g., `socialinsight`), not full URL

## Reddit API Capabilities

**What Reddit API CAN do:**
- ✅ Fetch conversation threads and comments
- ✅ Get user's own posts and comments
- ✅ Read subreddit posts and comments
- ✅ Better rate limits (60/minute authenticated)

**What Reddit API CANNOT do:**
- ❌ Post or comment on behalf of user (not in scope)
- ❌ Delete posts/comments (not in scope)
- ❌ Access private subreddits user doesn't have access to

**Current Scope**: `read identity`
- `read`: Read posts and comments
- `identity`: Get user's identity (username)

## Security Considerations

1. **State Parameter**: CSRF protection via state parameter
2. **Token Storage**: Tokens stored securely in database
3. **Scope**: Requests minimal necessary permissions (`read identity`)
4. **HTTPS Required**: All redirect URIs should use HTTPS in production
5. **User-Agent**: Required by Reddit API - properly formatted

## Rate Limits

### Authenticated Requests
- **60 requests per minute** per user
- More reliable than public endpoints

### Public Endpoints (without OAuth)
- Lower rate limits
- May be rate-limited during high traffic
- Still functional for basic needs

**Recommendation**: Use OAuth for production to get better rate limits and reliability.

## Testing

1. Add OAuth credentials to `.env`
2. Restart dev server
3. Go to Profile page
4. Click "Connect Reddit Account"
5. Complete OAuth flow
6. Verify connection status
7. Test engagement tracking with Reddit conversations

## Troubleshooting

### "Reddit OAuth not configured"
- Check that `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set

### "Invalid redirect URI"
- Ensure redirect URI in Reddit app settings matches exactly
- Must use HTTPS in production (or localhost for development)
- No trailing slashes

### "401 Unauthorized" when fetching
- Check if token is expired (should auto-refresh)
- Verify refresh token is stored
- Check User-Agent header is properly formatted

### Token refresh fails
- Verify refresh token is stored in database
- Check if token was revoked by user
- User may need to reconnect

## Comparison with Other Platforms

| Feature | Twitter | LinkedIn | Reddit |
|---------|---------|----------|--------|
| Fetch conversation threads | ✅ Yes | ❌ No | ✅ Yes |
| Real-time reply detection | ✅ Yes | ❌ No (uses scraped) | ✅ Yes |
| Token refresh | ✅ Yes | ❌ No (60-day expiry) | ✅ Yes (1-hour expiry) |
| On-demand fetching | ✅ Yes | ❌ No | ✅ Yes |
| Rate limits | API-dependent | N/A | 60/min authenticated |

**Reddit Advantages:**
- Better than LinkedIn: Supports conversation fetching
- Similar to Twitter: Real-time capabilities
- Auto-refresh: Tokens refresh automatically
- Public fallback: Works without OAuth (lower limits)

## Example Usage in Code

```typescript
import { getRedditAccessToken } from "@/lib/reddit-oauth";

// Get user's Reddit token (auto-refreshes if expired)
const token = await getRedditAccessToken(userId);

if (token) {
  // Use token for authenticated requests
  const response = await fetch("https://oauth.reddit.com/api/v1/me", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "SocialInsight:RedditOAuth:1.0.0 (by /u/socialinsight)",
    },
  });
}
```

## Next Steps

1. Configure Reddit app in Developer Portal
2. Add environment variables
3. Test OAuth flow
4. Verify engagement tracking works with authenticated tokens
5. Monitor rate limits and adjust if needed




