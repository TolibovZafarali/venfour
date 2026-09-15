import {chromium} from '/Users/zafaralitolibov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===1440?900:844},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(['venfour.com','app.venfour.com'].includes(url.hostname)){url.protocol='http:';url.host='127.0.0.1:4191';try{await route.fulfill({response:await route.fetch({url:url.toString()})});}catch{await route.abort();}}else await route.abort();});
 await context.routeWebSocket('**/*',ws=>ws.close());
 const page=await context.newPage();
 for(const [name,url] of [['host-public-home','https://venfour.com/'],['new-start','https://app.venfour.com/start?service=total-loss'],['host-app-terms','https://app.venfour.com/terms'],['host-public-terms','https://venfour.com/terms'],['host-app-not-found','https://app.venfour.com/future-app-route']]){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url,{waitUntil:'networkidle'});await page.waitForTimeout(250);
  const accept=page.getByRole('button',{name:'Accept All',exact:true});if(await accept.isVisible())await accept.click();
  await page.screenshot({path:`output/visual-system/after-${name}-${width}.png`,fullPage:true,animations:'disabled'});
  const data=await page.evaluate(()=>({system:document.documentElement.dataset.visualSystem,body:getComputedStyle(document.body).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,gradients:[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backgroundImage.includes('gradient')).length,heading:document.querySelector('h1')?.textContent,logo:document.querySelector('header a')?.getAttribute('href'),main:getComputedStyle(document.querySelector('main')||document.body).backgroundColor}));results.push({name,width,url,errors,...data});console.log(JSON.stringify(results.at(-1)));
 }
 await context.close();
}
await fs.writeFile('output/visual-system/host-check.json',JSON.stringify(results,null,2));await browser.close();
