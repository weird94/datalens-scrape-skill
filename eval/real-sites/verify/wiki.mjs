import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await b.newPage();
await p.goto('https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue',{waitUntil:'domcontentloaded'});
const out=await p.evaluate(()=>{
 const tabs=[...document.querySelectorAll('table.wikitable')];
 return tabs.map(t=>{
  const trs=[...t.rows];const grid=[];const pend=[];
  trs.forEach((tr,ri)=>{const row=[];let c=0;
   const cells=[...tr.cells];
   const take=()=>{while(pend[c]&&pend[c].n>0){row[c]=pend[c].v;pend[c].n--;c++;}};
   for(const cell of cells){take();const v=cell.innerText.replace(/\[\d+\]/g,'').trim().replace(/\s+/g,' ');const rs=cell.rowSpan,cs=cell.colSpan;
    for(let k=0;k<cs;k++){row[c]=v;if(rs>1)pend[c]={n:rs-1,v};c++;}}
   take();grid.push(row);});
  return grid;});
});
console.log(out.length, out.map(g=>g.length+' '+JSON.stringify(g[0])));
console.log(out[0].slice(0,60).map(r=>r.join(' | ')).join('\n'));
await b.close();
