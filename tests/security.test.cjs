/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test harness installs a TypeScript loader for the actual server modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Load real route modules without the React compiler's server-only marker.
const originalLoad = Module._load;
Module._load = function(id, ...args) { return id === 'server-only' ? {} : originalLoad.call(this, id, ...args); };
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, file);
const owner = require('../app/lib/owner-access.ts');
const auth = require('../app/api/owner-session/route.ts');
const analyze = require('../app/api/analyze/route.ts');
const guards = require('../app/lib/request-guards.ts');
const contract = require('../app/lib/analysis-contract.ts');

const origin = 'https://granola.example';
const testCode = 'synthetic-owner-code-for-tests-only-do-not-deploy';
const testKey = 'synthetic-provider-key-for-tests-only';
const valid = {classification:'Sales Call',confidence:90,reasons:['a','b','c'],coaching_pack:{what_went_well:['a','b','c'],improvements:['a','b','c','d','e'],missed_questions:['a','b','c','d','e'],next_steps:['a','b','c'],follow_up_email:'Synthetic private marker: person@example.invalid'}};
function request(route, body, options = {}) {
  const headers = new Headers({'origin':origin,'content-type':'application/json',...options.headers});
  if (options.token) headers.set('cookie', `${owner.cookieName()}=${options.token}`);
  return new Request(origin+route, {method:options.method || 'POST',headers,body:body === undefined ? undefined : JSON.stringify(body)});
}

test('owner-only analysis, bounded input/output, session integrity and privacy', async t => {
  const savedEnv = {...process.env};
  const realFetch = global.fetch;
  const realTimeout = global.setTimeout;
  const logs = [];
  const realConsole = {log:console.log,error:console.error,warn:console.warn};
  let calls = [];
  let provider = () => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}]});
  process.env.NODE_ENV = 'production';
  process.env.AI_OWNER_ACCESS_CODE = testCode;
  process.env.OPENAI_API_KEY = testKey;
  global.fetch = async (url, options) => { calls.push({url,options}); return provider(options); };
  for (const level of Object.keys(realConsole)) console[level] = (...args) => logs.push(args);
  try {
    await t.test('unauthenticated requests never read body or call provider', async () => {
      let reads = 0;
      const req = {url:origin+'/api/analyze',headers:new Headers(),get body(){reads++;throw Error('Must not read private body')}};
      assert.equal((await analyze.POST(req)).status,401);
      assert.equal(reads,0); assert.equal(calls.length,0);
    });
    await t.test('missing and short owner configuration fail closed before body', async () => {
      for (const code of ['', 'too-short', ' '.repeat(32), 'x'.repeat(64), 'change-me-to-a-secure-private-access-code']) {
        process.env.AI_OWNER_ACCESS_CODE = code;
        assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'}))).status,503);
        assert.equal((await auth.POST(request('/api/owner-session',{code:testCode}))).status,503);
      }
      assert.equal(calls.length,0); process.env.AI_OWNER_ACCESS_CODE = testCode;
    });
    let token;
    await t.test('same-origin login returns a secure one-hour host-only cookie', async () => {
      const response = await auth.POST(request('/api/owner-session',{code:testCode}));
      assert.equal(response.status,200);
      const cookie = response.headers.get('set-cookie');
      for (const flag of ['__Host-granola-owner-session=','HttpOnly','Secure','SameSite=strict','Path=/','Max-Age=3600']) assert.ok(cookie.includes(flag),flag);
      assert.ok(!cookie.toLowerCase().includes('domain='));
      token = cookie.split(';')[0].split('=')[1];
      assert.equal(owner.validOwnerSession(token),true);
      assert.ok(!(await response.text()).includes(testCode));
    });
    await t.test('wrong code, content type and login origin rejected without provider work', async () => {
      assert.equal((await auth.POST(request('/api/owner-session',{code:'wrong'}))).status,401);
      assert.equal((await auth.POST(request('/api/owner-session',{code:testCode},{headers:{origin:'https://evil.example'}}))).status,403);
      assert.equal((await auth.POST(request('/api/owner-session',{code:testCode},{headers:{origin:'null'}}))).status,403);
      assert.equal((await auth.POST(request('/api/owner-session',{code:testCode},{headers:{'content-type':'text/plain'}}))).status,415);
      assert.equal(calls.length,0);
    });
    await t.test('tampered, expired and wrong-purpose sessions rejected', async () => {
      const bad = token.slice(0,-2)+(token.endsWith('aa')?'bb':'aa');
      const expired = owner.createOwnerSession(Date.now()-3601_000);
      for (const session of [bad,expired,'garbage',token+'.extra']) assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'},{token:session}))).status,401);
      assert.equal(owner.validOwnerSession(token,Date.now()+3601_000),false);
      const payload = Buffer.from(JSON.stringify({purpose:'other-app',issued:0,expires:3600,nonce:'0'.repeat(32)})).toString('base64url');
      assert.equal(owner.validOwnerSession(payload+'.'+token.split('.')[1]),false);
      assert.equal(calls.length,0);
    });
    await t.test('authenticated cross-origin, missing Origin and cross-site metadata blocked', async () => {
      for (const headers of [{origin:'https://evil.example'},{origin:'null'},{'sec-fetch-site':'cross-site'}]) assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'},{token,headers}))).status,403);
      const noOrigin = request('/api/analyze',{transcript:'x'},{token}); noOrigin.headers.delete('origin');
      assert.equal((await analyze.POST(noOrigin)).status,403); assert.equal(calls.length,0);
    });
    await t.test('origin follows actual Host behind Next internal URL normalization', async () => {
      const headers=new Headers({origin,host:'granola.example','x-forwarded-proto':'https','x-forwarded-host':'untrusted.example'});
      assert.doesNotThrow(()=>guards.requireSameOrigin({url:'http://localhost:3000/api/analyze',headers}));
      for (const host of ['granola.example,evil.example','granola.example/path','user@granola.example','granola.example evil.example']) {
        headers.set('host',host);
        assert.throws(()=>guards.requireSameOrigin({url:origin,headers}),error=>error.status===403);
      }
      headers.set('host','granola.example'); headers.set('x-forwarded-proto','https,http');
      assert.throws(()=>guards.requireSameOrigin({url:origin,headers}),error=>error.status===403);
      headers.set('x-forwarded-proto','https'); headers.set('origin',origin+'/');
      assert.throws(()=>guards.requireSameOrigin({url:origin,headers}),error=>error.status===403);
      assert.equal(calls.length,0);
    });
    await t.test('invalid transcript types, empty text, extra fields and oversized inputs rejected', async () => {
      for (const body of [null,[],{}, {transcript:123},{transcript:{}},{transcript:'   '},{transcript:'x',unexpected:true}]) assert.equal((await analyze.POST(request('/api/analyze',body,{token}))).status,400);
      assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'.repeat(8001)},{token}))).status,413);
      const malformed = new Request(origin+'/api/analyze',{method:'POST',headers:{origin,'content-type':'application/json',cookie:`${owner.cookieName()}=${token}`},body:'{'});
      assert.equal((await analyze.POST(malformed)).status,400);
      const raw = new Request(origin+'/api/analyze',{method:'POST',headers:{origin,'content-type':'text/plain',cookie:`${owner.cookieName()}=${token}`},body:'{}'});
      assert.equal((await analyze.POST(raw)).status,415); assert.equal(calls.length,0);
    });
    await t.test('streamed bytes bounded without trusting Content-Length', async () => {
      const chunks=[new Uint8Array(7),new Uint8Array(7)]; let cancelled=false;
      const body = new ReadableStream({pull(c){const chunk=chunks.shift();if(chunk)c.enqueue(chunk)},cancel(){cancelled=true}});
      const req={headers:new Headers({'content-type':'application/json','content-length':'1'}),body};
      await assert.rejects(()=>guards.readJsonBounded(req,10),error=>error.status===413);
      assert.equal(cancelled,true);
    });
    await t.test('stalled body reads time out and cancel the stream', async () => {
      let cancelled = false;
      const body = new ReadableStream({cancel(){cancelled=true}});
      const req = {headers:new Headers({'content-type':'application/json'}),body};
      await assert.rejects(()=>guards.readJsonBounded(req,100,5),error=>error.status===408);
      assert.equal(cancelled,true); assert.equal(calls.length,0);
    });
    await t.test('valid owner works using provider stub; secrets absent from output/prompt/logs', async () => {
      const response = await analyze.POST(request('/api/analyze',{transcript:'  Synthetic product meeting  '},{token}));
      assert.equal(response.status,200); assert.equal(calls.length,1);
      const data=await response.json(); assert.deepEqual(data.result,valid);
      assert.ok(response.headers.get('cache-control').includes('no-store'));
      const submitted=JSON.parse(calls[0].options.body);
      assert.equal(submitted.max_completion_tokens,2000); assert.ok(calls[0].options.signal instanceof AbortSignal);
      assert.equal(JSON.stringify(submitted).includes(testKey),false); assert.equal(JSON.stringify(submitted).includes(testCode),false);
      assert.equal(JSON.stringify(data).includes(testKey),false); assert.equal(JSON.stringify(data).includes(testCode),false);
      assert.equal(logs.length,0);
    });
    await t.test('missing provider config makes no paid call', async () => {
      delete process.env.OPENAI_API_KEY; const count=calls.length;
      assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'},{token}))).status,503);
      assert.equal(calls.length,count); process.env.OPENAI_API_KEY=testKey;
    });
    await t.test('provider errors/refusals/invalid output sanitized', async () => {
      for (const outcome of [()=>Response.json({error:{message:testKey+' '+testCode}},{status:401}),()=>Response.json({choices:[]}),()=>Response.json({choices:[{finish_reason:'length',message:{content:'broken'}}]}),()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"classification":"Sales Call"}'}}]}),()=>{throw Error(testKey+' '+testCode)}]) {
        provider=outcome; const response=await analyze.POST(request('/api/analyze',{transcript:'x'},{token}));
        assert.equal(response.status,502); const text=await response.text(); assert.ok(!text.includes(testKey)); assert.ok(!text.includes(testCode));
      }
      assert.equal(logs.length,0);
    });
    await t.test('provider timeout aborts and returns sanitized 504', async () => {
      global.setTimeout=(fn)=>realTimeout(fn,1);
      provider=options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Synthetic timeout')),{once:true}));
      assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'},{token}))).status,504);
      global.setTimeout=realTimeout; assert.equal(logs.length,0);
    });
    await t.test('stalled provider response body also times out and is cancelled', async () => {
      let cancelled=false;
      global.setTimeout=(fn)=>realTimeout(fn,1);
      provider=()=>new Response(new ReadableStream({cancel(){cancelled=true}}),{headers:{'content-type':'application/json'}});
      assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'},{token}))).status,504);
      assert.equal(cancelled,true); global.setTimeout=realTimeout;
    });
    await t.test('server enforces response size, array counts and field bounds', async () => {
      assert.equal(contract.validAnalysis({...valid,confidence:101}),false);
      assert.equal(contract.validAnalysis({...valid,reasons:['a']}),false);
      assert.equal(contract.validAnalysis({...valid,extra:'unexpected'}),false);
      assert.equal(contract.validAnalysis({...valid,coaching_pack:{...valid.coaching_pack,follow_up_email:'x'.repeat(3001)}}),false);
      provider=()=>Response.json({padding:'x'.repeat(65536)});
      assert.equal((await analyze.POST(request('/api/analyze',{transcript:'x'},{token}))).status,502);
    });
    await t.test('logout expires cookie and rejects cross-origin logout', async () => {
      const response=await auth.DELETE(request('/api/owner-session',undefined,{method:'DELETE',token}));
      assert.equal(response.status,200); assert.ok(response.headers.get('set-cookie').includes('Max-Age=0'));
      assert.equal((await auth.DELETE(request('/api/owner-session',undefined,{method:'DELETE',headers:{origin:'https://evil.example'}}))).status,403);
      assert.equal((await auth.GET(request('/api/owner-session',undefined,{method:'GET',token}))).status,200);
    });
    await t.test('new client history is never persistently written; existing history deletion is explicit', () => {
      const page=fs.readFileSync(path.join(__dirname,'../app/page.tsx'),'utf8');
      const component=fs.readFileSync(path.join(__dirname,'../app/components/owner-access.tsx'),'utf8');
      assert.ok(!page.includes('localStorage.setItem')); assert.ok(!page.includes('sessionStorage'));
      assert.ok(page.includes('localStorage.getItem("meetingHistory") !== null'));
      assert.ok(page.match(/function clearHistory\(\)\{[\s\S]*?localStorage\.removeItem/));
      assert.ok(!component.includes('localStorage')&&!component.includes('sessionStorage'));
      assert.ok(component.includes('submittedForm.reset()'));
      assert.ok(!page.includes('console.')&&!component.includes('console.'));
    });
  } finally {
    global.fetch=realFetch; global.setTimeout=realTimeout;
    for (const level of Object.keys(realConsole)) console[level]=realConsole[level];
    for (const name of ['NODE_ENV','AI_OWNER_ACCESS_CODE','OPENAI_API_KEY']) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name]=savedEnv[name];
    }
    Module._load=originalLoad;
  }
});
