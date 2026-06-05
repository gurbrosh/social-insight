# Facebook OAuth 2.0 Integration

## Overview

This implementation allows users to connect their Facebook accounts for identity verification and engagement tracking.

## Important Limitations

**Facebook Graph API Restrictions:**
- Facebook's Graph API has **limitations on fetching public conversation threads/comments**
- You cannot easily fetch replies or comments on public posts via Graph API without special permissions
- Engagement tracking for Facebook relies on **scraped data from your database** (from Apify scrapers)
- Facebook OAuth is mainly useful for:
  - Identity verification (matching user's Facebook profile to replies in scraped data)
  - Getting user's own profile information
  - Better identity matching in engagement tracking

## Architecture

### Key Components

1. **OAuth Flow**: Facebook OAuth 2.0 Authorization Code Flow (standard OAuth 2.0)
2. **Token Storage**: Uses existing `Account` model with `provider: "facebook-api"`
3. **Identity Matching**: Stores Facebook profile URL in `UserPlatformIdentity` for reply detection

### Database

- **Account Model**: Stores OAuth tokens (access_token, expires_at)
- **UserPlatformIdentity**: Stores Facebook profile URL for identity matching

## Setup Required

### 1. Create Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click **"My Apps"** → **"Create App"**
3. Select app type: **"Consumer"** (for user authentication)
4. Fill in app details:
   - **App Name**: Your app name
   - **Contact Email**: Your email
   - Click **"Create App"**

### 2. Configure Facebook Login

1. In your app dashboard, go to **"Add Product"** in the left sidebar
2. Find **"Facebook Login"** and click **"Set Up"**
3. Choose **"Web"** as your platform
4. Under **"Facebook Login > Settings"**:
   - Add **Valid OAuth Redirect URIs**:
     - Development: `http://localhost:3007/api/auth/facebook/callback`
     - Production: `https://yourdomain.com/api/auth/facebook/callback`
   - Enable **"Client OAuth Login"**
   - Enable **"Web OAuth Login"**

### 3. Get App Credentials

1. Go to **"Settings"** → **"Basic"** in your app dashboard
2. Note your **App ID** and **App Secret**
3. Add your app domain (for production)

### 4. Environment Variables

Add to your `.env` file or CrunchyCone settings:

```bash
# Facebook OAuth 2.0 (for user connections)
FACEBOOK_APP_ID=your_app_id_here
FACEBOOK_APP_SECRET=your_app_secret_here

# Optional: Custom redirect URI (defaults to NEXT_PUBLIC_APP_URL + /api/auth/facebook/callback)
FACEBOOK_OAUTH_REDIRECT_URI=http://localhost:3007/api/auth/facebook/callback
```

## User Flow

1. User goes to Profile page
2. Clicks "Connect Facebook Account" (only visible if OAuth is configured)
3. Redirected to Facebook authorization
4. User authorizes the app
5. Redirected back to app with tokens
6. Tokens stored in `Account` table
7. Profile URL stored in `UserPlatformIdentity`

## API Endpoints

### `/api/auth/facebook/authorize`
- **Method**: GET
- **Auth**: Required
- **Returns**: Authorization URL
- **Purpose**: Initiates OAuth flow

### `/api/auth/facebook/callback`
- **Method**: GET
- **Query Params**: `code`, `state`
- **Purpose**: Handles OAuth callback, exchanges code for tokens

### `/api/auth/facebook/disconnect`
- **Method**: POST
- **Auth**: Required
- **Purpose**: Disconnects user's Facebook account

## Token Management

### Token Expiration

- Facebook access tokens typically last **60 days**
- Tokens do not have refresh tokens by default
- When expired, users need to reconnect

### Token Usage

Facebook tokens are used for:
- Identity verification (matching user's Facebook profile)
- Profile data retrieval
- **NOT for fetching conversation threads** (Graph API limitations)

## Integration Points

### Engagement Tracking

- Facebook engagement tracking relies on **scraped data from database**
- OAuth tokens are used for **identity matching** (identifying user's replies in scraped data)
- Unlike Twitter, Facebook doesn't support easy on-demand conversation fetching

### User Identities

- When user connects Facebook, their profile URL is automatically added to `UserPlatformIdentity`
- Used for reply detection matching in scraped conversation data

## Facebook Graph API Limitations

**What Facebook Graph API CAN do:**
- Get user's profile information
- Read user's own posts (if they have permission)
- Basic member data access

**What Facebook Graph API CANNOT do easily:**
- Fetch public conversation threads
- Get comments/replies on public posts without special permissions
- Real-time conversation fetching (like Twitter)

**Workaround:**
- Use scraped data from Apify Facebook scrapers
- Match user's Facebook identity against author names in scraped data
- This provides engagement tracking without requiring Graph API for conversations

## Security Considerations

1. **State Parameter**: CSRF protection via state parameter
2. **Token Storage**: Tokens stored securely in database
3. **Scope**: Requests minimal necessary permissions (`public_profile`, `email`)
4. **HTTPS Required**: All redirect URIs should use HTTPS in production

## Testing

1. Add OAuth credentials to `.env`
2. Restart dev server
3. Go to Profile page
4. Click "Connect Facebook Account"
5. Complete OAuth flow
6. Verify connection status

## Troubleshooting

### "Facebook OAuth not configured"
- Check that `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` are set

### "Invalid redirect URI"
- Ensure redirect URI in Facebook app settings matches exactly
- Must use HTTPS in production (or localhost for development)
- Check that redirect URI is added in Facebook Login settings

### "App not approved"
- Facebook Login may require app review for certain permissions
- Basic `public_profile` and `email` scopes typically work without review
- If you need additional permissions, submit for app review

### Tokens not refreshing
- Facebook tokens don't have refresh tokens by default
- Users need to reconnect when tokens expire (typically 60 days)

## Comparison with Other Platforms

| Feature | Twitter | LinkedIn | Reddit | Facebook |
|---------|---------|----------|--------|----------|
| Fetch conversation threads | ✅ Yes | ❌ No | ✅ Yes | ❌ Limited |
| Real-time reply detection | ✅ Yes | ❌ No (uses scraped) | ✅ Yes | ❌ Limited (uses scraped) |
| Token refresh | ✅ Yes | ❌ No (60-day expiry) | ✅ Yes (1-hour expiry) | ❌ No (60-day expiry) |
| On-demand fetching | ✅ Yes | ❌ No | ✅ Yes | ❌ Limited |
| OAuth approval required | Optional | ✅ Required | Optional | Optional |

**Facebook Advantages:**
- OAuth available without special approval (unlike LinkedIn)
- Works with basic scopes (`public_profile`, `email`)
- Good for identity verification

**Facebook Limitations:**
- Graph API restrictions on public conversations
- Engagement tracking relies on scraped data
- No token refresh (60-day expiry)

## Example Usage in Code

```typescript
import { getFacebookAccessToken } from "@/lib/facebook-oauth";

// Get user's Facebook token
const token = await getFacebookAccessToken(userId);

if (token) {
  // Use token for authenticated requests
  const response = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
}
```

## Next Steps

1. Configure Facebook app in Developer Portal
2. Add environment variables
3. Test OAuth flow
4. Verify engagement tracking works with authenticated tokens
5. Monitor token expiration and user reconnection




