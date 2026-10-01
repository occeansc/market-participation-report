// node tools/make-pdf.cjs  (needs: npm i playwright && npx playwright install chromium)
const {chromium} = require('playwright');
const path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(root, 'index.html'), {waitUntil: 'load'});
  await page.emulateMedia({media: 'print'});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const file = await page.evaluate(() => {
    const a = document.querySelector('.bar a[download]');
    const d = a && a.getAttribute('download');
    if (d && d !== 'true' && /\.pdf$/i.test(d)) return d;
    return 'IF-Financial-Market-Participation-2020-2026.pdf';
  });
  await page.pdf({
    path: path.join(root, file),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: {top: 0, right: 0, bottom: 0, left: 0}
  });
  await browser.close();
  console.log('wrote ' + file);
})();
