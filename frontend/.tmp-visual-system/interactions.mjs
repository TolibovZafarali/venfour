import {chromium} from '/Users/zafaralitolibov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===1440?900:844},reducedMotion:'reduce'});
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const page=await context.newPage();
 const focus=async(name,target)=>{await page.keyboard.press('Tab');await target.focus();const data=await target.evaluate(e=>{const s=getComputedStyle(e);return{tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),focusVisible:e.matches(':focus-visible'),outline:s.outline,boxShadow:s.boxShadow,border:s.border,color:s.color,background:s.backgroundColor}});results.push({width,name,...data});console.log(JSON.stringify({width,name,...data}));};
 await page.goto('http://127.0.0.1:4186/_local/workspace?state=free',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Manage Preferences',exact:true}).click();
 const sw=page.getByRole('switch',{name:'Allow analytics'});await focus('cookie-switch',sw);const before=await sw.getAttribute('aria-checked');await page.keyboard.press('Space');results.push({width,name:'cookie-switch-space',before,after:await sw.getAttribute('aria-checked')});
 await page.screenshot({path:`output/visual-system/after-app-cookie-settings-${width}.png`,fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Reject Non-Essential',exact:true}).click();
 await page.getByRole('button',{name:/Account for/}).click();
 await page.screenshot({path:`output/visual-system/after-app-case-switcher-${width}.png`,fullPage:true,animations:'disabled'});await page.keyboard.press('Escape');await page.waitForTimeout(350);
 await focus('upload-action',page.getByRole('button',{name:'Upload insurer valuation report',exact:true}));
 await page.getByRole('button',{name:'Upload insurer valuation report',exact:true}).click();await page.waitForTimeout(300);
 const file=page.locator('input[type=file]');await focus('report-file',file);
 results.push({width,name:'file-label-focus',label:await page.locator('label[for=full-review-report]').evaluate(e=>({outline:getComputedStyle(e).outline,shadow:getComputedStyle(e).boxShadow,focusWithin:e.matches(':focus-within'),html:e.outerHTML.slice(0,300)})).catch(()=>null)});
 await page.screenshot({path:`output/visual-system/after-app-upload-focus-${width}.png`,fullPage:true,animations:'disabled'});
 await page.goto('http://127.0.0.1:4186/_local/workspace?state=payment',{waitUntil:'networkidle'});
 await focus('checkout-field',page.getByRole('textbox',{name:'Cardholder name',exact:true}));
 await page.goto('http://127.0.0.1:4179/_local/businesses?example=onboarding',{waitUntil:'networkidle'});
 const cb=page.locator('input[type=checkbox]').first();if(await cb.count()){await focus('partner-consent-checkbox',cb);const before=await cb.isChecked();await page.keyboard.press('Space');results.push({width,name:'partner-checkbox-space',before,after:await cb.isChecked()});await page.screenshot({path:`output/visual-system/after-app-partner-consent-focus-${width}.png`,fullPage:true,animations:'disabled'});}
 await context.close();
}
await fs.writeFile('output/visual-system/interactions.json',JSON.stringify(results,null,2));await browser.close();
