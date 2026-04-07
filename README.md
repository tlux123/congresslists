# Meet Congress Lists

Small local app that turns Market Aggregator people and market data into ranked congressional/candidate lists.

## Run

```powershell
cd C:\Users\tanne\meet-congress-lists
npm start
```

Open `http://localhost:3001`.

## Included lists

- Oldest candidates
- Youngest candidates
- Candidates with the lowest market odds
- Incumbents with the weakest re-election-looking market setup
- Women candidates

## Important note

The current API shape does not expose an explicit LGBTQ/sexual orientation field. The app states that directly rather than inferring a sensitive attribute from bios or names.
## Deploy on Vercel

This project can be deployed on Vercel using the included `api/lists.js` serverless function and static files from `public/`.

Set `MARKET_AGGREGATOR_API_KEY` in the Vercel project environment variables if you want live data refreshes. Without it, the app will fall back to the checked-in snapshot in `data/lists-cache.json`.
