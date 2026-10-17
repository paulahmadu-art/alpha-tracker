const http=require('http'),fs=require('fs'),path=require('path');
const KEY=process.env.ANTHROPIC_API_KEY,CODE=process.env.APP_CODE,PORT=process.env.PORT||3000,MODEL=process.env.MODEL||'claude-sonnet-5-5';
const hits=new Map();
const limited=ip=>{const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<600000);a.push(n);hits.set(ip,a);return a.length>20};
const send=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
const PROMPT='Read this receipt or invoice image. Reply with only JSON: {"amount": number or null, "supplier": string or null, "date": "YYYY-MM-DD" or null}. Use null for anything unreadable.';
http.createServer((req,res)=>{
 const u=req.url.split('?')[0];
 if(req.method==='GET'&&(u==='/'||u==='/index.html')){fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{if(e){res.writeHead(500);return res.end('index.html is missing')}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(d)});return}
 if(req.method==='POST'&&u==='/api/read-receipt'){
  if(!KEY||!CODE)return send(res,500,{error:'Server needs ANTHROPIC_API_KEY and APP_CODE'});
  if(req.headers['x-app-code']!==CODE)return send(res,401,{error:'Wrong access code'});
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];
  if(limited(ip))return send(res,429,{error:'Too many requests'});
  let b='';req.on('data',c=>{b+=c;if(b.length>3e6)req.destroy()});
  req.on('end',async()=>{try{
   const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec((JSON.parse(b).image)||'');if(!m)return send(res,400,{error:'Bad image'});
   const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:MODEL,max_tokens:300,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:m[1],data:m[2]}},{type:'text',text:PROMPT}]}]})});
   if(!r.ok)return send(res,502,{error:'AI service error '+r.status});
   const j=await r.json(),t=(j.content||[]).map(c=>c.text||'').join(''),k=/\{[\s\S]*\}/.exec(t);
   send(res,200,k?JSON.parse(k[0]):{});
  }catch(e){send(res,500,{error:'Could not read the receipt'})}});return}
 res.writeHead(404);res.end('Not found');
}).listen(PORT,()=>console.log('Alpha Tracker running on port '+PORT));
