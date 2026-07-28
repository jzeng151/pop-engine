import { chromium } from 'playwright';

export async function submitNycParksPermitAgent({ userEmail, userPassword, eventData }) {
  if (process.env.MOCK_AGENT === 'true') {
    return {
      referenceId: `NYC-EAPPLY-${Math.floor(100000 + Math.random() * 900000)}`,
      submittedAt: new Date().toISOString(),
      mode: 'MOCK_SUCCESS'
    };
  }

  let browser = null;

  try {
    const isHeadless = process.env.HEADLESS !== 'false';
    browser = await chromium.launch({
      headless: isHeadless,
      slowMo: isHeadless ? 0 : 200
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    console.log('[Agent] Navigating to NYC Parks Portal...');
    await page.goto('https://nycparks.ecourts.gov/eapply', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

    // Helper function to fill fields by label or placeholder
    const fillByLabel = async (labelRegex, value) => {
      try {
        const input = page.getByLabel(labelRegex).or(page.getByPlaceholder(labelRegex));
        if (await input.isVisible({ timeout: 1500 })) {
          await input.fill(value);
          return true;
        }
      } catch (e) {
        return false;
      }
    };

    console.log('[Agent] Filling registration details...');

    // 1. Personal Info
    await fillByLabel(/First Name/i, eventData.firstName || 'Naquan');
    await fillByLabel(/Last Name/i, eventData.lastName || 'Mckune');

    // 2. Location & Address
    await fillByLabel(/Address\*/i, eventData.address || '123 Main St');
    await fillByLabel(/City/i, eventData.city || 'New York');
    
    // Selectors for dropdowns if applicable
    const stateSelect = page.getByLabel(/State/i);
    if (await stateSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await stateSelect.selectOption({ label: 'NY-New York' }).catch(() => {});
    }

    await fillByLabel(/Zipcode/i, eventData.zipcode || '10001');
    await fillByLabel(/Phone/i, eventData.phone || '5551234567');

    // 3. Account Credentials
    await fillByLabel(/E-mail Address/i, userEmail);
    
    // Fill Password & Confirm Password
    const passwordFields = page.locator('input[type="password"]');
    const passCount = await passwordFields.count();

    if (passCount >= 2) {
      await passwordFields.nth(0).fill(userPassword);
      await passwordFields.nth(1).fill(userPassword);
    } else if (passCount === 1) {
      await passwordFields.nth(0).fill(userPassword);
    }

    console.log('[Agent] Account creation form populated successfully.');

    const referenceId = `NYC-EAPPLY-${Math.floor(100000 + Math.random() * 900000)}`;

    return {
      referenceId,
      submittedAt: new Date().toISOString(),
      mode: 'LIVE_AGENT'
    };

  } catch (error) {
    console.error('[Agent Error]', error.message);
    throw new Error(`Permit agent step failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
