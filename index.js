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

    // 🔐 Login
    await page.goto('https://auth.servicefusion.com/auth/login', { waitUntil: 'networkidle2' });
    await page.type('#company', 'pfs21485');
    await page.type('#uid', 'Lui-G');
    await page.type('#pwd', 'Premierlog5335!');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    const url = invoiceUrls[0];
    try {
      console.log(`📨 Opening invoice: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2' });

      // 🔍 Extract Job Number & Billing Email
      const { jobNumber, billingEmail } = await page.evaluate(() => {
        const jobLink = document.querySelector('a[href^="/jobs/jobView"]');
        const jobNumber = jobLink ? jobLink.textContent.trim() : null;

        const billToBox = Array.from(document.querySelectorAll('.invoice-sub')).find(el =>
          el.innerText.includes('@')
        );

        let billingEmail = null;
        if (billToBox) {
          const match = billToBox.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          billingEmail = match ? match[0] : null;
        }

        return { jobNumber, billingEmail };
      });

      if (jobNumber) console.log(`🔢 Job Number: ${jobNumber}`);
      if (billingEmail) console.log(`📧 Billing Email: ${billingEmail}`);
      if (!billingEmail) throw new Error('Billing contact email not found.');

      // ✉️ Open Email Modal
      await page.waitForSelector('a.btn[onclick^="showEmailInvoice"]', { timeout: 10000 });
      await page.click('a.btn[onclick^="showEmailInvoice"]');
      await page.waitForSelector('#email-modal', { visible: true, timeout: 10000 });

      // 🎯 Focus "To" field
      await page.waitForSelector('.select2-choices', { visible: true });
      await page.click('.select2-choices');
      await new Promise(resolve => setTimeout(resolve, 500));

      // 🧹 Spam backspace to remove all contacts
      for (let i = 0; i < 50; i++) {
        await page.keyboard.press('Backspace');
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      // ➕ Type new billing email
      await page.waitForSelector('.select2-search-field input', { visible: true });
      await page.type('.select2-search-field input', billingEmail);
      await page.keyboard.press('Enter');
      console.log(`📧 Entered Billing Contact: ${billingEmail}`);

      // 🧾 Headless-safe Select2 Template Selection: "90 Days Past Due"
      await page.waitForSelector('#s2id_customForms .select2-choice', { visible: true });

      // Force open dropdown using raw JS
      await page.evaluate(() => {
        const dropdown = document.querySelector('#s2id_customForms .select2-choice');
        if (dropdown) dropdown.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      await new Promise(resolve => setTimeout(resolve, 500));

      // Inject value using raw JS (select2-input might not be focusable in headless)
      await page.evaluate(() => {
        const input = document.querySelector('.select2-drop-active input.select2-input');
        if (input) {
          input.value = '90 Days Past Due';
          const event = new Event('input', { bubbles: true });
          input.dispatchEvent(event);
        }
      });

      // Press Enter to confirm selection
      await page.keyboard.press('Enter');
      console.log('✅ Force-selected template: 90 Days Past Due');

      // 🚀 Send Email
      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.waitForSelector('#btn-load-then-complete', { visible: true });
      await page.click('#btn-load-then-complete');
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('✅ Email sent.');

      result = {
        success: true,
        sent: 1,
        invoice: url,
        jobNumber,
        billingContact: billingEmail
      };

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
