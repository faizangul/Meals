# Meals

A phone-first web app for deciding what to cook: suggestions that learn from your ratings, portions you can resize with live macros, and estimated prices at ALDI, Coles and Woolworths.

- **Two modes.** Macro focus suggests meals that fit your targets and can resize portions to match. Casual goes on what you like, cost and time.
- **Ratings set the rhythm.** 5★ comes back about weekly, 4★ fortnightly, 3★ monthly, 2★ every couple of months, 1★ never.
- **Prices are estimates.** No supermarket offers a public price feed. Starting prices are dated estimates; the ones you type in replace them.
- **Everything stays on the device.** No accounts, no server.

This repo holds no recipes. Recipes load from a file you import in the app (`format: "meals-pack"`), so anything you have bought stays private to you.

Run locally: `python3 -m http.server` then open http://localhost:8000. Tests: `npm test`.
