import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1400,height:900},locale:'en-US'})).newPage();
await p.goto('https://open.spotify.com/artist/7Dx7RhX0mFuXhCOUgB01uM',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(5000);
await p.screenshot({path:'a.png'});
const dc=p.locator('a[href*="/discography"]').first();
console.log(await dc.count());
await dc.click().catch(e=>console.log('e1',e.message.slice(0,80)));
await p.waitForTimeout(3000);
const sa=p.getByText(/show all/i).first();
if(await sa.count()){await sa.click();await p.waitForTimeout(3000);}
console.log(p.url());
await p.screenshot({path:'b.png'});
// find scroll container
const set=new Map();
async function grab(){return p.evaluate(()=>[...document.querySelectorAll('a[href*="/album/"]')].map(a=>{const r=a.closest('[data-testid],[role=row],div');return [a.href.split('?')[0],a.textContent.trim().slice(0,60)]}));}
for(let i=0;i<150;i++){
 for(const [h,t] of await grab()){if(!set.has(h))set.set(h,t);}
 const moved=await p.evaluate(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+50&&['auto','scroll'].includes(getComputedStyle(e).overflowY));const e=els.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];if(!e)return -1;const o=e.scrollTop;e.scrollTop+=300;return e.scrollTop-o;});
 await p.waitForTimeout(250);
 if(moved===0&&i>5)break;
}
for(const [h,t] of await grab()){if(!set.has(h))set.set(h,t);}
console.log(set.size);
import fs from 'fs';fs.writeFileSync('set.json',JSON.stringify([...set]));
await b.close();
