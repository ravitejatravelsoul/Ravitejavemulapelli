import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn,spawnSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomBytes,scryptSync } from 'node:crypto';
import {openDatabase} from '../db/client.ts';
import {runMigrations} from '../db/migrate.ts';
import {seedAll} from '../db/seed.ts';
import {getOwner} from '../domain/users.ts';
import {createProjectWithIdea} from '../domain/projects.ts';

test('conversation: authenticated Headquarters text/voice parity, confirmation and fallback',{timeout:240000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'office-conversation-e2e-'));const password=randomBytes(16).toString('hex'),salt=randomBytes(16).toString('hex');
 const env={...process.env,AI_OFFICE_E2E_DIST_DIR:process.env.AI_OFFICE_CONVERSATION_SKIP_BUILD==='true'?'.next-e2e-hq':'.next-e2e-conversation',AI_OFFICE_DB_PATH:join(dir,'office.db'),AI_OFFICE_EXECUTION_MODE:'local',AI_OFFICE_OPERATIONAL_MODE:'enabled',AI_OFFICE_CLAUDE_ENABLED:'false',ANTHROPIC_API_KEY:'',GROQ_API_KEY:'',OPENROUTER_API_KEY:'',GEMINI_API_KEY:'',OFFICE_OWNER_EMAIL:'conversation-test@example.test',OFFICE_OWNER_PASSWORD_HASH:salt+':'+scryptSync(password,salt,64).toString('hex'),OFFICE_SESSION_SECRET:randomBytes(32).toString('hex')};
 const before={...process.env};Object.assign(process.env,env);const db=openDatabase(env.AI_OFFICE_DB_PATH);runMigrations(db);seedAll(db);const p=createProjectWithIdea(db,{ownerId:getOwner(db)!.id,title:'Conversation fixture',rawIdeaText:'Deterministic test fixture. No model or runner.'}).project;Object.assign(process.env,before);
 const next=resolve('node_modules/next/dist/bin/next');
 if(process.env.AI_OFFICE_CONVERSATION_SKIP_BUILD!=='true')assert.equal(spawnSync(process.execPath,[next,'build'],{env,stdio:'ignore'}).status,0);
 const server=spawn(process.execPath,[next,'start','--hostname','127.0.0.1','--port','3925'],{env,stdio:'ignore'});const base='http://127.0.0.1:3925';let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/office/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   class Recognition {continuous=false;interimResults=false;lang='';onresult:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;onerror:((e:unknown)=>void)|null=null;start(){(window as unknown as {recognition:Recognition}).recognition=this;}stop(){this.onresult?.({results:[{isFinal:true,0:{transcript:'Status'}}]});this.onend?.();}abort(){this.onend?.();}}
   Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true});
  });
  await page.goto(base+'/office');assert.match(page.url(),/login/);await page.fill('[name=email]',env.OFFICE_OWNER_EMAIL);await page.fill('[name=password]',password);await page.click('button[type=submit]');await page.waitForURL(base+'/office');
  await page.goto(base+'/office?project='+p.id);await page.locator('[data-ready=true]').waitFor({timeout:60000});await page.getByRole('button',{name:'ENTER OFFICE'}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Owner Command',exact:true}).click();
  const panel=page.getByTestId('conversation-panel');const send=async(text:string)=>{await panel.getByRole('textbox',{name:'Your question'}).fill(text);await panel.getByRole('button',{name:'Send',exact:true}).click();await panel.getByRole('button',{name:'Send',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[data-testid=conversation-panel] button[type=submit]')?.hasAttribute('disabled')).catch(()=>{});};
  await send('Status');await panel.getByRole('log').getByText(/Conversation fixture:.*0\/0/).waitFor();const first=await panel.getByRole('log').locator('p').last().innerText();
  await panel.getByRole('button',{name:'Microphone',exact:true}).click();await panel.getByRole('button',{name:'Finish speaking',exact:true}).click();await panel.getByTestId('recognized-transcript').waitFor();await page.waitForTimeout(500);assert.equal(await panel.getByRole('log').locator('p').last().innerText(),first);
  await send('Why this design?');await panel.getByText(/temporarily unable/).waitFor();
  const beforeCount=db.prepare('SELECT COUNT(*) n FROM projects').get()!.n;
  await send('Create a tiny local counter with increment and reset');await panel.getByRole('button',{name:'Confirm action'}).waitFor();assert.equal(db.prepare('SELECT COUNT(*) n FROM projects').get()!.n,beforeCount);
  await panel.getByRole('button',{name:'Confirm action'}).click();await page.waitForTimeout(1500);assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM projects').get()!.n),Number(beforeCount)+1);
  const created=db.prepare('SELECT routingMode,aiPolicyMode FROM projects WHERE id<>?').get(p.id);assert.equal(created!.routingMode,'FREE_MULTI_MODEL');assert.equal(created!.aiPolicyMode,'LOCAL_ONLY');
  await panel.getByRole('button',{name:'New / Clear Conversation'}).click();await page.waitForTimeout(300);assert.equal(await panel.getByRole('log').locator('p').count(),0);
  await page.evaluate(()=>{Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});});await panel.getByRole('button',{name:'Microphone',exact:true}).click();await panel.getByRole('alert').getByText(/unavailable/).waitFor();
  assert.deepEqual(errors,[]);console.log('conversation checks complete');
 }catch(error){console.error('Conversation browser failure',error);const pg=browser?.contexts()[0]?.pages()[0];if(pg)console.error((await pg.locator('body').innerText()).slice(-8000));throw error;}finally{await browser?.close();if(server.pid)spawnSync('taskkill',['/pid',String(server.pid),'/T','/F'],{stdio:'ignore'});db.close();try{rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{console.warn("Temporary test files remain locked; retained at",dir);}}
});


