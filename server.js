const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const VIDEO_DIR = path.join(ROOT, 'videos');
const DB_FILE = path.join(DATA_DIR, 'content.json');
const BRAND = 'FOREX VISION PROS';
const TAGLINE = 'Learn Forex • Understand Markets • Trade With Discipline';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Store the last AI connection status and error message
let aiStatus = { connected: false, model: GEMINI_MODEL, error: null };

for (const d of [DATA_DIR, VIDEO_DIR]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ items: [], settings: { autopilot: false, topicIndex: 0 } }, null, 2));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/videos', express.static(VIDEO_DIR));
app.use(express.static(path.join(ROOT, 'public')));

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { items: [], settings: { autopilot: false, topicIndex: 0 } }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function id() { return crypto.randomUUID(); }
function esc(s='') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function wrapText(text, max=34) {
  const words = String(text).split(/\s+/); const lines=[]; let line='';
  for (const w of words) { if ((line+' '+w).trim().length > max) { if(line) lines.push(line); line=w; } else line=(line+' '+w).trim(); }
  if(line) lines.push(line); return lines.slice(0,5);
}

const lessonBank = [
  {level:'Beginner', topic:'What is Forex?', angle:'Explain the foreign exchange market in simple language and why currencies are traded.'},
  {level:'Beginner', topic:'What is a pip?', angle:'Explain pips with a simple EUR/USD example and why pip value matters.'},
  {level:'Beginner', topic:'What is a lot size?', angle:'Explain standard, mini and micro lots and why position size affects risk.'},
  {level:'Beginner', topic:'What is leverage?', angle:'Explain leverage, margin and why leverage can amplify both gains and losses.'},
  {level:'Beginner', topic:'What is spread?', angle:'Explain bid, ask and spread using a simple example.'},
  {level:'Beginner', topic:'What is a stop loss?', angle:'Explain stop loss as a risk-management tool without promising it prevents all losses.'},
  {level:'Beginner', topic:'What is XAU/USD?', angle:'Explain why traders call XAU/USD gold and what moves its price.'},
  {level:'Intermediate', topic:'Support and resistance', angle:'Teach the concept, how traders identify zones and common mistakes.'},
  {level:'Intermediate', topic:'EMA 20 vs EMA 50', angle:'Explain moving averages and how traders may use them for trend context.'},
  {level:'Intermediate', topic:'RSI explained', angle:'Explain RSI 14, overbought/oversold and why it should not be used alone.'},
  {level:'Intermediate', topic:'Risk-reward ratio', angle:'Explain 1:1, 1:2 and 1:3 examples and why win rate alone is not enough.'},
  {level:'Intermediate', topic:'Trading sessions', angle:'Explain London, New York and Asian sessions and why volatility changes.'},
  {level:'Advanced', topic:'Market structure', angle:'Explain higher highs, higher lows, lower highs and lower lows.'},
  {level:'Advanced', topic:'Backtesting an EA', angle:'Explain how historical backtesting works and why overfitting is dangerous.'},
  {level:'Advanced', topic:'What is algorithmic trading?', angle:'Explain rule-based automation, EAs, data, execution and risk controls.'},
  {level:'Advanced', topic:'Trading psychology', angle:'Explain why discipline and risk controls matter more than chasing every setup.'}
];

function fallbackContent(topic, level='Beginner', angle='') {
  const clean = topic || 'What is Forex?';
  return {
    title: `${clean} | Forex Vision Pros`,
    hook: `Forex made simple: let us understand ${clean.toLowerCase()} in under a minute.`,
    script: `Welcome to Forex Vision Pros. Today we are learning ${clean}. ${angle || 'This is an educational explanation designed for beginners.'} The key idea is to understand the concept before trading it.`,
    scenes: [
      `Forex Vision Pros\n${clean}`,
      `START HERE\n${clean}`,
      `KEY IDEA\n${angle || 'Understand the concept before trading it.'}`,
      `RISK CHECK\nNo strategy guarantees profit.\nUse sensible risk management.`,
      `PRACTICE\nUse a demo account first.\nBuild skill step by step.`,
      `FOLLOW\nFOREX VISION PROS\n${TAGLINE}`
    ],
    description: `Educational Forex lesson: ${clean}. Learn the concept, understand the risks, and practice before using real money.`,
    hashtags: '#Forex #ForexTrading #TradingEducation #XAUUSD #ForexVisionPros'
  };
}

async function geminiContent(topic, level, angle) {
  if (!process.env.GEMINI_API_KEY) return fallbackContent(topic, level, angle);
  const prompt = `You are the content editor for FOREX VISION PROS, a Forex education brand. Create a factual, beginner-friendly social video about: ${topic}. Level: ${level}. Angle: ${angle}. Do not provide financial advice. Return valid JSON: {title, hook, script, scenes:[...], description, hashtags}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  try {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.7}}) });
    const j = await r.json();
    if (!r.ok) {
      const errMsg = j?.error?.message || 'Gemini request failed';
      aiStatus = { connected: false, model: GEMINI_MODEL, error: errMsg };
      throw new Error(errMsg);
    }
    aiStatus = { connected: true, model: GEMINI_MODEL, error: null };
    const text = j?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
    const cleaned = text.replace(/^```json\s*/i,'').replace(/```$/,'').trim();
    const parsed = JSON.parse(cleaned);
    return { ...fallbackContent(topic, level, angle), ...parsed };
  } catch(e) {
    aiStatus = { connected: false, model: GEMINI_MODEL, error: e.message };
    return fallbackContent(topic, level, angle);
  }
}

function svgSlide(text, index, total, duration) {
  const lines = wrapText(text, 26);
  const tspans = lines.map((line,i)=>`<tspan x="360" dy="${i===0?0:76}">${esc(line)}</tspan>`).join('');
  const progress = Math.round(((index+1)/total)*100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07111f"/><stop offset="1" stop-color="#102f45"/></linearGradient></defs>
  <rect width="720" height="1280" fill="url(#g)"/>
  <circle cx="620" cy="140" r="190" fill="#19d3ae" opacity=".08"/><circle cx="90" cy="1110" r="250" fill="#4ea1ff" opacity=".08"/>
  <text x="42" y="70" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#19d3ae">${BRAND}</text>
  <text x="42" y="112" font-family="Arial, sans-serif" font-size="17" fill="#b7c6d6">${TAGLINE}</text>
  <line x1="42" y1="145" x2="678" y2="145" stroke="#29465b"/>
  <text x="360" y="520" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff">${tspans}</text>
  <rect x="42" y="1160" width="636" height="8" rx="4" fill="#243b50"/><rect x="42" y="1160" width="${636*progress/100}" height="8" rx="4" fill="#19d3ae"/>
  <text x="42" y="1215" font-family="Arial, sans-serif" font-size="18" fill="#9db0c2">Educational content • Not financial advice</text>
  <text x="678" y="1215" text-anchor="end" font-family="Arial, sans-serif" font-size="18" fill="#9db0c2">${index+1}/${total}</text>
  </svg>`;
}

function run(cmd,args) {
  return new Promise((resolve,reject)=>{
    execFile(cmd,args,{maxBuffer:10*1024*1024},(e,stdout,stderr)=>{
      if(e) return reject(new Error(stderr || e.message));
      resolve(stdout);
    });
  });
}

async function renderVideo(item) {
  const jobDir = path.join(VIDEO_DIR, item.id); fs.mkdirSync(jobDir,{recursive:true});
  const scenes = Array.isArray(item.scenes)&&item.scenes.length ? item.scenes.slice(0,8) : fallbackContent(item.topic,item.level).scenes;
  const duration = Math.max(15, Math.min(120, Number(item.duration)||30));
  const each = duration / scenes.length;
  const files=[];
  for(let i=0;i<scenes.length;i++){
    const svg = svgSlide(scenes[i],i,scenes.length,duration);
    const png = path.join(jobDir,`slide-${i}.png`);
    await sharp(Buffer.from(svg)).png().toFile(png); files.push(png);
  }
  const list = path.join(jobDir,'concat.txt');
  fs.writeFileSync(list, files.map(f=>`file '${f.replace(/'/g,"'\\''")}'\nduration ${each.toFixed(3)}`).join('\n')+`\nfile '${files[files.length-1].replace(/'/g,"'\\''")}'\n`);
  const out = path.join(VIDEO_DIR,`${item.id}.mp4`);
  await run(ffmpeg,['-y','-f','concat','-safe','0','-i',list,'-vf','scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2','-r','30','-c:v','libx264','-pix_fmt','yuv420p','-preset','faster','-b:v','2000k',out]);
  return `/videos/${item.id}.mp4`;
}

async function createItem(body) {
  const topic = String(body.topic||'').trim() || lessonBank[Math.floor(Math.random()*lessonBank.length)].topic;
  const level = String(body.level||'Beginner');
  const duration = Number(body.duration)||30;
  const angle = String(body.angle||'').trim();
  const content = await geminiContent(topic, level, angle);
  const item = { id:id(), createdAt:new Date().toISOString(), status:'RENDERING', topic, level, duration, ...content, videoUrl:null };
  const db=loadDB(); db.items.unshift(item); saveDB(db);
  try { item.videoUrl=await renderVideo(item); item.status='READY'; }
  catch(e){ item.status='ERROR'; item.error=e.message; }
  const db2=loadDB(); const idx=db2.items.findIndex(x=>x.id===item.id); if(idx>=0) db2.items[idx]=item; saveDB(db2);
  return item;
}

app.get('/api/status',(req,res)=>{
  let statusMsg = 'Engine online • Video renderer ' + (ffmpeg?'ready':'missing');
  if (!process.env.GEMINI_API_KEY) {
    statusMsg += ' • AI free-fallback (no API key)';
  } else if (aiStatus.error) {
    statusMsg += ` • AI connection error: ${aiStatus.error}`;
  } else if (aiStatus.connected) {
    statusMsg += ` • AI connected • Model: ${aiStatus.model}`;
  } else {
    statusMsg += ` • AI not yet tested • Model: ${aiStatus.model}`;
  }
  res.json({ok:true, brand:BRAND, geminiConfigured:!!process.env.GEMINI_API_KEY, model:GEMINI_MODEL, ffmpeg:!!ffmpeg, version:'1.0.0', statusMessage: statusMsg, aiStatus: aiStatus});
});
app.get('/api/content',(req,res)=>res.json(loadDB().items.slice(0,50)));
app.get('/api/lessons',(req,res)=>res.json(lessonBank));
app.get('/api/settings',(req,res)=>res.json(loadDB().settings));
app.post('/api/settings',(req,res)=>{const db=loadDB();db.settings={...db.settings,...req.body};saveDB(db);res.json(db.settings);});
app.post('/api/generate',async(req,res)=>{try{const item=await createItem(req.body);res.json(item);}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/generate-lesson',async(req,res)=>{try{const db=loadDB(); const i=(db.settings.topicIndex||0)%lessonBank.length; const l=lessonBank[i]; db.settings.topicIndex=i+1; saveDB(db); const item=await createItem(l); res.json(item);}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/content/:id',(req,res)=>{const db=loadDB();db.items=db.items.filter(x=>x.id!==req.params.id);saveDB(db);try{fs.rmSync(path.join(VIDEO_DIR,req.params.id),{recursive:true,force:true});}catch(e){}res.json({ok:true});});

app.get('/health',(req,res)=>res.json({ok:true,service:'Forex Vision Pros AI Autopilot'}));

app.get(/.*/,(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
app.listen(PORT,()=>console.log(`${BRAND} AI Autopilot running on ${PORT}`));
