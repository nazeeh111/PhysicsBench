import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=resolve(process.argv[2] ?? fileURLToPath(new URL('..',import.meta.url)));
const server=createServer(async(req,res)=>{
  try {
    if(req.url==='/') {
      res.setHeader('Content-Type','text/html');
      res.end('<main id="test"></main><script type="module">import {mountMotion,validateMotionRun} from "/motion-lab.js";window.mountMotion=mountMotion;window.validateMotionRun=validateMotionRun;</script>');
      return;
    }
    const target=resolve(directory,'.'+req.url);
    if(!target.startsWith(directory+sep)) throw Error('bad path');
    res.setHeader('Content-Type',extname(target)==='.js'?'text/javascript':'text/plain');
    res.end(await readFile(target));
  } catch {res.writeHead(404);res.end();}
});
let browser;
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>!!window.mountMotion);
  const results=await page.evaluate(async()=>{
    const base={type:'motion',version:1,id:'initial',name:'Initial',question:'Test',source:{kind:'generated',scenario:'flight',name:'Generated test',width:960,height:540,duration:1.8},calibration:{a:{x:70,y:480},b:{x:170,y:480},origin:{x:80,y:460},lengthMeters:2,yUp:true,lengthBoundMeters:0.01,pointBoundPixels:1},observations:[],gaps:[],model:'ballistic',fitStart:0,fitEnd:1.8,cursor:0,selectedId:null,notes:''};
    const json=(id,name)=>JSON.stringify({...base,id,name});
    const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
    const setup=()=>{
      const api=mountMotion(document.querySelector('#test'),{run:base});
      const input=document.querySelector('[data-open]');
      const root=input.closest('.motion-lab');
      let chosen;
      Object.defineProperty(input,'files',{configurable:true,get:()=>[chosen]});
      const start=()=>{
        let resolve,reject;
        chosen={size:100,text:()=>new Promise((a,b)=>{resolve=a;reject=b;})};
        input.dispatchEvent(new Event('change'));
        return {resolve,reject};
      };
      const state=()=>({name:api.exportRun().name,error:root.querySelector('[data-error]').hidden?'':root.querySelector('[data-error]').textContent});
      return {api,start,state};
    };
    const results=[];
    let s=setup(), a=s.start(), b=s.start();
    b.resolve(json('second','Second fast'));await tick();a.resolve(json('first','First slow'));await tick();
    results.push({case:'latest import wins',...s.state(),expectedName:'Second fast',expectedError:false});window.validateMotionRun(s.api.exportRun());s.api();
    s=setup();a=s.start();b=s.start();b.resolve(json('second','Second fast'));await tick();a.reject(Error('Old read failed'));await tick();
    results.push({case:'stale failure is ignored',...s.state(),expectedName:'Second fast',expectedError:false});s.api();
    s=setup();a=s.start();s.api.loadRun({...base,id:'replacement',name:'Replacement source'});a.resolve(json('first','First slow'));await tick();
    results.push({case:'source replacement cancels pending read',...s.state(),expectedName:'Replacement source',expectedError:false});s.api();
    s=setup();a=s.start();s.api();a.resolve(json('first','First slow'));await tick();
    results.push({case:'disposal cancels pending read',...s.state(),expectedName:'Initial',expectedError:false});
    s=setup();a=s.start();a.resolve('{');await tick();
    results.push({case:'malformed current import retains valid run',...s.state(),expectedName:'Initial',expectedError:true});s.api();
    s=setup();a=s.start();b=s.start();b.resolve('{');await tick();a.resolve(json('first','First slow'));await tick();
    results.push({case:'failed newest import does not admit older read',...s.state(),expectedName:'Initial',expectedError:true});s.api();
    return results;
  });
  console.log(JSON.stringify({browser:browser.version(),results},null,2));
  const failures=results.filter(r=>r.name!==r.expectedName || Boolean(r.error)!==r.expectedError);
  assert.deepEqual(failures,[],'Source changes and disposal must prevent stale imports/errors while preserving current-input errors');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
