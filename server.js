// Kelvin Estates multiplayer server. No dependencies: just run  node server.js
// It serves the game (index.html) AND the live multiplayer connection on the same address.
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000, PAGE=path.join(__dirname,'index.html');
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/health'){res.end('ok');return;}
  fs.readFile(PAGE,(e,d)=>{if(e){res.writeHead(500);res.end('index.html missing');return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d);});});
const clients=new Map();let nid=1;
const num=v=>typeof v=='number'&&isFinite(v)?Math.max(-5000,Math.min(5000,v)):0;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f<>]/g,'').slice(0,n);
function frame(str){const b=Buffer.from(str),n=b.length;let h;
  if(n<126)h=Buffer.from([0x81,n]);else if(n<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(n,2);}
  else{h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(n),2);}
  return Buffer.concat([h,b]);}
const send=(c,o)=>{try{c.sock.write(frame(JSON.stringify(o)))}catch(e){}};
server.on('upgrade',(req,sock)=>{
  const key=req.headers['sec-websocket-key'];if(!key||clients.size>=150){sock.destroy();return;}
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+
    crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
  const id='p'+(nid++),c={sock,p:{},last:0,buf:Buffer.alloc(0)};clients.set(id,c);send(c,{t:'hi',id});
  sock.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);if(c.buf.length>20000){sock.destroy();return;}parse(id,c);});
  sock.on('close',()=>clients.delete(id));sock.on('error',()=>{clients.delete(id);sock.destroy();});});
function parse(id,c){for(;;){const b=c.buf;if(b.length<2)return;const op=b[0]&15,masked=(b[1]&128)?4:0;let len=b[1]&127,off=2;
  if(len==126){if(b.length<4)return;len=b.readUInt16BE(2);off=4;}else if(len==127){c.sock.destroy();return;}
  if(b.length<off+masked+len)return;
  let payload=Buffer.from(b.subarray(off+masked,off+masked+len));
  if(masked){const mk=b.subarray(off,off+4);for(let i=0;i<payload.length;i++)payload[i]^=mk[i%4];}
  c.buf=b.subarray(off+masked+len);
  if(op==8){c.sock.end();return;}
  if(op==9){c.sock.write(Buffer.concat([Buffer.from([0x8A,payload.length]),payload]));continue;}
  if(op==1)handle(id,c,payload.toString());}}
function handle(id,c,txt){let m;try{m=JSON.parse(txt)}catch(e){return}
  if(m.t=='p'&&m.d&&typeof m.d=='object'){const d=m.d;
    c.p={x:num(d.x),z:num(d.z),y:num(d.y),l:d.l==1?1:0,hd:num(d.hd),n:clean(d.n,14)||'Player',
      s:/^#[0-9a-f]{6}$/i.test(d.s)?d.s:'#e8833a',v:['okada','keke','car'].includes(d.v)?d.v:null};}
  else if(m.t=='c'&&m.d&&typeof m.d.t=='string'){const now=Date.now();if(now-c.last<700)return;c.last=now;
    const o={t:'c',id,d:{n:clean(m.d.n,14)||'Player',t:clean(m.d.t,120)}};clients.forEach(x=>send(x,o));}}
setInterval(()=>{if(!clients.size)return;
  const peers=[...clients].filter(([,c])=>c.p.x!==undefined).map(([id,c])=>({id,p:c.p}));
  clients.forEach(c=>send(c,{t:'s',peers}));},100);
server.listen(PORT,()=>console.log('Kelvin Estates running on port '+PORT));
