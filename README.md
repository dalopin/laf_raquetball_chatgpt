# laf-raquetball-bot

This repository contains a Playwright-based bot that logs into https://lafitness.com/Pages/RacquetballReservation.aspx and books the furthest available day at the earliest time for the Irvine – Jamboree location (or whatever club name you provide).

IMPORTANT: make sure you are allowed to automate the LA Fitness member site. You are responsible for complying with their terms of service and any applicable laws.

## Quick start (local)

1. Install dependencies and the bundled Chromium that Playwright uses.

   ```bash
   npm ci
   npx playwright install --with-deps chromium
   ```

2. Set the required environment variables. Example:

   ```bash
   export RB_USER="dalopin2"
   export RB_PASS="dalopin1"
   export LOCATION_NAME="IRVINE - JAMBOREE"
   export COURT_NUMBER="2"
   export LOCATION_ZIP="92780"   # used when the bot needs to search for the club
   export DURATION_MINUTES="60"   # optional, defaults to 60
   ```

3. Run the bot.

   ```bash
   node src/bot.js
   ```

The script opens the reservation page, logs in, switches to the requested club (using the zip code search dialog), selects the furthest available date, chooses the earliest time on that day, prefers the requested court number, and clicks “Save Reservation”. Logs are printed with timestamps so you can follow along.

### Environment variables

| Name | Description |
| --- | --- |
| `RB_USER` / `RB_PASS` | LA Fitness member credentials used on the login form. |
| `LOCATION_NAME` | Club label exactly as it appears in the reservation UI (defaults to `IRVINE - JAMBOREE`). |
| `LOCATION_ZIP` | Zip code used in the “Change Club” search dialog (defaults to `92780`). |
| `COURT_NUMBER` | Preferred court number (defaults to `2`). |
| `DURATION_MINUTES` | Length shown in the duration dropdown. The bot leaves the current value if the option is unavailable. |
| `RESERVATION_URL` | Override if LA Fitness changes the reservation URL. |
| `HEADLESS` | Set to `false` to watch the browser while debugging locally. |

### How the automation works

1. Navigate to the reservation page and accept the cookie banner if it appears.
2. Fill the login form (`#txtUser`, `#txtPassword`) and wait until the reservation controls load.
3. If the page is not already filtered to `LOCATION_NAME`, click “Change Club”, search by `LOCATION_ZIP`, and click the matching result before confirming the selection.
4. Select the furthest date available in `#ddlDates` and the earliest time in `#cboSearByTimeList`.
5. Pick the requested court from `#cboCourtByTime` when it exists, otherwise fall back to the first court in the list.
6. Press “Save Reservation” and wait for the confirmation banner.

## Render.com deployment

Render Cron Jobs can run this script on a schedule (for example, every morning when new slots are released).

1. Connect your GitHub repo to Render and create a **Cron Job**.
2. Build command:

   ```bash
   npm ci && npx playwright install --with-deps chromium
   ```

3. Start command:

   ```bash
   node src/bot.js
   ```

4. Set a cron expression (Render interprets it in UTC). Example: `0 14 * * *` runs at 6 AM Pacific.
5. Add the same environment variables as in local development using Render’s Secret/File editor (RB_USER, RB_PASS, LOCATION_NAME, LOCATION_ZIP, COURT_NUMBER, etc.).

Tips for Render:
- Keep the schedule realistic (booking windows typically open early in the morning, local time).
- Enable “Region: Oregon” (or wherever you normally log in) to reduce the chance of extra security prompts.
- If Render reports missing system libraries, re-run the job once after bumping Playwright (`npx playwright install --with-deps chromium`).

## Troubleshooting & caveats

- Playwright emulates a real Chromium browser, but LA Fitness can still change the DOM at any time. When selectors change, update `src/bot.js` accordingly.
- If your account already holds the maximum number of reservations allowed, the site rejects new bookings. Check the “Future Court Reservation(s)” table to confirm.
- CAPTCHA or MFA prompts cannot be automated. If the site introduces extra verification, the bot will stop.
- Always respect LA Fitness policies—this script is for personal use. Do not resell access or spam the reservation system.
