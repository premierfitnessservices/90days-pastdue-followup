const puppeteer = require('puppeteer');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

app.post('/send-emails', async (req, res) => {
  const invoiceUrls = req.body.invoice;

  if (!Array.isArray(invoiceUrls) || invoiceUrls.length === 0) {
    return res.status(400).json({ error: 'No invoice URLs provided' });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let result = {};

  try {
    const page = await browser.newPage();

    // Login
    await page.goto('https://auth.servicefusion.com/auth/login', { waitUntil: 'networkidle2' });
    await page.type('#company', 'pfs21485');
    await page.type('#uid', 'Lui-G');
    await page.type('#pwd', 'Premierlog5335!');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Process first invoice
    const url = invoiceUrls[0];
    try {
      console.log(`📨 Opening invoice: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2' });

      // Extract Job Number
      let jobNumber = await page.evaluate(() => {
        const jobLink = document.querySelector('a[href^="/jobs/jobView"]');
        return jobLink ? jobLink.textContent.trim() : null;
      });

      if (jobNumber) {
        console.log(`🔢 Job Number: ${jobNumber}`);
      } else {
        console.log('⚠️ Job Number not found.');
      }

      // Open Email Modal
      await page.waitForSelector('a.btn[onclick^="showEmailInvoice"]', { timeout: 10000 });
      await page.click('a.btn[onclick^="showEmailInvoice"]');
      await page.waitForSelector('#email-modal', { visible: true, timeout: 10000 });

      // Try selecting other contact
      try {
        await page.waitForSelector('button.dropdown-toggle[data-toggle="dropdown"]', { visible: true, timeout: 5000 });
        await page.click('button.dropdown-toggle[data-toggle="dropdown"]');
        await new Promise(resolve => setTimeout(resolve, 1000));

        const contactClicked = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('ul.customer-other-contacts li:not(.disabled) a'))
            .filter(a => a.getAttribute('onclick')?.includes('setemails'));

          if (items.length > 0) {
            items[0].click();
            return true;
          }
          return false;
        });

        console.log(contactClicked ? '✅ Selected Other Contact.' : 'ℹ️ No selectable Other Contact found.');
      } catch {
        console.log('ℹ️ Other Contact dropdown not available.');
      }

      // Extract emails from modal
      const contactEmails = await page.evaluate(() => {
        const emailNodes = Array.from(document.querySelectorAll('ul.select2-choices li.select2-search-choice div'));
        return emailNodes.map(div => div.textContent.trim());
      });

      // Select email template — UPDATED to 90 Days Past Due
      await page.waitForSelector('#s2id_customForms .select2-choice', { visible: true });
      await page.click('#s2id_customForms .select2-choice');
      await page.waitForSelector('.select2-drop-active .select2-search input', { visible: true });
      await page.type('.select2-drop-active .select2-search input', '90 Days Past Due');
      await page.keyboard.press('Enter');
      console.log('✅ Selected template: 90 Days Past Due');

      // Wait a bit before sending
      await new Promise(resolve => setTimeout(resolve, 2000));

      // ✅ Click Send button
      await page.waitForSelector('#btn-load-then-complete', { visible: true });
      await page.click('#btn-load-then-complete');
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('✅ Email sent.');

      // Construct final result
      result = {
        success: true,
        sent: 1,
        invoice: url,
        jobNumber: jobNumber || 'Not Found'
      };

      contactEmails.forEach((email, i) => {
        const label = `contact_${i + 1}`;
        result[label] = email;
        console.log(`📬 ${label}: ${email}`);
      });

    } catch (err) {
      console.error(`❌ Failed on invoice ${url}:`, err.message);
      result = {
        success: false,
        invoice: url,
        error: err.message
      };
    }

    await browser.close();
    return res.json(result);

  } catch (err) {
    await browser.close();
    return res.status(500).json({
      success: false,
      error: 'Automation failed',
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${PORT}/send-emails`);
});
