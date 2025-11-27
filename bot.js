const { chromium } = require('playwright');

const RESERVATION_URL = process.env.RESERVATION_URL || 'https://lafitness.com/Pages/RacquetballReservation.aspx';
const USER = process.env.RB_USER;
const PASS = process.env.RB_PASS;
const LOCATION_NAME = (process.env.LOCATION_NAME || 'IRVINE - JAMBOREE').trim();
const ZIP_CODE = process.env.LOCATION_ZIP || '92780';
const COURT_NUMBER = process.env.COURT_NUMBER ? Number(process.env.COURT_NUMBER) : 2;
const DURATION_MINUTES = process.env.DURATION_MINUTES || '60';
const HEADLESS = process.env.HEADLESS !== 'false';

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function acceptCookies(page) {
  const cookieSelectors = ['#onetrust-accept-btn-handler', 'button:has-text("Accept All Cookies")'];
  for (const sel of cookieSelectors) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      await btn.click().catch(() => {});
      log('Accepted cookie banner');
      break;
    }
  }
}

async function ensureLoggedIn(page) {
  if (!USER || !PASS) {
    console.error('RB_USER and RB_PASS environment variables are required.');
    process.exit(1);
  }

  await page.goto(RESERVATION_URL, { waitUntil: 'domcontentloaded' });
  await acceptCookies(page);

  const userInput = await page.$('#txtUser');
  if (userInput) {
    log('Logging in...');
    await page.fill('#txtUser', USER);
    await page.fill('#txtPassword', PASS);
    const loginButton = '#ctl00_MainContent_Login1_btnLogin';
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
      page.click(loginButton)
    ]);
    await page.waitForTimeout(1000);
  }

  await page.goto(RESERVATION_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ddlDates', { timeout: 20000 });
}

async function ensureLocation(page) {
  const label = await page.$('#lblSelectClub');
  const current = label ? (await label.innerText()).trim() : '';
  if (current.toLowerCase().includes(LOCATION_NAME.toLowerCase())) {
    log('Already on desired club:', current);
    return;
  }

  log('Attempting to change club from', current || 'unknown', 'to', LOCATION_NAME);
  const changeLink = await page.$('#btnChangeClub');
  if (!changeLink) {
    log('Change Club link not found; proceeding with current club.');
    return;
  }

  await changeLink.click();
  await page.waitForTimeout(500);

  const zipInput = await page.waitForSelector('#txtZipCode, input[name="ctl00$MainContent$txtZipCode"], input[placeholder*="Zip"]', { timeout: 5000 }).catch(() => null);
  if (!zipInput) {
    log('Zip code input for club search not found.');
    return;
  }

  await zipInput.fill(ZIP_CODE);
  const findButton = await page.$('#btnFindclub, input[value="Find Club"], button:has-text("Find Club")').catch(() => null);
  if (findButton) {
    await findButton.click().catch(() => {});
  }

  const clubRow = await page.locator(`#gvClubList tr:has-text("${LOCATION_NAME}")`).first();
  if (await clubRow.count()) {
    const selectButton = clubRow.locator('input[type="submit"], button').filter({ hasText: /select/i }).first();
    if (await selectButton.count()) {
      await selectButton.click().catch(() => {});
    } else {
      await clubRow.click().catch(() => {});
    }
  } else {
    const fallback = await page.getByText(LOCATION_NAME, { exact: false }).first().catch(() => null);
    if (fallback) await fallback.click().catch(() => {});
  }

  const confirmButton = await page.$('#btnSelectClub, input[value="Select"], button:has-text("Select Club")').catch(() => null);
  if (confirmButton) {
    await confirmButton.click().catch(() => {});
  }

  await page.waitForFunction(
    (selector, name) => {
      const el = document.querySelector(selector);
      return !!el && el.textContent && el.textContent.toLowerCase().includes(name.toLowerCase());
    },
    '#lblSelectClub',
    LOCATION_NAME,
    { timeout: 10000 }
  ).catch(() => log('Club label did not update in time; continuing.'));
}

async function selectFurthestDate(page) {
  const options = await page.$$eval('#ddlDates option', opts => opts.map(o => ({ value: o.value, text: (o.textContent || '').trim() })).filter(o => o.value));
  if (!options.length) throw new Error('No date options available');
  const furthest = options[options.length - 1];
  log('Selecting date:', furthest.text, `(${furthest.value})`);
  await page.selectOption('#ddlDates', furthest.value);
  await page.waitForTimeout(1500);
  return furthest;
}

async function ensureDuration(page) {
  const durationOptions = await page.$$eval('#ddlDuration option', opts => opts.map(o => o.value));
  if (durationOptions.includes(String(DURATION_MINUTES))) {
    await page.selectOption('#ddlDuration', String(DURATION_MINUTES));
  }
}

async function selectEarliestTime(page) {
  const times = await page.$$eval('#cboSearByTimeList option', opts => opts.map(o => ({ value: o.value, text: (o.textContent || '').trim() }))); 
  if (!times.length) throw new Error('No time slots available');
  const chosen = times[0];
  log('Selecting time:', chosen.text);
  await page.selectOption('#cboSearByTimeList', chosen.value);
  await page.waitForTimeout(1000);
  return chosen;
}

function matchesCourt(text, courtNumber) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return normalized.includes(`court ${courtNumber}`) || normalized.includes(`#${courtNumber}`) || normalized.trim().endsWith(`${courtNumber}`);
}

async function selectCourt(page) {
  const courtOptions = await page.$$eval('#cboCourtByTime option', opts => opts.map(o => ({ value: o.value, text: (o.textContent || '').trim() }))); 
  if (!courtOptions.length) throw new Error('No court drop-down options');
  let desired = courtOptions.find(o => matchesCourt(o.text, COURT_NUMBER));
  if (!desired) {
    desired = courtOptions[0];
    log('Desired court', COURT_NUMBER, 'not available, falling back to', desired.text);
  } else {
    log('Selecting court:', desired.text);
  }
  await page.selectOption('#cboCourtByTime', desired.value);
  await page.waitForTimeout(500);
  return desired;
}

async function saveReservation(page) {
  log('Submitting reservation...');
  const statusLocator = page.locator('#divUpdateStatus');
  const [result] = await Promise.all([
    statusLocator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    page.click('#btnSaveReservation').catch(() => { throw new Error('Click Save Reservation failed'); })
  ]);
  if (result) {
    const text = await statusLocator.innerText();
    log('Status message:', text.trim());
    return /saved/i.test(text);
  }
  const possibleAlert = await page.evaluate(() => window._lafLastAlert || null);
  if (possibleAlert) {
    log('Server alert:', possibleAlert);
  }
  return false;
}

async function main() {
  log('Launching Chromium (headless=', HEADLESS, ')');
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', async dialog => {
    log('Browser dialog:', dialog.message());
    await dialog.accept().catch(() => {});
  });
  let exitCode = 0;

  try {
    await ensureLoggedIn(page);
    await ensureLocation(page);
    await ensureDuration(page);
    const date = await selectFurthestDate(page);
    const time = await selectEarliestTime(page);
    const court = await selectCourt(page);
    log('Target slot =>', date.text, time.text, court.text);
    const saved = await saveReservation(page);
    if (!saved) {
      log('Reservation may not have been saved; please verify manually.');
      exitCode = 2;
    }
  } catch (err) {
    exitCode = 3;
    console.error('Unhandled error:', err);
  } finally {
    await browser.close();
    process.exit(exitCode);
  }
}

main();
