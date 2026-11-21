import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await b.newPage();
await p.goto('https://www.nature.com/articles/s41467-025-63209-4',{waitUntil:'domcontentloaded',timeout:60000});
const out=await p.evaluate(()=>{const s=document.querySelector('#Bib1-section, section[data-title="References"]');const li=[...s.querySelectorAll('li.c-article-references__item')];
return li.map((l,i)=>({n:i+1,t:l.innerText.replace(/\s+/g,' ').slice(0,300),links:[...l.querySelectorAll('a')].map(a=>a.href)}))});
console.log(out.length);
for(const o of out){if([1,2,20,33,49,50,61,62].includes(o.n))console.log(JSON.stringify(o));}
console.log('nolinks',out.filter(o=>!o.links.length).map(o=>o.n).join(','));
console.log('nodoi',out.filter(o=>!o.links.some(l=>l.includes('doi.org'))).map(o=>o.n).join(','));
await b.close();
