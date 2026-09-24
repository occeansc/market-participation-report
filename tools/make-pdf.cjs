// node tools/make-pdf.cjs  (needs: npm i playwright && npx playwright install chromium)
const {chromium}=require('playwright'),path=require('path');
(async()=>{const R=path.resolve(__dirname,'..'),b=await chromium.launch(),p=await b.newPage();
await p.goto('file://'+R+'/index.html');await p.evaluate(()=>document.fonts.ready);
await p.pdf({path:R+'/Foabao-Financial-Market-Participation-2020-2026.pdf',format:'A4',printBackground:true,preferCSSPageSize:true});await b.close()})();
