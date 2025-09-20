# OGAds API Integration Documentation

This document provides comprehensive instructions for integrating OGAds Offer API and postback system with LumaLoot.

## Table of Contents

1. [Getting Started](#getting-started)
2. [API Key Setup](#api-key-setup)
3. [Offer API Integration](#offer-api-integration)
4. [Click Tracking](#click-tracking)
5. [Postback Configuration](#postback-configuration)
6. [Security & Validation](#security--validation)
7. [Testing](#testing)
8. [Error Handling](#error-handling)

## Getting Started

### Prerequisites

- Active OGAds affiliate account
- Approved domain for tracking links
- HTTPS endpoint for postback receiving

### Account Setup

1. Login to your OGAds dashboard
2. Navigate to **Offer API** section
3. Generate your API key
4. Configure your postback URL
5. Set up IP allowlisting for security

## API Key Setup

### Generating API Key

1. Go to your OGAds dashboard
2. Click on **Offer API** in the navigation
3. Click **Generate API Key** button
4. Copy and store the generated key securely

### Environment Configuration

```bash
OGADS_API_KEY=your_generated_api_key_here
OGADS_AFFILIATE_ID=your_affiliate_id
POSTBACK_SHARED_SECRET=your_optional_secret_key
```

## Offer API Integration

### Fetching Offers

OGAds provides a RESTful API to fetch available offers. The exact endpoint will be provided in your affiliate dashboard.

#### Basic Request Structure

```javascript
const fetchOffers = async () => {
  try {
    const response = await fetch(`${OGADS_API_ENDPOINT}?api_key=${API_KEY}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LumaLoot/1.0'
      }
    });

    const offers = await response.json();
    return offers;
  } catch (error) {
    console.error('Failed to fetch offers:', error);
    throw error;
  }
};
```

#### Offer Data Structure

Each offer typically contains:

```typescript
interface OGAdsOffer {
  offer_id: string;
  name: string;
  description: string;
  payout: number;
  currency: string;
  countries: string[];
  device_types: string[];
  category: string;
  conversion_flow: string;
  epc: number; // Earnings per click
  cr: number;  // Conversion rate
  requirements: string;
  preview_url: string;
  tracking_url: string;
}
```

### Caching Strategy

Implement server-side caching to reduce API calls:

```javascript
// Cache offers for 15 minutes
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

export async function getCachedOffers() {
  const cacheKey = 'ogads_offers';
  let offers = cache.get(cacheKey);

  if (!offers) {
    offers = await fetchOffers();
    cache.set(cacheKey, offers, CACHE_DURATION);
  }

  return offers;
}
```

## Click Tracking

### Tracking URL Structure

When a user clicks an offer, create a tracking click record and redirect with proper subids:

```javascript
// Click tracking endpoint: /api/track
export async function handleOfferClick(req, res) {
  const { offerId, userId } = req.query;

  // Generate unique click ID
  const clickId = generateUUID();

  // Store click record
  await prisma.click.create({
    data: {
      id: clickId,
      userId: userId,
      offerId: offerId,
      ip: getClientIP(req),
      userAgent: req.headers['user-agent'],
      deviceFingerprint: req.headers['x-device-fingerprint'],
      createdAt: new Date()
    }
  });

  // Build OGAds tracking URL with subids
  const trackingUrl = buildTrackingUrl(offerId, {
    aff_sub: clickId,      // Our unique click ID
    aff_sub2: userId,      // User ID for reference
    aff_sub3: 'lumaloot',  // App identifier
    aff_sub4: getClientIP(req), // IP for validation
    aff_sub5: Date.now().toString() // Timestamp
  });

  res.redirect(302, trackingUrl);
}

function buildTrackingUrl(offerId, subids) {
  const baseUrl = `https://offers.ogads.com/click/${offerId}`;
  const params = new URLSearchParams({
    aff_id: process.env.OGADS_AFFILIATE_ID,
    ...subids
  });

  return `${baseUrl}?${params.toString()}`;
}
```

### Click Record Schema

```sql
CREATE TABLE clicks (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  offer_id VARCHAR(50) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  device_fingerprint VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## Postback Configuration

### Setting Up Postback URL

In your OGAds dashboard, configure your postback URL:

```
https://yourdomain.com/api/postback?offer_id={offer_id}&payout={payout}&click_id={aff_sub}&user_id={aff_sub2}&ip={session_ip}&datetime={datetime}
```

### Postback Parameters

OGAds sends these parameters in postbacks:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `{offer_id}` | ID of the completed offer | "12345" |
| `{offer_name}` | Name of the offer | "Mobile Game Install" |
| `{affiliate_id}` | Your affiliate ID | "67890" |
| `{session_ip}` | User's IP address | "192.168.1.1" |
| `{payout}` | Payout amount in USD | "1.50" |
| `{date}` | Conversion date | "2025-01-20" |
| `{time}` | Conversion time | "14:30:25" |
| `{datetime}` | Full datetime | "2025-01-20 14:30:25" |
| `{session_timestamp}` | Unix timestamp | "1737382225" |
| `{aff_sub}` | Your click ID | "uuid-click-id" |
| `{aff_sub2}` | User ID | "user-123" |
| `{aff_sub3}` | App identifier | "lumaloot" |
| `{aff_sub4}` | Session IP | "192.168.1.1" |
| `{aff_sub5}` | Additional data | "timestamp" |
| `{ran}` | Random number | "891234" |

### Postback Handler Implementation

```javascript
// Postback endpoint: /api/postback
export async function handlePostback(req, res) {
  try {
    // Extract parameters
    const {
      offer_id,
      payout,
      click_id,
      user_id,
      ip,
      datetime
    } = req.query;

    // Validate required parameters
    if (!offer_id || !payout || !click_id) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate IP (optional but recommended)
    if (!isValidOGAdsIP(req.ip)) {
      return res.status(403).json({ error: 'Invalid source IP' });
    }

    // Find or create click record
    let click = await prisma.click.findUnique({
      where: { id: click_id }
    });

    if (!click) {
      // Create orphaned click record for tracking
      click = await prisma.click.create({
        data: {
          id: click_id,
          userId: user_id,
          offerId: offer_id,
          ip: ip,
          userAgent: 'Unknown (Orphaned)',
          createdAt: new Date(datetime || Date.now())
        }
      });
    }

    // Check for duplicate conversion
    const existingConversion = await prisma.conversion.findUnique({
      where: {
        clickId: click_id
      }
    });

    if (existingConversion) {
      return res.status(200).json({
        message: 'Conversion already processed',
        conversionId: existingConversion.id
      });
    }

    // Calculate points (100 points per USD)
    const points = Math.floor(parseFloat(payout) * 100);

    // Create conversion and update user balance in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create conversion record
      const conversion = await tx.conversion.create({
        data: {
          id: `ogads-${offer_id}-${click_id}`,
          clickId: click_id,
          userId: user_id,
          offerId: offer_id,
          payoutUsd: parseFloat(payout),
          points: points,
          approved: true,
          createdAt: new Date()
        }
      });

      // Update user balance
      await tx.user.update({
        where: { id: user_id },
        data: {
          balance: {
            increment: points
          }
        }
      });

      return conversion;
    });

    // Log successful postback
    console.log(`Postback processed: ${click_id} -> ${points} points`);

    return res.status(200).json({
      message: 'Postback processed successfully',
      conversionId: result.id,
      points: points,
      userId: user_id
    });

  } catch (error) {
    console.error('Postback processing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

## Security & Validation

### IP Allowlisting

OGAds typically sends postbacks from specific IP ranges. Configure these in your environment:

```javascript
const OGADS_IPS = [
  '185.199.108.0/22',
  '185.199.109.0/24',
  // Add OGAds IP ranges as provided
];

function isValidOGAdsIP(clientIP) {
  return OGADS_IPS.some(range => {
    return ipRangeCheck(clientIP, range);
  });
}
```

### Signature Verification (Optional)

If OGAds provides signature verification:

```javascript
function verifySignature(params, signature, secret) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(sortedParams)
    .digest('hex');

  return signature === expectedSignature;
}
```

### Idempotency

Ensure postbacks are processed only once:

```javascript
// Use unique constraint on (offer_id + click_id) or (click_id)
// to prevent duplicate conversions
const conversionId = `${offer_id}-${click_id}`;
```

## Testing

### Postback Simulator

OGAds provides a postback simulator in your dashboard:

1. Go to your OGAds dashboard
2. Navigate to "Postback Simulator"
3. Enter test parameters
4. Verify your endpoint receives and processes the test postback

### Test Checklist

- [ ] API key authentication works
- [ ] Offers are fetched and cached properly
- [ ] Click tracking creates records correctly
- [ ] Tracking URLs redirect properly
- [ ] Postback endpoint responds with 200 OK
- [ ] Conversions are not duplicated
- [ ] User balances update correctly
- [ ] IP validation works (if implemented)
- [ ] Error handling works for invalid requests

### Manual Testing

```bash
# Test postback endpoint
curl -X GET "https://yourdomain.com/api/postback?offer_id=123&payout=1.50&click_id=test-click&user_id=test-user&ip=127.0.0.1&datetime=2025-01-20%2014:30:25"
```

## Error Handling

### Common Issues

1. **Invalid API Key**: Check your environment variables
2. **IP Rejected**: Verify IP allowlisting configuration
3. **Duplicate Conversions**: Ensure proper idempotency checks
4. **Missing Parameters**: Validate required postback parameters
5. **Database Errors**: Handle connection and constraint issues

### Error Response Format

```javascript
// Always return structured error responses
{
  "error": "Description of the error",
  "code": "ERROR_CODE",
  "timestamp": "2025-01-20T14:30:25Z"
}
```

### Logging

Implement comprehensive logging for debugging:

```javascript
// Log all postback attempts
console.log({
  type: 'postback_received',
  clickId: click_id,
  offerId: offer_id,
  payout: payout,
  ip: req.ip,
  timestamp: new Date().toISOString()
});
```

## Support

For OGAds-specific issues:
- Contact OGAds support through your affiliate dashboard
- Use the postback simulator for testing
- Check the OGAds documentation in your dashboard

For LumaLoot implementation issues:
- Review the implementation guide
- Check server logs for errors
- Verify database schema matches requirements

Offer Response Example

In this example we set ctype to 1 which will bring back CPI offers only.
Not including ctype or setting it to 0 will return all offer types (CPI, CPA, PIN, etc).

Attention! API requests must include an Authorization header for security reasons.
You will not be able to open the URL using your browser.

Example URL

https://lockedapp.org/api/v2?ip=23.45.21.76&user_agent=Mozilla%2F5.0%20(X11%3B%20Linux%20x86_64)%20AppleWebKit
%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F77.0.3865.90%20Safari%2F537.36&ctype=1
{
    "success": true,
    "error": null,
    "offers": [
        {
            "offerid": 9164,
            "name": "Final Fantasy XV - CPE tutorial (Android, Free, INCENT, US, 156MB, 5.0)",
            "name_short": "Final Fantasy XV",
            "description": "<\/b>Be the hero of your own Final Fantasy XV adventure in the brand new mobile strategy game Final Fantasy XV: A New Empire! Build your own kingdom, discover powerful magic, and dominate the realm alongside all of your friends!
            \r\nConversion: <\/b>Install, Open, & Tutorial Complete
            \r\nTraffic Restrictions:<\/b> Custom Creatives; Incentivized Traffic; Adult Traffic; Push Notification Traffic; Ads Icon Traffic; SMS Traffic; Discovery App Traffic; Instagram\/Twitter Traffic
            \r\n Targeting: <\/b>OS 5.0+
            \r\n",
            "adcopy": "Download, install and complete the tutorial to unlock this content.",
            "picture": "https:\/\/media.go2speed.org\/brand\/files\/ogmobi\/9164\/thumbnails_100\/Final.Fantasy.Animated.gif",
            "payout": "0.39",
            "country": "US",
            "device": "Android",
            "link": "http:\/\/jump.ogtrk.net\/aff_c?aff_id=1026&offer_id=9164",
            "epc": "0.16220"
        },
        {
            "offerid": 2993,
            "name": "Castle Clash - (Android, Free, INCENT, US, 113M)",
            "name_short": "Castle Clash",
            "description": "Build and battle your way to glory in Castle Clash! With over 100 million clashers worldwide, the heat is on in the most addictive game ever! In a brilliant mix of fast-paced strategy and exciting combat, Castle Clash is a game of epic proportions! Hire legions of powerful Heroes and lead an army of mythical creatures, big and small. Fight to the top and become the world\u2019s greatest Warlord. Your empire is as strong as your creativity!",
            "adcopy": "Download and install this app then run it for 30 seconds to unlock this content.",
            "picture": "https:\/\/media.go2speed.org\/brand\/files\/ogmobi\/2993\/thumbnails_100\/20171005125303-castleclashbravesquadsnew.png",
            "payout": "0.34",
            "country": "US",
            "device": "Android",
            "link": "http:\/\/jump.ogtrk.net\/aff_c?aff_id=1026&offer_id=2993",
            "epc": "0.14296"
        },
        {
            "offerid": 15696,
            "name": "AliExpress - (Android, Free, INCENT, UK,ES,RU,NL,US,CZ,IT,FR,DE, 9M)",
            "name_short": "AliExpress",
            "description": "<\/b>Ever wanted to shop everything in one place, at one time? We\u2019ve created just the app for you! With thousands of brands and millions of products at an incredible value, AliExpress is the go-to app for those in the know.
            \r\nConversion:<\/b> Install & Open.
            \r\nTraffic Restrictions:<\/b> Custom Creatives; Adult Traffic; Push Notification Traffic; Ads Icon Traffic; SMS Traffic; Instagram\/Twitter Traffic
            \r\n",
            "adcopy": "Download and install this app, then run it for 30 seconds to unlock this content.",
            "picture": "https:\/\/media.go2speed.org\/brand\/files\/ogmobi\/15696\/thumbnails_100\/thumbnail-3348293455ab55884094838.07934089.png",
            "payout": "0.22",
            "country": "CZ,FR,DE,IT,NL,RU,ES,UK,US",
            "device": "Android",
            "link": "http:\/\/jump.ogtrk.net\/aff_c?aff_id=1026&offer_id=15696",
            "epc": "0.14196"
        },
        {
            "offerid": 5930,
            "name": "AppMatch Survey - Incent, UK\/CA, Dynamic Payout!",
            "name_short": "AppMatch Survey",
            "description": "",
            "adcopy": "Match your interests to the best apps available and unlock your content!",
            "picture": "https:\/\/media.go2speed.org\/brand\/files\/ogmobi\/5930\/thumbnails_100\/mobilesurvey.png",
            "payout": "0.28",
            "country": "AU,CA,UK,US",
            "device": "iPhone,Android",
            "link": "http:\/\/jump.ogtrk.net\/aff_c?aff_id=1026&offer_id=5930",
            "epc": "0.11598"
        }
    ]
}

Ogads Api Key  : 35119|xYdCWGxYIPmBfDkvdmBzTOQIskZfbteXXdSWrWLq11e9e821
