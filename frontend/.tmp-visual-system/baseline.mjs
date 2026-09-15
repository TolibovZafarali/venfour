import {chromium} from '/Users/zafaralitolibov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
for(const [width,height] of [[1440,900],[390,844]]) {
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const page=await context.newPage();
 for(const [name,path] of [['home','/'],['contact','/contact'],['terms','/terms']]) {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4191'+path,{waitUntil:'networkidle'});await page.waitForTimeout(200);
  await page.screenshot({path:`output/visual-system/before-public-${name}-${width}.png`,fullPage:true,animations:'disabled'});
  results.push({name,width,title:await page.title(),errors,metrics:await page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,height:document.body.scrollHeight,width:document.documentElement.scrollWidth,text:document.body.innerText.slice(0,180),gradients:[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backgroundImage.includes('gradient')).length}))});
 }
 await context.close();
}
await fs.writeFile('output/visual-system/before-public.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await browser.close();
