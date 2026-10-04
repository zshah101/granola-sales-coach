/* eslint-disable @typescript-eslint/no-require-imports -- Controlled Node harness loads the real client component without a browser or provider. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const react = require('react');

const originalLoad = Module._load;
let slots = [], cursor = 0;
const hooks = {
  ...react,
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = {current:initial};
    return slots[index];
  },
  useEffect() {},
  useCallback(callback) { return callback; },
};
Module._load = function(id, ...args) { return id === 'react' ? hooks : originalLoad.call(this, id, ...args); };
for (const extension of ['.ts','.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText,file);
const Home = require('../app/page.tsx').default;
Module._load = originalLoad;

function render() { cursor=0; return Home(); }
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found=find(child,predicate); if(found)return found; }
  return null;
}
function button(tree,label) { const found=find(tree,node=>node.type==='button'&&node.props.children===label); assert.ok(found,label); return found; }
function owner(tree) { const found=find(tree,node=>node.type?.name==='OwnerAccess'); assert.ok(found); return found; }
function prepareOwner() {
  owner(render()).props.onChange(true);
  find(render(),node=>node.type==='textarea').props.onChange({target:{value:'Synthetic meeting'}});
}
const result={classification:'Not Sales Call',confidence:90,reasons:['a','b','c'],coaching_pack:null};

test('late analysis responses cannot restore data after logout, deletion or a newer request', async () => {
  const realFetch=global.fetch;
  const realStorage=global.localStorage;
  try {
    global.localStorage={removeItem(){}};
    for (const action of ['logout','delete']) {
      slots=[];
      prepareOwner();
      global.fetch=async()=>Response.json({result});
      await button(render(),'Analyze Meeting').props.onClick();
      let resolve, signal;
      global.fetch=(_,options)=>{signal=options.signal;return new Promise(done=>{resolve=done});};
      const pending=button(render(),'Analyze Meeting').props.onClick();
      if (action==='logout') owner(render()).props.onChange(false);
      else button(render(),'Delete history').props.onClick();
      assert.equal(signal.aborted,true);
      // Deliberately let the mocked transport resolve after abort to test the guard.
      resolve(Response.json({result})); await pending;
      assert.equal(slots[0],''); assert.equal(slots[1],null); assert.deepEqual(slots[3],[]);
    }
    slots=[]; prepareOwner();
    const requests=[];
    global.fetch=(_,options)=>new Promise(resolve=>requests.push({resolve,signal:options.signal}));
    const analyze=button(render(),'Analyze Meeting').props.onClick;
    const first=analyze(), second=analyze();
    assert.equal(requests[0].signal.aborted,true);
    requests[0].resolve(Response.json({result})); await first;
    assert.equal(slots[2],true,'superseded cleanup must not enable the button');
    assert.equal(slots[1],null);
    requests[1].resolve(Response.json({result})); await second;
    assert.deepEqual(slots[1],result); assert.equal(slots[2],false); assert.equal(slots[3].length,1);
  } finally {
    global.fetch=realFetch;
    if (realStorage === undefined) delete global.localStorage; else global.localStorage=realStorage;
  }
});
