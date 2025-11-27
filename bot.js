const { chromium } = require('playwright');

const RESERVATION_URL = process.env.RESERVATION_URL || 'https://lafitness.com/Pages/RacquetballReservation.aspx';
const USER = process.env.RB_USER;
const PASS = process.env.RB_PASS;
const LOCATION_NAME = (process.env.LOCATION_NAME || 'IRVINE - JAMBOREE').trim();
const USER = process.env.RB_USER || 'dalopin2';
const PASS = process.env.RB_PASS || 'dalopin1';
const HEADLESS = process.env.HEADLESS !== 'false';
const ZIP_CODE = process.env.LOCATION_ZIP || '92780';
const COURT_NUMBER = process.env.COURT_NUMBER ? Number(process.env.COURT_NUMBER) : 2;
const DURATION_MINUTES = process.env.DURATION_MINUTES || '60';
const HEADLESS = process.env.HEADLESS !== 'false';
const PREFERRED_COURT = process.env.COURT_NUMBER ? Number(process.env.COURT_NUMBER) : 2;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function acceptCookies(page) {
  const selectors = ['#onetrust-accept-btn-handler', 'button:has-text("Accept All Cookies")'];
  for (const sel of selectors) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      await btn.click().catch(() => {});
      log('Accepted cookie banner');
      break;
    }
  }
async function setupBrowser() {
  log('Launching Chromium (headless=', HEADLESS, ')');
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', async dialog => {
    log('Dialog:', dialog.message());
    await dialog.dismiss().catch(() => {});
  });
  return { browser, page };
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
  const needsLogin = await page.$('#txtUser');
  if (needsLogin) {
    log('Logging in...');
    await page.fill('#txtUser', USER);
    await page.fill('#txtPassword', PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
      page.click('#ctl00_MainContent_Login1_btnLogin')
      page.click('#ctl00_MainContent_Login1_btnLogin').catch(() => {})
    ]);
    await page.waitForTimeout(1000);
  } else {
    log('Session already active');
  }

  await page.goto(RESERVATION_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ddlDates', { timeout: 30000 });
  await page.waitForSelector('#ddlDates', { timeout: 20000 });
}

async function ensureLocation(page, attempt = 0) {
  const label = await page.$('#lblSelectClub');
  const current = label ? (await label.innerText()).trim() : '';
  if (current.toLowerCase().includes(LOCATION_NAME.toLowerCase())) {
    log('Already on desired club:', current);
    return;
  }
async function selectClub(page) {
  log('Opening Change Club dialog...');
  await page.click('#btnChangeClub').catch(() => {});

  log('Attempting to change club from', current || 'unknown', 'to', LOCATION_NAME);
  const changeLink = await page.$('#btnChangeClub');
  if (!changeLink) {
    log('Change Club link not found; proceeding with current club.');
    return;
  }

  await page.waitForTimeout(1000);
  await changeLink.click();
  await page.waitForTimeout(500);

  const zipInput = await page.waitForSelector('#txtZipCode, input[name="ctl00$MainContent$txtZipCode"], input[placeholder*="Zip"]', { timeout: 8000 }).catch(() => null);
  if (!zipInput) {
    log('Zip code input for club search not found.');
    return;
  }
  await page.waitForSelector('#txtZipCode', { timeout: 15000 });
  await page.fill('#txtZipCode', ZIP_CODE);

  await zipInput.fill(ZIP_CODE);
  await zipInput.evaluate(input => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  // Click Find button via JS (matches old Selenium behavior)
  await page.evaluate(() => {
    const btn = document.querySelector('#btnFindclub') ||
                document.querySelector('input[value="Find"]') ||
                document.querySelector('button[value="Find"]');
    const btn = document.querySelector('#btnFindclub') || document.querySelector('input[value="Find"]');
    if (btn) btn.click();
  }).catch(() => {});

  const findButton = await page.$('#btnFindclub, input[value="Find"]').catch(() => null);
  if (findButton) {
    await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('RacquetballReservation') && resp.request().method() === 'POST'
      ).catch(() => {}),
      findButton.click().catch(() => {})
    ]);
  }
  // Wait until the Jamboree row appears
  const rowXPath = "//td[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'IRVINE - JAMBOREE')]";
  await page.waitForSelector(`xpath=${rowXPath}`, { timeout: 20000 });
  log('Selecting IRVINE - JAMBOREE...');

  const kickedAfterFind = await page.$('#txtUser');
  if (kickedAfterFind && attempt < 1) {
    log('Session reset during club search, retrying...');
    await ensureLoggedIn(page);
    await ensureLocation(page, attempt + 1);
    return;
  }
  const selectButton = page.locator(`xpath=${rowXPath}/following-sibling::td//input[@value='Select']`).first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
    selectButton.click().catch(() => {})
  ]);

  await page.waitForSelector('#gvClubList', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000); // allow list to render fully
  await page.waitForSelector(`xpath=//td[contains(normalize-space(.), "${LOCATION_NAME}") or contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'), "${LOCATION_NAME.toUpperCase()}")]`, { timeout: 5000 }).catch(() => {});
  log('Selecting club row for', LOCATION_NAME);
  await page.waitForTimeout(2000);
  let selectLocator = page.locator(
    `xpath=//td[contains(., "${LOCATION_NAME}")]/../td//input[@value='Select']`
  ).first();
  if (!(await selectLocator.count())) {
    selectLocator = page.locator(
      `xpath=//td[contains(translate(.,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'), "${LOCATION_NAME.toUpperCase()}")]/../td//input[@value='Select']`
    ).first();
  }

  if (await selectLocator.count()) {
    await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('RacquetballReservation') && resp.request().method() === 'POST'
      ).catch(() => {}),
      selectLocator.click().catch(() => {})
    ]);
  const label = await page.innerText('#lblSelectClub').catch(() => '');
  if (label && label.toLowerCase().includes('jamboree')) {
    log('Club switched to', label.trim());
  } else {
    log('Could not locate Select button for', LOCATION_NAME);
    log('Club label not updated (current:', label || 'unknown', ')');
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
  const options = await page.$$eval('#ddlDates option', opts => opts.map((o, idx) => ({ idx, value: o.value, text: o.textContent })));
  if (!options.length) throw new Error('No date options found');
  const target = options[options.length - 1];
  log('Selecting furthest date:', target.text);
  await page.selectOption('#ddlDates', target.value);
  await page.waitForTimeout(1000);
  return target.text;
}

async function ensureDuration(page) {
  const durationOptions = await page.$$eval('#ddlDuration option', opts => opts.map(o => o.value));
  if (durationOptions.includes(String(DURATION_MINUTES))) {
    await page.selectOption('#ddlDuration', String(DURATION_MINUTES));
async function selectDuration(page) {
  const opts = await page.$$eval('#ddlDuration option', options => options.map(o => o.textContent || ''));
  const target = opts.find(text => text.includes(DURATION_MINUTES));
  if (target) {
    log('Selecting duration:', target.trim());
    await page.selectOption('#ddlDuration', { label: target.trim() }).catch(async () => {
      const index = opts.indexOf(target);
      if (index >= 0) await page.selectOption('#ddlDuration', { index });
    });
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
  const options = await page.$$eval('#cboSearByTimeList option', opts => opts.map(o => o.value));
  if (options.length === 0) throw new Error('No time options available');
  const value = options[0];
  log('Selecting time:', value);
  await page.selectOption('#cboSearByTimeList', value);
  await page.waitForTimeout(500);
  return value;
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
  const options = await page.$$eval('#cboCourtByTime option', opts => opts.map(o => ({ value: o.value, text: o.textContent })));
  if (!options.length) throw new Error('No court options');
  let target = options.find(o => o.text && o.text.includes(String(PREFERRED_COURT)));
  if (!target) target = options[0];
  log('Selecting court:', target.text);
  await page.selectOption('#cboCourtByTime', target.value);
  return target.text;
}

async function saveReservation(page) {
async function submitReservation(page) {
  log('Submitting reservation...');
  const statusLocator = page.locator('#divUpdateStatus');
  const status = page.locator('#divUpdateStatus');
  const [result] = await Promise.all([
    statusLocator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    page.click('#btnSaveReservation').catch(() => { throw new Error('Click Save Reservation failed'); })
    status.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    page.click('#btnSaveReservation').catch(() => { throw new Error('Save button click failed'); })
  ]);
  if (result) {
    const text = await statusLocator.innerText();
    const text = await status.innerText();
    log('Status message:', text.trim());
    return /saved/i.test(text);
  }
  const possibleAlert = await page.evaluate(() => window._lafLastAlert || null);
  if (possibleAlert) {
    log('Server alert:', possibleAlert);
  }
  log('No confirmation message observed.');
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
  const { browser, page } = await setupBrowser();
  let exitCode = 0;

  try {
    await ensureLoggedIn(page);
    await ensureLocation(page);
    await ensureDuration(page);
    await selectClub(page);
    const date = await selectFurthestDate(page);
    await selectDuration(page);
    const time = await selectEarliestTime(page);
    const court = await selectCourt(page);
    log('Target slot =>', date.text, time.text, court.text);
    const saved = await saveReservation(page);
    if (!saved) {
    log('Target slot =>', date, time, court);
    const success = await submitReservation(page);
    if (!success) {
      log('Reservation may not have been saved; please verify manually.');
      exitCode = 2;
    }
  } catch (err) {
    console.error('Fatal error:', err);
    exitCode = 3;
    console.error('Unhandled error:', err);
  } finally {
    await browser.close();
    process.exit(exitCode);