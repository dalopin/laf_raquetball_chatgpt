const { chromium } = require('playwright');

const RESERVATION_URL = process.env.RESERVATION_URL || 'https://lafitness.com/Pages/RacquetballReservation.aspx';
const USER = process.env.RB_USER || 'dalopin2';
const PASS = process.env.RB_PASS || 'dalopin1';
const HEADLESS = process.env.HEADLESS !== 'false';
const ZIP_CODE = process.env.LOCATION_ZIP || '92780';
const DURATION_MINUTES = process.env.DURATION_MINUTES || '60';
const PREFERRED_COURT = process.env.COURT_NUMBER ? Number(process.env.COURT_NUMBER) : 2;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
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
  async function loadReservationPage() {
    await page.goto(RESERVATION_URL, { waitUntil: 'networkidle' }).catch(() => {});
    const dropdown = await page.waitForSelector('#ddlDates', { timeout: 45000 }).catch(() => null);
    return dropdown !== null;
  }

  let attempts = 3;
  while (attempts > 0) {
    const loaded = await loadReservationPage();
    if (loaded) break;
    attempts -= 1;
    if (attempts === 0) {
      throw new Error('Reservation controls did not load (missing #ddlDates)');
    }
    log('Reservation page did not load; retrying...');
    await page.waitForTimeout(3000);
  }

  const loginForm = await page.$('#txtUser').catch(() => null);
  if (loginForm) {
    log('Logging in...');
    await page.fill('#txtUser', USER);
    await page.fill('#txtPassword', PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
      page.click('#ctl00_MainContent_Login1_btnLogin').catch(() => {})
    ]);
  } else {
    log('Login form not found; assuming session already valid.');
  }

  attempts = 3;
  while (attempts > 0) {
    const loaded = await loadReservationPage();
    if (loaded) break;
    attempts -= 1;
    if (attempts === 0) {
      throw new Error('Reservation controls did not load (missing #ddlDates)');
    }
    log('Reservation controls missing after login; retrying...');
    await page.waitForTimeout(3000);
  }
}

async function selectClub(page) {
  log('Opening Change Club dialog...');
  await page.click('#btnChangeClub').catch(() => {});

  await page.waitForSelector('#txtZipCode', { timeout: 15000 });
  await page.fill('#txtZipCode', ZIP_CODE);

  // Click Find button via JS (matches old Selenium behavior)
  await page.evaluate(() => {
    const btn = document.querySelector('#btnFindclub') || document.querySelector('input[value="Find"]');
    if (btn) btn.click();
  }).catch(() => {});

  // Wait until the Jamboree row appears
  const rowXPath = "//td[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'IRVINE - JAMBOREE')]";
  await page.waitForSelector(`xpath=${rowXPath}`, { timeout: 20000 });
  log('Selecting IRVINE - JAMBOREE...');

  const selectButton = page.locator(`xpath=${rowXPath}/following-sibling::td//input[@value='Select']`).first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
    selectButton.click().catch(() => {})
  ]);

  const label = await page.innerText('#lblSelectClub').catch(() => '');
  if (label && label.toLowerCase().includes('jamboree')) {
    log('Club switched to', label.trim());
  } else {
    log('Club label not updated (current:', label || 'unknown', ')');
  }
}

async function selectFurthestDate(page) {
  const options = await page.$$eval('#ddlDates option', opts => opts.map((o, idx) => ({ idx, value: o.value, text: o.textContent })));
  if (!options.length) throw new Error('No date options found');
  const target = options[options.length - 1];
  log('Selecting furthest date:', target.text);
  await page.selectOption('#ddlDates', target.value);
  await page.waitForTimeout(1000);
  return target.text;
}

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
  const options = await page.$$eval('#cboSearByTimeList option', opts => opts.map(o => o.value));
  if (options.length === 0) throw new Error('No time options available');
  const value = options[0];
  log('Selecting time:', value);
  await page.selectOption('#cboSearByTimeList', value);
  await page.waitForTimeout(500);
  return value;
}

async function selectCourt(page) {
  const options = await page.$$eval('#cboCourtByTime option', opts => opts.map(o => ({ value: o.value, text: o.textContent })));
  if (!options.length) throw new Error('No court options');
  let target = options.find(o => o.text && o.text.includes(String(PREFERRED_COURT)));
  if (!target) target = options[0];
  log('Selecting court:', target.text);
  await page.selectOption('#cboCourtByTime', target.value);
  return target.text;
}

async function submitReservation(page) {
  log('Submitting reservation...');
  const status = page.locator('#divUpdateStatus');
  const [result] = await Promise.all([
    status.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    page.click('#btnSaveReservation').catch(() => { throw new Error('Save button click failed'); })
  ]);
  if (result) {
    const text = await status.innerText();
    log('Status message:', text.trim());
    return /saved/i.test(text);
  }
  log('No confirmation message observed.');
  return false;
}

async function main() {
  const { browser, page } = await setupBrowser();
  let exitCode = 0;
  try {
    await ensureLoggedIn(page);
    await selectClub(page);
    const date = await selectFurthestDate(page);
    await selectDuration(page);
    const time = await selectEarliestTime(page);
    const court = await selectCourt(page);
    log('Target slot =>', date, time, court);
    const success = await submitReservation(page);
    if (!success) {
      log('Reservation may not have been saved; please verify manually.');
      exitCode = 2;
    }
  } catch (err) {
    console.error('Fatal error:', err);
    exitCode = 3;
  } finally {
    await browser.close();
    process.exit(exitCode);
  }
}

main();
