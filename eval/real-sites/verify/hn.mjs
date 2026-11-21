import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await b.newPage();
await p.goto('https://news.ycombinator.com/news?p=2');
await p.screenshot({path:'p2.png'});
const r=await p.$$eval('tr.athing',els=>els.slice(0,3).concat(els.slice(-2)).map(e=>{const s=e.nextElementSibling;return {id:e.id,rank:e.querySelector('.rank')?.textContent,title:e.querySelector('.titleline a')?.textContent,site:e.querySelector('.sitestr')?.textContent,sub:s.innerText.replace(/\s+/g,' ')}}));
console.log(JSON.stringify(r,null,1));
console.log(await p.$$eval('tr.athing',e=>e.length));
await b.close();
