import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
import fs from 'fs';
const b=await chromium.launch();const p=await b.newPage();
const out={};
for(const s of [0,100,225]){
 await p.goto(`https://movie.douban.com/top250?start=${s}`,{waitUntil:'domcontentloaded'});
 out[s]=await p.$$eval('ol.grid_view > li',lis=>lis.map(li=>({rank:li.querySelector('em')?.textContent,title:li.querySelector('.title')?.textContent,link:li.querySelector('a')?.href,rating:li.querySelector('.rating_num')?.textContent,votes:li.querySelector('.rating_num').parentElement.lastElementChild.textContent,quote:li.querySelector('.quote')?.textContent.trim()||'',poster:li.querySelector('img')?.src})));
 await new Promise(r=>setTimeout(r,2000));
}
fs.writeFileSync('live.json',JSON.stringify(out));await b.close();
