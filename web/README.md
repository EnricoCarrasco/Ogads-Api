# OGAds Offers Web App

A focused Next.js application that showcases CPI and CPA offers from OGAds filtered to the end user's location and device. The app consumes the Offer API, detects a visitor's country plus platform, and renders a polished offer gallery.

## Prerequisites

- Node.js 18.18+ or 20+
- npm 9+
- An active OGAds Offer API key with the Offer API feature enabled

## Environment Variables

Create a local environment file before running the project:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and insert your OGAds API key (the example URL can remain unless your affiliate manager provided a different endpoint).

```
OGADS_API_URL=https://lockedapp.org/api/v2
OGADS_API_KEY=35119|xYdCWGxYIPmBfDkvdmBzTOQIskZfbteXXdSWrWLq11e9e821
```

Never commit your real API key to version control.

## Installation

From the `web` directory install dependencies:

```bash
npm install
```

## Development

Start the development server (Turbopack is enabled for quicker iteration):

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) to interact with the UI. The command will hot-reload changes in the browser.

## How It Works

- **Location detection**: the browser fetches coarse geolocation data from `ipapi.co` to obtain IP, city, region, and ISO country code. No precise GPS data is requested.
- **Device detection**: we parse the browser user agent client-side to classify the visitor as desktop or mobile, and to differentiate Android vs iOS when on mobile.
- **Offer fetching**: the client calls `/api/offers`, which proxies OGAds' Offer API, forwards the real visitor IP (captured server-side) and user agent, and requests `ctype=0` so OGAds returns every type. The API key is sent via the `Authorization: Bearer <key>` header.
- **Filtering**: responses are normalized and filtered by country first, then by OGAds' `ctype`/`device` metadata so that Android visitors only see Android CPI campaigns, iOS visitors see iOS CPI campaigns, and desktop visitors only see desktop CPA offers.
- **Caching**: the proxy caches filtered offer sets for 10 minutes per `(country, device)` combination to respect OGAds rate limits while keeping the feed responsive.
- **UI**: responsive cards with payout, device targeting, and EPC data, plus graceful loading/error states and manual refresh.

## Useful Commands

- `npm run dev` – run the development server
- `npm run build` – create an optimized production build
- `npm run start` – serve the production build
- `npm run lint` – lint the project using the Next.js/ESLint config

## Notes

- Remote offer artwork is loaded directly via `<img>` tags to avoid additional image configuration. A branded SVG placeholder fills in when artwork is missing or fails to load.
- OGAds' `device` field is a comma-separated list (e.g. `Android, iPhone, Desktop`) and the proxy route uses those tags to filter offers after they are returned, guaranteeing the UI only shows campaigns eligible for the detected platform.
- If you need stricter caching or rate limiting, wrap the OGAds fetch in an additional caching layer (Redis, Upstash, or KV) within the `/api/offers` route.
