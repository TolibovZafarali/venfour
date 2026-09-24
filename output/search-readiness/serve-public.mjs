import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handleRequest } from './worker-preview.mjs';
const root = new URL('./public-build/', import.meta.url).pathname;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const env = { DEPLOYMENT_ENVIRONMENT:'public-site', GOOGLE_ADS_MEASUREMENT:'false', ASSETS:{ async fetch(req) {
  const name = new URL(req.url).pathname;
  let file = name.startsWith('/assets/') || name === '/favicon.svg' || name === '/total-loss-review.html' ? name : '/index.html';
  if (file.includes('..')) return new Response('',{status:404});
  try { return new Response(await fs.readFile(path.join(root,file)),{headers:{'Content-Type':types[path.extname(file)] ?? 'application/octet-stream'}}); }
  catch { return new Response('',{status:404}); }
}}};
http.createServer(async(req,res)=>{
 try { const out=await handleRequest(new Request('https://venfour.com'+req.url,{method:req.method}),env); res.writeHead(out.status,Object.fromEntries(out.headers));res.end(Buffer.from(await out.arrayBuffer())); }
 catch {res.writeHead(500);res.end('Preview failed');}
}).listen(5200,'127.0.0.1',()=>console.log('Public Worker preview ready: http://127.0.0.1:5200/total-loss-review'));
