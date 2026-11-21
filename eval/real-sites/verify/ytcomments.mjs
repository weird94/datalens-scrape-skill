import {createRequire} from 'module';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});
await p.goto('https://www.youtube.com/watch?v=5MWT_doo68k');await p.waitForTimeout(4000);
for(let i=0;i<4;i++){await p.mouse.wheel(0,1200);await p.waitForTimeout(1500);}
const r=await p.evaluate(()=>[...document.querySelectorAll('ytd-comment-thread-renderer')].map(t=>({a:t.querySelector('#author-text')?.innerText.trim(),h:t.querySelector('#author-text')?.href,c:t.querySelector('#content-text')?.innerText.slice(0,80),l:t.querySelector('#vote-count-middle')?.innerText.trim(),rep:t.querySelector('#replies')?.innerText.trim().slice(0,20)})));
console.log(r.length);console.log(JSON.stringify(r.slice(0,25),null,0));
await p.screenshot({path:'/private/tmp/claude-501/-Users-zw--claude-spares-spare-yshVOq/af392502-fb4f-4684-8a42-858d1896169e/scratchpad/eval-real1/verify/ytcomments/s.png'});
await b.close();
