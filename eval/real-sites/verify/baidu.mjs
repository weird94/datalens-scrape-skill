import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await b.newPage({locale:'zh-CN'});
await p.goto('https://top.baidu.com/board?tab=realtime',{waitUntil:'networkidle'});
const items=await p.evaluate(()=>[...document.querySelectorAll('[class*=category-wrap]')].map(e=>({t:e.innerText.replace(/\n+/g,' | ').slice(0,300),a:[...e.querySelectorAll('a')].map(a=>a.href).join(' ; ')})));
console.log(items.length);items.forEach((x,i)=>console.log(i,x.t,'\n   ',x.a));
await b.close();
