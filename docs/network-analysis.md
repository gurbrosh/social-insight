# Network Analysis Feature

## Overview

The Network Analysis tab identifies influential people across all platforms (Facebook, X/Twitter, LinkedIn, Reddit, Discord) based on the reactions they garnered. It uses OpenAI's GPT-4 to summarize the key ideas each person discussed.

## Features

### 1. Influential People Identification

The system automatically:
- Groups posts by author and platform
- Calculates total reactions (likes + comments + shares)
- Filters to show only individual people (excludes groups, subreddits, Discord channels, bots)
- Ranks people by total engagement

### 2. AI-Powered Idea Summarization

For each influential person:
- Analyzes their top posts (sorted by engagement)
- Uses OpenAI GPT-4o to extract distinct ideas
- Summarizes each idea in one sentence
- Displays multiple ideas if the person discussed different topics

### 3. Follow Functionality

Users can:
- Click "Follow" to add a person to their project's profiles list
- Followed profiles are saved in the `ProjectProfile` table
- Only individual people can be followed (not groups or channels)
- Followed profiles can be used in future scrapes as sources

### 4. Platform-Specific Handling

**LinkedIn:**
- Cannot extract profile URLs from post URLs
- Shows search link when "View" is clicked

**X/Twitter:**
- Extracts profile URLs from tweet URLs
- Direct profile links available

**Reddit:**
- Filters out subreddits (r/) and bots
- User profiles follow reddit.com/user/username format

**Facebook:**
- Filters out official pages and groups
- Uses author ID for profile identification

**Discord:**
- Filters out bots and webhooks
- Uses Discord user ID format

## Data Flow

1. **Query Posts**: Fetches posts from database filtered by project, date range, and platforms
2. **Group by Author**: Aggregates posts by platform + authorId combination
3. **Filter People**: Excludes non-individuals using heuristics
4. **Calculate Engagement**: Sums likes, comments, and shares
5. **Rank by Reactions**: Sorts by total engagement
6. **Summarize Ideas**: Sends top posts to OpenAI for analysis
7. **Display Results**: Shows table with platform, person, ideas, engagement, and actions

## Database Schema

### Posts Table
- `authorId`: Platform-specific user ID
- `authorName`: Display name/username
- `metricsLikes`: Number of likes/upvotes
- `metricsComments`: Number of comments/replies
- `metricsShares`: Number of shares/retweets
- `platform`: Source platform (facebook, linkedin, x, reddit, discord)
- `url`: Post URL (used to extract profile URLs)

### ProjectProfile Table
- `project_id`: Associated project
- `platform`: Platform name
- `name`: Person's display name
- `url`: Profile URL
- `type`: Always "person" for Network Analysis
- `is_selected`: Whether to use in scrapes (default: true)

## API Endpoints

### Server Actions

**`getProjectInfluentialPeople(projectId, options)`**
- Fetches influential people for a project
- Options: limit, platforms, dateRange, minReactions
- Returns: Array of InfluentialPerson objects with ideas

**`followProfile(projectId, profile)`**
- Adds a profile to project's profiles list
- Checks for duplicates
- Creates ProjectProfile record
- Returns: success status and profile ID

**`unfollowProfile(projectId, profileId)`**
- Soft deletes a profile from project
- Uses `deleted_at` field

**`isProfileFollowed(projectId, platform, authorId)`**
- Checks if a profile is already being followed
- Returns: boolean and profile ID if found

## OpenAI Integration

### Requirements
- `OPENAI_API_KEY` environment variable must be set
- Uses GPT-4o model for analysis
- Configurable base URL via `AppConfig` (api.openai_base_url)

### Prompt Engineering

The system uses a specialized prompt to:
- Focus on distinct ideas (not just topics)
- Prioritize ideas with high engagement
- Output one sentence per idea
- Return JSON array format
- Handle edge cases (no clear ideas)

### Rate Limiting

- Processes 3 people concurrently by default
- 1-second delay between batches
- Configurable via options

### Cost Considerations

- Uses gpt-4o model (~$0.01 per 1K tokens)
- Top 10 posts per person (up to 500 chars each)
- Approximately 1-2K tokens per person
- 50 people = $0.50-$1.00 typical cost

## Error Handling

1. **No OpenAI Key**: Shows fallback message "Ideas summary unavailable"
2. **API Errors**: Displays "Error summarizing ideas (API error)"
3. **Parsing Errors**: Shows "Error summarizing ideas (processing error)"
4. **No People Found**: Shows empty state with guidance
5. **Follow Errors**: Toast notification with error message

## Performance Optimization

1. **Batch Processing**: Analyzes multiple people in parallel
2. **Post Pruning**: Only sends top 10 posts per person to OpenAI
3. **Response Optimization**: Removes full post arrays before sending to client
4. **Caching**: Uses React state to avoid re-fetching on re-renders
5. **Optimistic Updates**: Immediately updates UI when following

## Filtering Logic

### Individual Person Detection

**Excluded:**
- Reddit: Subreddits (r/), AutoModerator, bots
- Discord: Bots, webhooks
- Facebook: Official pages, groups
- LinkedIn: LinkedIn official accounts
- X/Twitter: Bots, automated accounts

**Included:**
- Regular user accounts
- Individual profiles
- Personal pages

### Minimum Engagement Threshold

Default: 10 total reactions
- Prevents low-quality results
- Focuses on truly influential voices
- Configurable via options

## UI Components

### Table Columns

1. **Platform**: Badge with platform name and color
2. **Person**: Name + post count
3. **Key Ideas**: Bullet list of summarized ideas
4. **Engagement**: Breakdown of likes, comments, shares, total
5. **Action**: Follow button + optional View profile link

### Loading States

- Shows spinner with "Analyzing network data..." message
- Prevents interaction during loading
- Uses skeleton screens for better UX

### Empty States

- No data: Guidance to adjust filters
- No OpenAI key: Configuration instructions

## Future Enhancements

1. **Profile Enrichment**: Fetch profile images and bios
2. **Relationship Mapping**: Show connections between people
3. **Influence Score**: Calculate beyond just reactions
4. **Trend Detection**: Identify emerging voices over time
5. **Export Functionality**: Download influential people list
6. **Bulk Follow**: Follow multiple people at once
7. **Notification**: Alert when followed people post
8. **Historical Tracking**: Track influence changes over time

## Testing

### Manual Testing Checklist

- [ ] Load Network tab with data
- [ ] Verify people are ranked by engagement
- [ ] Check ideas are properly summarized
- [ ] Test Follow button functionality
- [ ] Verify View profile links work
- [ ] Test with no OpenAI key
- [ ] Test with no data
- [ ] Test date range filters
- [ ] Test platform filters
- [ ] Verify followed profiles appear in project sources

### Test Data Requirements

- Multiple posts from same author
- Posts with varying engagement levels
- Mix of platforms (Facebook, LinkedIn, X, Reddit, Discord)
- Authors with distinct ideas vs. single themes
- Edge cases (bots, groups, channels)

## Configuration

### AppConfig Settings

- `api.openai_base_url`: OpenAI API base URL (default: https://api.openai.com/v1)
- `performance.news_batch_size`: Batch size for processing (default: 20)
- `performance.news_batch_delay`: Delay between batches in ms (default: 2000)

### Environment Variables

- `OPENAI_API_KEY`: Required for idea summarization
- `DATABASE_URL`: Database connection string
- `NEXT_PUBLIC_APP_URL`: Application base URL

## Troubleshooting

### Issue: No people showing up

**Possible causes:**
- No posts in database
- All posts below minimum engagement threshold
- All authors filtered out as non-individuals
- Date range too restrictive

**Solution:**
- Lower minReactions threshold
- Expand date range
- Check source filters
- Verify data was scraped

### Issue: Ideas not loading

**Possible causes:**
- OPENAI_API_KEY not set
- API rate limit reached
- Network connectivity issues
- Invalid API key

**Solution:**
- Set OPENAI_API_KEY in .env
- Wait and retry (rate limits)
- Check network connection
- Verify API key is valid

### Issue: Follow button not working

**Possible causes:**
- Already following the profile
- Project not found
- User not authenticated
- Database connection issues

**Solution:**
- Check if profile already in project.profiles
- Verify user is signed in
- Check database connectivity
- Review server logs

## Security Considerations

1. **Authentication**: All actions require valid session
2. **Authorization**: Users can only access their own projects
3. **Input Validation**: Profile data validated before saving
4. **SQL Injection**: Prisma provides parameterized queries
5. **API Key Protection**: OpenAI key never exposed to client
6. **Rate Limiting**: Prevents OpenAI API abuse
7. **Soft Deletes**: Data never permanently removed
8. **CORS**: API endpoints protected by Next.js middleware

## Maintenance

### Regular Tasks

1. Monitor OpenAI API usage and costs
2. Review and update person filtering logic
3. Optimize summarization prompts for better results
4. Clean up old soft-deleted profiles
5. Update platform-specific URL extraction logic

### Monitoring Metrics

- Number of influential people per project
- OpenAI API success rate
- Average engagement per platform
- Follow/unfollow frequency
- Error rates by type

