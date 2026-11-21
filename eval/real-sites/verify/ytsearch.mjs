import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await (await b.newContext({locale:'en-US'})).newPage();
await p.goto('https://www.youtube.com/results?search_query=robot',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
for(let i=0;i<6;i++){await p.mouse.wheel(0,4000);await p.waitForTimeout(1200);}
const d=await p.evaluate(()=>[...document.querySelectorAll('ytd-video-renderer')].map(e=>({t:e.querySelector('#video-title')?.textContent.trim(),h:e.querySelector('#video-title')?.href,ch:e.querySelector('ytd-channel-name a')?.textContent.trim(),meta:[...e.querySelectorAll('#metadata-line span')].map(s=>s.textContent.trim()),dur:e.querySelector('ytd-thumbnail-overlay-time-status-renderer')?.textContent.trim().replace(/\s+/g,' '),desc:e.querySelector('.metadata-snippet-text')?.textContent.trim().slice(0,70)})));
console.log(d.length);console.log(JSON.stringify(d.slice(0,12),null,0).replace(/\},/g,'},\n'));
console.log(await p.evaluate(()=>[...document.querySelectorAll('ytd-search ytd-item-section-renderer #contents > *')].map(e=>e.tagName).reduce((a,t)=>(a[t]=(a[t]||0)+1,a),{})));
await b.close();
