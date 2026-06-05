# LinkedIn OAuth 2.0 Integration

## Overview

This implementation allows users to connect their LinkedIn accounts for identity verification and engagement tracking.

## Important Limitations

**LinkedIn API Restrictions:**
- LinkedIn's API **does NOT support fetching public conversation threads/comments** like Twitter does
- You cannot fetch replies or comments on public posts via LinkedIn API
- Engagement tracking for LinkedIn relies on **scraped data from your database** (from Apify scrapers)
- LinkedIn OAuth is mainly useful for:
  - Identity verification (matching user's LinkedIn profile to replies in scraped data)
  - Getting user's own profile information
  - Better identity matching in engagement tracking

## Architecture

### Key Components

1. **OAuth Flow**: LinkedIn OAuth 2.0 Authorization Code Flow (standard, no PKCE needed)
2. **Token Storage**: Uses existing `Account` model with `provider: "linkedin-api"`
3. **Identity Matching**: Stores LinkedIn profile URL in `UserPlatformIdentity` for reply detection

### Database

- **Account Model**: Stores OAuth tokens (access_token, expires_at)
- **UserPlatformIdentity**: Stores LinkedIn profile URL for identity matching

## Setup Required

### 1. Create LinkedIn App

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
2. Click **"Create app"**
3. Fill in app details:
   - **App name**: Your app name
   - **LinkedIn Page**: (Optional) Your LinkedIn company page
   - **App logo**: (Optional)
   - Accept the legal agreement

### 2. Configure OAuth Settings

1. In your app dashboard, go to **"Auth"** tab
2. Note your **Client ID** and **Client Secret**
3. Under **"OAuth 2.0 settings"**, add redirect URLs:
   - Development: `http://localhost:3007/api/auth/linkedin/callback`
   - Production: `https://yourdomain.com/api/auth/linkedin/callback`
4. Request access to **"Sign In with LinkedIn"** product:
   - Go to **"Products"** tab
   - Request access to "Sign In with LinkedIn using OpenID Connect"
   - Wait for approval (usually instant for basic permissions)

### 3. Environment Variables

Add to your `.env` file or CrunchyCone settings:

```bash
# LinkedIn OAuth 2.0 (for user connections)
LINKEDIN_CLIENT_ID=your_client_id_here
LINKEDIN_CLIENT_SECRET=your_client_secret_here

# Optional: Custom redirect URI (defaults to NEXT_PUBLIC_APP_URL + /api/auth/linkedin/callback)
LINKEDIN_OAUTH_REDIRECT_URI=https://yourdomain.com/api/auth/linkedin/callback
```

## User Flow

1. User goes to Profile page
2. Clicks "Connect LinkedIn Account" (only visible if OAuth is configured)
3. Redirected to LinkedIn authorization
4. User authorizes the app
5. Redirected back to app with tokens
6. Tokens stored in `Account` table
7. Profile URL stored in `UserPlatformIdentity`

## API Endpoints

### `/api/auth/linkedin/authorize`
- **Method**: GET
- **Auth**: Required
- **Returns**: Authorization URL
- **Purpose**: Initiates OAuth flow

### `/api/auth/linkedin/callback`
- **Method**: GET
- **Query Params**: `code`, `state`
- **Purpose**: Handles OAuth callback, exchanges code for tokens

### `/api/auth/linkedin/disconnect`
- **Method**: POST
- **Auth**: Required
- **Purpose**: Disconnects user's LinkedIn account

## Token Management

### Token Expiration

- LinkedIn access tokens typically last **60 days**
- Tokens do not have refresh tokens by default
- When expired, users need to reconnect

### Token Usage

LinkedIn tokens are used for:
- Identity verification (matching user's LinkedIn profile)
- Profile data retrieval
- **NOT for fetching conversation threads** (LinkedIn API limitation)

## Integration Points

### Engagement Tracking

- LinkedIn engagement tracking relies on **scraped data from database**
- OAuth tokens are used for **identity matching** (identifying user's replies in scraped data)
- Unlike Twitter, LinkedIn doesn't support on-demand conversation fetching

### User Identities

- When user connects LinkedIn, their profile URL is automatically added to `UserPlatformIdentity`
- Used for reply detection matching in scraped conversation data

## LinkedIn API Limitations

**What LinkedIn API CAN do:**
- Get user's profile information
- Read user's own posts (if they have permission)
- Basic member data access

**What LinkedIn API CANNOT do:**
- Fetch public conversation threads
- Get comments/replies on public posts
- Real-time conversation fetching (like Twitter)

**Workaround:**
- Use scraped data from Apify LinkedIn scrapers
- Match user's LinkedIn identity against author names in scraped data
- This provides engagement tracking without requiring LinkedIn API for conversations

## Security Considerations

1. **State Parameter**: CSRF protection via state parameter
2. **Token Storage**: Tokens stored securely in database
3. **Scope**: Requests minimal necessary permissions (`r_liteprofile`, `r_emailaddress`, `w_member_social`)
4. **HTTPS Required**: All redirect URIs must use HTTPS in production

## Testing

1. Add OAuth credentials to `.env`
2. Restart dev server
3. Go to Profile page
4. Click "Connect LinkedIn Account"
5. Complete OAuth flow
6. Verify connection status

## Troubleshooting

### "LinkedIn OAuth not configured"
- Check that `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are set

### "Invalid redirect URI"
- Ensure redirect URI in LinkedIn app settings matches exactly
- Must use HTTPS in production (or localhost for development)

### "Product not approved"
- Request access to "Sign In with LinkedIn" product in LinkedIn Developer Portal
- Wait for approval (usually instant)

### Tokens not refreshing
- LinkedIn tokens don't have refresh tokens by default
- Users need to reconnect when tokens expire (typically 60 days)

## Comparison with Twitter

| Feature | Twitter | LinkedIn |
|---------|--------|----------|
| Fetch conversation threads | ✅ Yes | ❌ No |
| Real-time reply detection | ✅ Yes | ❌ No (uses scraped data) |
| Identity verification | ✅ Yes | ✅ Yes |
| Token refresh | ✅ Yes | ❌ No (60-day expiry) |
| On-demand fetching | ✅ Yes | ❌ No |

**Conclusion**: LinkedIn OAuth is useful for identity verification, but engagement tracking relies on scraped database data rather than real-time API fetching.




