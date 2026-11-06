// Local-only UI test server. Uses a fake key and an in-memory GitHub API.
// Nothing here is included in the published site or sent to GitHub.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { config } from '../site/config.js';
import { encodeText } from '../site/github.js';
const root=resolve('site'), origin='http://localhost:4180';
let head='initial', count=0;
const empty={version:1,memories:[]};
const commits=new Map([[head,{tree:{sha:'initial-tree'},journal:empty}]]),trees=new Map(),blobs=new Map();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,origin);let path=decodeURIComponent(url.pathname);
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(path.startsWith('/api/')) {
      if(req.headers.authorization!=='Bearer preview-key')return json({},401);
      path=path.slice(4);let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):null;
      if(path==='/user')return json({id:config.ownerId,login:config.owner});
      if(path===`/repos/${config.owner}/${config.repo}`)return json({permissions:{push:true}});
      if(path.includes('/git/ref/heads/'))return json({object:{sha:head}});
      if(path.includes('/git/commits/')&&req.method==='GET')return json(commits.get(path.split('/').at(-1)));
      if(path.includes('/contents/'))return json({encoding:'base64',content:encodeText(JSON.stringify(commits.get(url.searchParams.get('ref')).journal))});
      if(path.endsWith('/git/blobs')){const sha=`blob-${++count}`;blobs.set(sha,Buffer.from(body.content,'base64'));return json({sha});}
      if(path.endsWith('/git/trees')){const sha=`tree-${++count}`;trees.set(sha,body);return json({sha});}
      if(path.endsWith('/git/commits')){const sha=`commit-${++count}`;const tree=trees.get(body.tree);const journal=JSON.parse(tree.tree.find(f=>f.path===config.dataPath).content);commits.set(sha,{tree:{sha:body.tree},journal,parent:body.parents[0],entries:tree.tree});return json({sha});}
      if(path.includes('/git/refs/heads/')&&req.method==='PATCH'){if(commits.get(body.sha).parent!==head)return json({},422);head=body.sha;return json({object:{sha:head}});}
      return json({},404);
    }
    if(path==='/data/memories.json')return json(commits.get(head).journal);
    const photoPath=path.includes('/site/photos/')?path.slice(path.indexOf('/site/photos/')+5):path;
    if(photoPath.startsWith('/photos/')) {
      for(const commit of [...commits.values()].reverse()) {
        const entry=commit.entries?.find(e=>e.path===`site${photoPath}`);
        if(entry?.sha&&blobs.has(entry.sha)){res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end(blobs.get(entry.sha));}
      }
    }
    if(path==='/')path='/index.html';const file=resolve(root,`.${path}`);if(!file.startsWith(`${root}/`))return json({},403);
    let data=await readFile(file);
    if(path==='/github.js')data=Buffer.from(data.toString().replace('https://api.github.com',`${origin}/api`));
    if(path==='/app.js')data=Buffer.from(data.toString().replace('https://raw.githubusercontent.com',origin));
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4180,'127.0.0.1',()=>console.log('Local UI test fixture: http://localhost:4180 — key: preview-key'));
