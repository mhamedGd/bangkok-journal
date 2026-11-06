import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, GitHubError, encodeText, decodeText, applyOperation, validateJournal, validPhotoPath } from '../site/github.js';
const settings = { owner:'owner', ownerId:42, repo:'journal', branch:'main', dataPath:'site/data/memories.json' };
const empty = () => ({version:1,memories:[]});
const memory = (id='one', overrides={}) => ({id,title:'Bangkok กรุงเทพฯ 🌅',place:'Riverside',note:'A lovely evening',date:'2026-11-01',tag:'Exploring',lat:13.74,lng:100.49,createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z',photos:[],...overrides});
function mockGitHub({userId=42, push=true, journal=empty(), concurrent=false, uploadFails=false, ruleFailure=false} = {}) {
  const calls=[]; let head='head-0', count=0, patchCount=0;
  const commits = new Map([[head,{tree:{sha:'tree-0'}}]]);
  const journals = new Map([[head,structuredClone(journal)]]);
  const trees = new Map();
  async function transport(url, options) {
    const path = new URL(url).pathname, method=options.method || 'GET', body=options.body ? JSON.parse(options.body):null;
    calls.push({path,method,body,headers:options.headers});
    const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(path==='/user') return reply({id:userId,login:'owner'});
    if(path==='/repos/owner/journal') return reply({permissions:{push}});
    if(path.includes('/git/ref/heads/')) return reply({object:{sha:head}});
    if(path.includes('/git/commits/') && method==='GET') return reply(commits.get(path.split('/').at(-1)));
    if(path.includes('/contents/')) { const sha=new URL(url).searchParams.get('ref');return reply({encoding:'base64',content:encodeText(JSON.stringify(journals.get(sha)))}); }
    if(path.endsWith('/git/blobs')) return uploadFails ? reply({},403):reply({sha:'photo-blob'});
    if(path.endsWith('/git/trees')) { const sha=`tree-${++count}`;trees.set(sha,body);return reply({sha}); }
    if(path.endsWith('/git/commits')) { const sha=`commit-${++count}`;commits.set(sha,{tree:{sha:body.tree},parents:body.parents}); const data=JSON.parse(trees.get(body.tree).tree.find(f=>f.path===settings.dataPath).content);journals.set(sha,data); return reply({sha}); }
    if(path.includes('/git/refs/heads/') && method==='PATCH') {
      patchCount++;
      if(ruleFailure) return reply({},422);
      if(concurrent && patchCount===1) { head='other-commit';commits.set(head,{tree:{sha:'other-tree'}});journals.set(head,{version:1,memories:[memory('other')]});return reply({},422); }
      if(commits.get(body.sha).parents[0]!==head) return reply({},422);
      head=body.sha;return reply({object:{sha:head}});
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  }
  return { transport, calls, journals, getHead:()=>head };
}
test('Unicode notes and Thai names survive GitHub base64 encoding',()=>assert.equal(decodeText(encodeText('กรุงเทพฯ 🌅 café')),'กรุงเทพฯ 🌅 café'));
test('only the configured GitHub account can unlock editing',async()=>{
  const mock=mockGitHub({userId:99});const client=new GitHubClient('test-key',settings,mock.transport);
  await assert.rejects(client.authenticate(),/Only owner/);assert.equal(mock.calls.length,1);await assert.rejects(client.readLatest(),/locked/);
});
test('an owner still needs repository write access',async()=>{
  const mock=mockGitHub({push:false});await assert.rejects(new GitHubClient('test-key',settings,mock.transport).authenticate(),/cannot write/);
});
test('photo URLs cannot escape the journal photo directory',()=>{
  for(const path of ['../secret.jpg','https://example.com/x.jpg','photos/id/../../x.jpg','photos/id/file.svg']) assert.equal(validPhotoPath(path),false);
  assert.equal(validPhotoPath('photos/memory-id/photo-id.jpg'),true);
  assert.throws(()=>validateJournal({version:1,memories:[memory('one',{photos:[{path:'https://evil.test/x',alt:'test'}]})]}),/invalid photos/);
});
test('concurrent edits to the same memory are rejected without losing text',()=>{
  const latest={version:1,memories:[memory('one',{updatedAt:'newer'})]};
  assert.throws(()=>applyOperation(latest,{type:'upsert',id:'one',baseUpdatedAt:'older',memory:memory()}),/another tab/);
  assert.equal(latest.memories[0].updatedAt,'newer');
});
test('a repeated completed save is idempotent',()=>{
  const m=memory(),journal={version:1,memories:[m]};assert.equal(applyOperation(journal,{type:'upsert',id:m.id,memory:m,baseUpdatedAt:null}),journal);
});
test('notes and photos publish together in exactly one non-forced commit',async()=>{
  const mock=mockGitHub(), client=new GitHubClient('test-key',settings,mock.transport);
  const m=memory('one',{photos:[{path:'photos/one/photo.jpg',alt:'River'}]});
  const saved=await client.commitOperation({type:'upsert',id:m.id,memory:m,baseUpdatedAt:null},[{path:'photos/one/photo.jpg',base64:'aW1hZ2U='}]);
  assert.equal(saved.journal.memories[0].title,m.title);
  const tree=mock.calls.find(c=>c.path.endsWith('/git/trees')).body;
  assert.equal(tree.tree.length,2);assert.equal(tree.tree[1].path,'site/photos/one/photo.jpg');
  const patches=mock.calls.filter(c=>c.method==='PATCH');assert.equal(patches.length,1);assert.equal(patches[0].body.force,false);
  assert.equal(mock.calls.filter(c=>c.path.endsWith('/git/commits')&&c.method==='POST').length,1);
});
test('an unrelated simultaneous save is merged before retrying publication',async()=>{
  const mock=mockGitHub({concurrent:true});const saved=await new GitHubClient('test-key',settings,mock.transport).commitOperation({type:'upsert',id:'one',memory:memory(),baseUpdatedAt:null});
  assert.deepEqual(saved.journal.memories.map(m=>m.id).sort(),['one','other']);assert.equal(mock.calls.filter(c=>c.method==='PATCH').length,2);
});
test('a rejected photo upload never advances the branch',async()=>{
  const mock=mockGitHub({uploadFails:true});await assert.rejects(new GitHubClient('test-key',settings,mock.transport).commitOperation({type:'upsert',id:'one',memory:memory(),baseUpdatedAt:null},[{path:'photos/one/photo.jpg',base64:'aW1hZ2U='}]),GitHubError);
  assert.equal(mock.calls.some(c=>c.method==='PATCH'),false);assert.equal(mock.getHead(),'head-0');
});
test('deleting a memory removes its photo from the published tree',async()=>{
  const m=memory('one',{photos:[{path:'photos/one/photo.jpg',alt:'River'}]});const mock=mockGitHub({journal:{version:1,memories:[m]}});
  const saved=await new GitHubClient('test-key',settings,mock.transport).commitOperation({type:'delete',id:'one',baseUpdatedAt:m.updatedAt},[],['photos/one/photo.jpg']);
  assert.equal(saved.journal.memories.length,0);assert.equal(mock.calls.find(c=>c.path.endsWith('/git/trees')).body.tree.find(f=>f.path==='site/photos/one/photo.jpg').sha,null);
});
test('repository rule failures are surfaced without retrying blindly',async()=>{
  const mock=mockGitHub({ruleFailure:true});await assert.rejects(new GitHubClient('test-key',settings,mock.transport).commitOperation({type:'upsert',id:'one',memory:memory(),baseUpdatedAt:null}),/could not publish/);
  assert.equal(mock.calls.filter(c=>c.method==='PATCH').length,1);
});
test('the default browser transport calls fetch without an invalid receiver',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=function(url){assert.equal(this,undefined);return Promise.resolve(new Response(JSON.stringify({id:99,login:'visitor'})));};
    await assert.rejects(new GitHubClient('test-key',settings).authenticate(),/Only owner/);
  }finally{globalThis.fetch=original;}
});
test('a conflicting save returns the latest journal so reopening can recover',async()=>{
  const current=memory('one',{note:'Saved in another tab',updatedAt:'newer'});
  const mock=mockGitHub({journal:{version:1,memories:[current]}});
  const client=new GitHubClient('test-key',settings,mock.transport);
  await assert.rejects(client.commitOperation({type:'upsert',id:'one',memory:memory(),baseUpdatedAt:'older'}),error=>{
    assert.equal(error.latestJournal.memories[0].note,current.note);return /another tab/.test(error.message);
  });
  assert.equal(mock.calls.some(c=>c.method==='PATCH'),false);
});
