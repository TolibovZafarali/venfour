import {chromium} from '/Users/zafaralitolibov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===1440?900:844},reducedMotion:'reduce'});await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());const page=await context.newPage();await page.goto('http://127.0.0.1:4186/_local/workspace?state=free',{waitUntil:'networkidle'});
 const accept=page.getByRole('button',{name:'Accept All',exact:true});if(await accept.isVisible())await accept.click();
 await page.evaluate(async()=>{const s=await import('/state.ts');const existing=s.previewCases()[0];const draft={...existing,status:'draft',analysisStatus:null,caseStage:undefined,hasFullReviewReport:false,hasTotalLossClaimWorkflow:false,workspaceStatus:undefined,vehicleLabel:null};s.previewCaseService.getOrCreateTotalLossDraft=async()=>draft;s.previewCaseService.getAppraisalCase=async()=>draft;s.previewCaseService.createOrGetAppraisalCase=async()=>draft;s.previewDetails.totalLossDetailsService.getDetails=async()=>null;});
 await page.getByRole('button',{name:/Account for/}).click();await page.getByRole('menuitem',{name:'Start new appraisal'}).click();await page.waitForTimeout(500);
 await page.screenshot({path:`output/visual-system/after-app-new-intake-${width}.png`,fullPage:true,animations:'disabled'});
 if(width===390){const cont=page.getByRole('button',{name:'Continue',exact:true});if(await cont.isVisible()){await cont.click();await page.waitForTimeout(350);await page.screenshot({path:`output/visual-system/after-app-new-intake-step-${width}.png`,fullPage:true,animations:'disabled'});}}
 const metrics=await page.evaluate(()=>({url:location.href,system:document.documentElement.dataset.visualSystem,heading:document.querySelector('h1')?.textContent,headings:[...document.querySelectorAll('h2')].map(e=>e.textContent),text:document.body.innerText,body:getComputedStyle(document.body).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,gradients:[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backgroundImage.includes('gradient')).length}));results.push({width,...metrics});console.log(JSON.stringify(results.at(-1)));await context.close();
}
await fs.writeFile('output/visual-system/new-intake.json',JSON.stringify(results,null,2));await browser.close();
