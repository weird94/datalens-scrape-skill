import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:900}});
await p.goto('https://news.qq.com/rain/a/20251218A03IZT00?#to-comment',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(6000);
for(let i=0;i<40;i++){
  const n=await p.evaluate(()=>{let c=0;for(const e of document.querySelectorAll('*')){if(e.children.length===0&&/^(查看全部\d+条评论|查看更多评论|查看更多回复|查看\d+条回复|展开.*回复)/.test(e.textContent.trim())){e.click();c++;}}window.scrollTo(0,document.body.scrollHeight);return c});
  await p.waitForTimeout(1500); if(!n&&i>5)break;
}
const html=await p.evaluate(()=>{const e=document.querySelector('[class*=comment]');return [...document.querySelectorAll('[class*=qnc-comment]')].length+' '+document.body.innerText.length});
console.log(html);
const out=await p.evaluate(()=>[...document.querySelectorAll('[class*="qnc-comment"]')].map(e=>e.className+'|'+e.parentElement.className+'|'+e.innerText.replace(/\n/g,' ¶ ').slice(0,200)));
console.log(out.slice(0,30).join('\n'));
await p.screenshot({path:'s.png'});
import fs from 'fs';fs.writeFileSync('dump.json',JSON.stringify(out));
await b.close();
