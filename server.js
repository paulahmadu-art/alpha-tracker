const http=require('http'),fs=require('fs'),path=require('path'),{Pool}=require('pg');
const KEY=process.env.ANTHROPIC_API_KEY,CODE=process.env.APP_CODE,PORT=process.env.PORT||3000,MODEL=process.env.MODEL||'claude-sonnet-5-5';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const hits=new Map();
const limited=ip=>{const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<600000);a.push(n);hits.set(ip,a);return a.length>20};
const send=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
const body=(req,max)=>new Promise((ok,no)=>{let b='';req.on('data',c=>{b+=c;if(b.length>max){req.destroy();no(new Error('too big'))}});req.on('end',()=>ok(b));req.on('error',no)});
const PROMPT='Read this receipt or invoice image. Reply with only JSON: {"amount": number or null, "supplier": string or null, "date": "YYYY-MM-DD" or null}. Use null for anything unreadable.';
async function init(){
 await pool.query('CREATE TABLE IF NOT EXISTS app_state(id INT PRIMARY KEY, ver INT NOT NULL DEFAULT 0, data TEXT)');
 await pool.query('INSERT INTO app_state(id,ver) VALUES(1,0) ON CONFLICT DO NOTHING');
 await pool.query('CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, d TEXT NOT NULL)');
}
const server=http.createServer(async(req,res)=>{try{
 const u=req.url.split('?')[0];
 if(req.method==='GET'&&(u==='/'||u==='/index.html')){fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{if(e){res.writeHead(500);return res.end('index.html is missing')}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(d)});return}
 if(!u.startsWith('/api/')){res.writeHead(404);return res.end('Not found')}
 if(!CODE||!process.env.DATABASE_URL)return send(res,500,{error:'Server needs APP_CODE and DATABASE_URL'});
 if(req.headers['x-app-code']!==CODE)return send(res,401,{error:'Wrong access code'});
 if(req.method==='GET'&&u==='/api/state'){const q=await pool.query('SELECT ver,data FROM app_state WHERE id=1');return send(res,200,q.rows[0])}
 if(req.method==='PUT'&&u==='/api/state'){const j=JSON.parse(await body(req,6e6));
  const r=await pool.query('UPDATE app_state SET data=$1, ver=ver+1 WHERE id=1 AND ver=$2 RETURNING ver',[String(j.data),+j.ver]);
  return r.rowCount?send(res,200,{ver:r.rows[0].ver}):send(res,409,{error:'Someone else saved first'})}
 const m=/^\/api\/img\/([A-Za-z0-9_-]{1,40})$/.exec(u);
 if(m&&req.method==='GET'){const q=await pool.query('SELECT d FROM receipts WHERE id=$1',[m[1]]);return q.rowCount?send(res,200,q.rows[0]):send(res,404,{error:'No image'})}
 if(m&&req.method==='PUT'){const j=JSON.parse(await body(req,2e6));if(typeof j.d!=='string'||!j.d.startsWith('data:image/')||j.d.length>1.5e6)return send(res,400,{error:'Bad image'});
  await pool.query('INSERT INTO receipts(id,d) VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET d=$2',[m[1],j.d]);return send(res,200,{ok:1})}
 if(req.method==='POST'&&u==='/api/read-receipt'){
  if(!KEY)return send(res,500,{error:'Server needs ANTHROPIC_API_KEY'});
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];if(limited(ip))return send(res,429,{error:'Too many requests'});
  const im=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec((JSON.parse(await body(req,3e6)).image)||'');if(!im)return send(res,400,{error:'Bad image'});
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:MODEL,max_tokens:300,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:im[1],data:im[2]}},{type:'text',text:PROMPT}]}]})});
  if(!r.ok)return send(res,502,{error:'AI service error '+r.status});
  const j=await r.json(),t=(j.content||[]).map(c=>c.text||'').join(''),k=/\{[\s\S]*\}/.exec(t);return send(res,200,k?JSON.parse(k[0]):{})}
 send(res,404,{error:'Not found'});
}catch(e){console.error(e);send(res,500,{error:'Server error'})}});
init().then(()=>server.listen(PORT,()=>console.log('Alpha Tracker running on port '+PORT))).catch(e=>{console.error('Database setup failed:',e.message);process.exit(1)});
