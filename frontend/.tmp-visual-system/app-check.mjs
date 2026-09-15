import {chromium} from '/Users/zafaralitolibov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
const routes=[
 ['free','http://127.0.0.1:4186/_local/workspace?state=free'],
 ['intake','http://127.0.0.1:4186/_local/workspace?state=intake'],
 ['checkout','http://127.0.0.1:4186/_local/workspace?state=payment'],
 ['completed','http://127.0.0.1:4186/_local/workspace?state=completed'],
 ['waiting','http://127.0.0.1:4186/_local/workspace?state=waiting'],
 ['processing','http://127.0.0.1:4186/_local/workspace?state=processing'],
 ['case-resume','http://127.0.0.1:4186/_local/workspace?state=completed'],
 ['admin','http://127.0.0.1:4179/admin'],
 ['admin-cases','http://127.0.0.1:4179/admin/cases'],
 ['admin-payments','http://127.0.0.1:4179/admin/payments'],
 ['admin-partners','http://127.0.0.1:4179/admin/referral-partners'],
 ['partner','http://127.0.0.1:4179/_local/businesses?example=active'],
 ['partner-onboarding','http://127.0.0.1:4179/_local/businesses?example=onboarding'],
];
for(const [width,height] of [[1440,900],[390,844]]) {
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const page=await context.newPage();
 for(const [name,url] of routes) {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'networkidle'});await page.waitForTimeout(350); const accept=page.getByRole('button',{name:'Accept All',exact:true});if(await accept.isVisible())await accept.click();
  await page.screenshot({path:`output/visual-system/after-app-${name}-${width}.png`,fullPage:true,animations:'disabled'});
  const metrics=await page.evaluate(()=>{
   const ignored='.workspace-preview-note,.preview-bar,.business-preview-bar,.business-preview-approval,.preview-launcher';
   const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&!e.closest(ignored)};
   const describe=e=>({tag:e.tagName,cls:String(e.className).slice(0,200),text:e.textContent?.trim().slice(0,75)});
   const tinted=[],gradients=[],colors={},surface=[];
   const colorPixel=document.createElement('canvas');colorPixel.width=colorPixel.height=1;const ctx=colorPixel.getContext('2d',{willReadFrequently:true});
   const rgba=c=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data)};
   for(const e of document.querySelectorAll('*'))if(visible(e)) {
    const s=getComputedStyle(e),rgb=rgba(s.backgroundColor),rect=e.getBoundingClientRect();
    if(rgb[3]>0){colors[s.backgroundColor]=(colors[s.backgroundColor]||0)+1;if(rgb[0]!==rgb[1]||rgb[1]!==rgb[2])tinted.push({...describe(e),background:s.backgroundColor,rgba:rgb});if(rect.width>300&&rect.height>300)surface.push({...describe(e),background:s.backgroundColor,width:rect.width,height:rect.height});}
    for(const pseudo of ['', '::before','::after']){const ps=getComputedStyle(e,pseudo||null);if(ps.backgroundImage.includes('gradient')&&(pseudo===''||ps.content!=='none'&&ps.content!=='normal')&&ps.display!=='none')gradients.push({...describe(e),pseudo,image:ps.backgroundImage});}
   }
   return {visualSystem:document.documentElement.dataset.visualSystem,body:getComputedStyle(document.body).backgroundColor,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,gradients,tinted,colors,surface,headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent),text:document.body.innerText.slice(0,500)};
  });
  const r={name,width,url:page.url(),errors,metrics};results.push(r);console.log(JSON.stringify({name,width,system:metrics.visualSystem,overflow:metrics.scrollWidth>width,gradients:metrics.gradients.length,tinted:metrics.tinted,headings:metrics.headings,errors}));
 }
 await context.close();
}
await fs.writeFile('output/visual-system/after-app.json',JSON.stringify(results,null,2));await browser.close();
