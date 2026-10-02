const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
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
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'google-translate';
const TTS_API_KEY = process.env.TTS_API_KEY || '';
const FFPROBE_PATH = ffprobeStatic && ffprobeStatic.path ? ffprobeStatic.path : 'ffprobe';

// Professional video format constants
const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_FPS = 30;
const SAFE_MARGIN = 80;

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

/**
 * Safely extract text from any data type
 * Handles: strings, objects with text/title/body/content, arrays, etc.
 * Never returns "[object Object]"
 */
function extractText(data) {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data.trim();
  if (typeof data === 'number') return String(data);
  if (Array.isArray(data)) return data.map(extractText).filter(t => t.length > 0).join(' ');
  if (typeof data === 'object') {
    if (data.text) return extractText(data.text);
    if (data.title) return extractText(data.title);
    if (data.body) return extractText(data.body);
    if (data.content) return extractText(data.content);
    if (data.message) return extractText(data.message);
    if (data.description) return extractText(data.description);
    for (const key in data) {
      const val = data[key];
      if (typeof val === 'string' && val.trim().length > 0) return val.trim();
    }
    return '';
  }
  return '';
}

function wrapText(text, max=34) {
  const cleanText = extractText(text);
  const words = cleanText.split(/\s+/).filter(w => w.length > 0);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function wrapCaption(text, maxChars=60) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines.slice(0, 3);
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
    script: `Welcome to Forex Vision Pros. Today we are learning ${clean}. ${angle || 'This is an educational explanation designed for beginners.'} The key idea is to understand the concept before trading it. Always use risk management and never assume a strategy guarantees profit.`,
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
  const prompt = `You are the content editor for FOREX VISION PROS, a Forex education brand. Create a factual, beginner-friendly social video about: ${topic}. Level: ${level}. Angle: ${angle}. Do not use financial advice claims or guarantee profits. Return valid JSON with keys title, hook, script, scenes, description, hashtags.`;
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

function createSimpleCandleChart() {
  const w = VIDEO_WIDTH - 2*SAFE_MARGIN;
  const h = 400;
  const candles = [
    { o: 1.1000, h: 1.1050, l: 1.0950, c: 1.1020, x: 80 },
    { o: 1.1020, h: 1.1100, l: 1.1000, c: 1.1080, x: 200 },
    { o: 1.1080, h: 1.1150, l: 1.1050, c: 1.1120, x: 320 }
  ];
  const minPrice = 1.0950;
  const maxPrice = 1.1150;
  const range = maxPrice - minPrice;
  
  let candleSvg = '';
  for (const c of candles) {
    const yh = h - ((c.h - minPrice) / range) * h;
    const yl = h - ((c.l - minPrice) / range) * h;
    const yo = h - ((c.o - minPrice) / range) * h;
    const yc = h - ((c.c - minPrice) / range) * h;
    const bodyTop = Math.min(yo, yc);
    const bodyHeight = Math.abs(yo - yc) || 2;
    const color = c.c >= c.o ? '#19d3ae' : '#ff6b6b';
    
    candleSvg += `<line x1="${c.x}" y1="${yh}" x2="${c.x}" y2="${yl}" stroke="${color}" stroke-width="1"/><rect x="${c.x-10}" y="${bodyTop}" width="20" height="${bodyHeight}" fill="${color}" opacity="0.8"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background: rgba(12, 26, 40, 0.6); border-radius: 8px; margin: 20px auto;">
    <text x="${w/2}" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#19d3ae" font-weight="700">EUR/USD 1H Chart</text>
    ${candleSvg}
    <line x1="0" y1="${h-1}" x2="${w}" y2="${h-1}" stroke="#29465b" stroke-width="1"/>
  </svg>`;
}

function createProfessionalSlide(content, captionText, slideType='content', progress=0) {
  const lines = wrapCaption(captionText, 65);
  const captionSpacing = 50;
  let captionSvg = '';
  
  for (let i = 0; i < lines.length; i++) {
    const y = VIDEO_HEIGHT - 280 + (i * captionSpacing);
    captionSvg += `<rect x="${SAFE_MARGIN}" y="${y-35}" width="${VIDEO_WIDTH-2*SAFE_MARGIN}" height="50" fill="rgba(12, 26, 40, 0.85)" rx="4"/><text x="${VIDEO_WIDTH/2}" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#ffffff">${esc(lines[i])}</text>`;
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}">
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06101b"/><stop offset="1" stop-color="#0c1a28"/></linearGradient>
    </defs>
    <rect width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" fill="url(#bgGrad)"/>
    <circle cx="${VIDEO_WIDTH-150}" cy="200" r="250" fill="#19d3ae" opacity="0.06"/>
    <circle cx="150" cy="${VIDEO_HEIGHT-300}" r="300" fill="#4ea1ff" opacity="0.05"/>`;

  // Header with branding
  svg += `<rect x="0" y="0" width="${VIDEO_WIDTH}" height="120" fill="rgba(12, 26, 40, 0.9)"/>
    <line x1="${SAFE_MARGIN}" y1="115" x2="${VIDEO_WIDTH-SAFE_MARGIN}" y2="115" stroke="#29465b" stroke-width="2"/>
    <text x="${SAFE_MARGIN}" y="50" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#19d3ae">${BRAND}</text>
    <text x="${SAFE_MARGIN}" y="85" font-family="Arial, sans-serif" font-size="14" fill="#91a6b9">${TAGLINE}</text>`;

  // Main content area
  if (slideType === 'title') {
    svg += `<text x="${VIDEO_WIDTH/2}" y="${VIDEO_HEIGHT/2-100}" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#19d3ae">${esc(content.split('\n')[0])}</text>
      <text x="${VIDEO_WIDTH/2}" y="${VIDEO_HEIGHT/2+50}" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" fill="#ffffff">${esc(content.split('\n').slice(1).join(' '))}</text>`;
  } else if (slideType === 'chart') {
    svg += `<text x="${VIDEO_WIDTH/2}" y="200" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#ffffff">${esc(content)}</text>
      <rect x="${SAFE_MARGIN}" y="280" width="${VIDEO_WIDTH-2*SAFE_MARGIN}" height="400" fill="rgba(12, 26, 40, 0.6)" rx="8" stroke="#29465b" stroke-width="2"/>
      <text x="${SAFE_MARGIN+30}" y="520" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#19d3ae">EUR/USD Movement</text>
      <line x1="${SAFE_MARGIN+30}" y1="600" x2="${SAFE_MARGIN+80}" y2="550" stroke="#19d3ae" stroke-width="3"/>
      <circle cx="${SAFE_MARGIN+80}" cy="550" r="8" fill="#19d3ae"/>
      <line x1="${SAFE_MARGIN+80}" y1="550" x2="${SAFE_MARGIN+200}" y2="480" stroke="#19d3ae" stroke-width="3"/>
      <circle cx="${SAFE_MARGIN+200}" cy="480" r="8" fill="#19d3ae"/>`;
  } else {
    svg += `<text x="${VIDEO_WIDTH/2}" y="200" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff">${esc(content)}</text>`;
  }

  // Caption area
  svg += captionSvg;

  // Footer with progress and disclaimer
  svg += `<rect x="0" y="${VIDEO_HEIGHT-80}" width="${VIDEO_WIDTH}" height="80" fill="rgba(12, 26, 40, 0.95)"/>
    <line x1="${SAFE_MARGIN}" y1="${VIDEO_HEIGHT-80}" x2="${VIDEO_WIDTH-SAFE_MARGIN}" y2="${VIDEO_HEIGHT-80}" stroke="#29465b" stroke-width="2"/>
    <rect x="${SAFE_MARGIN}" y="${VIDEO_HEIGHT-50}" width="${(VIDEO_WIDTH-2*SAFE_MARGIN)*progress}" height="6" rx="3" fill="#19d3ae"/>
    <rect x="${SAFE_MARGIN}" y="${VIDEO_HEIGHT-50}" width="${VIDEO_WIDTH-2*SAFE_MARGIN}" height="6" rx="3" fill="#243b50" opacity="0.6"/>
    <text x="${SAFE_MARGIN}" y="${VIDEO_HEIGHT-15}" font-family="Arial, sans-serif" font-size="12" fill="#9db0c2">Educational content • Not financial advice</text></svg>`;

  return svg;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024 }, (e, stdout, stderr) => {
      if (e) return reject(new Error(stderr || e.message));
      resolve(stdout);
    });
  });
}

function sanitizeNarrationText(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim();

  if (!clean) return '';
  const max = 220;
  return clean.length > max ? clean.slice(0, max) : clean;
}

function splitNarrationText(text, maxLen = 180) {
  const clean = sanitizeNarrationText(text);
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [clean];
}

async function probeMedia(filePath) {
  try {
    const result = await run(FFPROBE_PATH, [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-print_format', 'json',
      filePath
    ]);
    return JSON.parse(result);
  } catch (error) {
    console.error(`Probe failed for ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * ============================================
 * TTS AUDIO GENERATION - UNCHANGED
 * ============================================
 * The existing working TTS implementation
 * is preserved exactly as-is.
 */
async function generateTTSAudio(text, jobDir) {
  const cleanText = sanitizeNarrationText(text);
  if (!cleanText) {
    console.log('TTS started');
    console.log('Voice generation failed');
    return null;
  }

  console.log('TTS started');

  const chunkList = splitNarrationText(cleanText);
  const mp3Buffers = [];

  for (const chunk of chunkList) {
    const params = new URLSearchParams({
      ie: 'UTF-8',
      client: 'tw-ob',
      tl: 'en',
      q: chunk
    });

    const url = `https://translate.google.com/translate_tts?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status} ${response.statusText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (audioBuffer.length > 200) {
      mp3Buffers.push(audioBuffer);
    }
  }

  if (!mp3Buffers.length) {
    console.log('Voice generation failed');
    return null;
  }

  const audioPath = path.join(jobDir, 'narration.mp3');
  fs.writeFileSync(audioPath, Buffer.concat(mp3Buffers));

  const stats = fs.statSync(audioPath);
  if (!stats || stats.size <= 0) {
    console.log('Voice generation failed');
    return null;
  }

  console.log('TTS audio generated');
  console.log(`Audio file size: ${stats.size} bytes`);

  const media = await probeMedia(audioPath);
  const audioStream = media && media.streams && media.streams.find(s => s.codec_type === 'audio');

  if (!audioStream || Number(audioStream.duration || 0) <= 0 || Number(audioStream.bit_rate || 0) <= 0) {
    console.log('Voice generation failed');
    return null;
  }

  return audioPath;
}

/**
 * ============================================
 * VIDEO RENDERING - UPGRADED VISUAL
 * ============================================
 * Professional 1080x1920 format with captions,
 * branding, and chart visuals.
 */
async function renderVideo(item) {
  const jobDir = path.join(VIDEO_DIR, item.id);
  fs.mkdirSync(jobDir, { recursive: true });

  const scenes = Array.isArray(item.scenes) && item.scenes.length
    ? item.scenes.slice(0, 8)
    : fallbackContent(item.topic, item.level).scenes;

  const duration = Math.max(15, Math.min(120, Number(item.duration) || 30));
  const each = duration / scenes.length;
  const files = [];

  // Generate professional slides with captions
  for (let i = 0; i < scenes.length; i++) {
    const progress = (i + 1) / scenes.length;
    const sceneText = extractText(scenes[i]);
    let slideType = 'content';
    if (i === 0) slideType = 'title';
    if (sceneText.toLowerCase().includes('chart') || sceneText.toLowerCase().includes('movement')) slideType = 'chart';

    const svg = createProfessionalSlide(sceneText, sceneText, slideType, progress);
    const png = path.join(jobDir, `slide-${i}.png`);
    await sharp(Buffer.from(svg)).png().toFile(png);
    files.push(png);
  }

  // Create FFmpeg concat file
  const list = path.join(jobDir, 'concat.txt');
  const concatLines = files.map(f => {
    const escapedPath = f.replace(/'/g, "'\\''");
    return `file '${escapedPath}'\nduration ${each.toFixed(3)}`;
  }).join('\n');
  const lastEscapedPath = files[files.length - 1].replace(/'/g, "'\\''");
  fs.writeFileSync(list, concatLines + `\nfile '${lastEscapedPath}'\n`);

  const out = path.join(VIDEO_DIR, `${item.id}.mp4`);
  const videoOnly = path.join(jobDir, 'video-only.mp4');

  // Generate professional vertical video (1080x1920)
  await run(ffmpeg, [
    '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    '-r', String(VIDEO_FPS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', duration.toString(),
    videoOnly
  ]);

  /**
   * ============================================
   * TTS AUDIO MERGE - UNCHANGED
   * ============================================
   * The existing audio pipeline is preserved.
   */
  const script = extractText(item.script || item.hook || item.title || item.topic);
  let audioPath = null;

  if (script && script.length > 0) {
    audioPath = await generateTTSAudio(script, jobDir);
  }

  if (audioPath && fs.existsSync(audioPath)) {
    const audioInfo = await probeMedia(audioPath);
    const audioStream = audioInfo && audioInfo.streams && audioInfo.streams.find(s => s.codec_type === 'audio');

    if (!audioStream || Number(audioStream.duration || 0) <= 0 || Number(audioStream.bit_rate || 0) <= 0) {
      item.hasAudio = false;
      item.audioStatus = 'Voice generation failed';
      item.error = 'Audio file exists but contains no valid audio stream';
      console.log('Voice generation failed');
      return `/videos/${item.id}.mp4`;
    }

    try {
      await run(ffmpeg, [
        '-y',
        '-i', videoOnly,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        '-t', duration.toString(),
        out
      ]);

      console.log('FFmpeg audio input detected');

      const finalInfo = await probeMedia(out);
      const finalAudio = finalInfo && finalInfo.streams && finalInfo.streams.find(s => s.codec_type === 'audio');

      if (!finalAudio || Number(finalAudio.duration || 0) <= 0 || Number(finalAudio.bit_rate || 0) <= 0) {
        throw new Error('Final MP4 audio stream missing or contains no non-zero audio data');
      }

      console.log('Final MP4 audio stream detected');
      item.hasAudio = true;
      item.audioStatus = 'Audio generated';
      return `/videos/${item.id}.mp4`;
    } catch (error) {
      item.hasAudio = false;
      item.audioStatus = 'Voice generation failed';
      item.error = error.message;
      console.error(`Audio merge failed for ${item.id}: ${error.message}`);
      return `/videos/${item.id}.mp4`;
    }
  }

  item.hasAudio = false;
  item.audioStatus = 'Voice generation failed';
  item.error = item.error || 'No usable narration audio generated';
  console.log('Voice generation failed');
  return `/videos/${item.id}.mp4`;
}

async function createItem(body) {
  const topic = String(body.topic || '').trim() || lessonBank[Math.floor(Math.random() * lessonBank.length)].topic;
  const level = String(body.level || 'Beginner');
  const duration = Number(body.duration) || 30;
  const angle = String(body.angle || '').trim();
  const content = await geminiContent(topic, level, angle);
  const item = { id: id(), createdAt: new Date().toISOString(), status: 'RENDERING', topic, level, duration, hasAudio: false, audioStatus: 'Voice generation failed', ...content, videoUrl: null };
  const db = loadDB();
  db.items.unshift(item);
  saveDB(db);
  try {
    item.videoUrl = await renderVideo(item);
    item.status = 'READY';
  } catch(e) {
    item.status = 'ERROR';
    item.error = e.message;
    console.error(`Video rendering error for ${item.id}: ${e.message}`);
  }
  const db2 = loadDB();
  const idx = db2.items.findIndex(x => x.id === item.id);
  if (idx >= 0) db2.items[idx] = item;
  saveDB(db2);
  return item;
}

app.get('/api/status', (req, res) => {
  let statusMsg = 'Engine online • Video renderer ' + (ffmpeg ? 'ready' : 'missing');
  if (!process.env.GEMINI_API_KEY) {
    statusMsg += ' • AI free-fallback (no API key)';
  } else if (aiStatus.error) {
    statusMsg += ` • AI connection error: ${aiStatus.error}`;
  } else if (aiStatus.connected) {
    statusMsg += ` • AI connected • Model: ${aiStatus.model}`;
  } else {
    statusMsg += ` • AI not yet tested • Model: ${aiStatus.model}`;
  }

  let ttsStatus = 'TTS ready (free Google Translate)';
  if (TTS_API_KEY) {
    ttsStatus = 'TTS configured (external API key)';
  } else if (TTS_PROVIDER === 'google-translate') {
    ttsStatus = 'TTS ready (free Google Translate)';
  } else {
    ttsStatus = 'TTS not configured';
  }

  statusMsg += ' • ' + ttsStatus;
  res.json({ ok: true, brand: BRAND, geminiConfigured: !!process.env.GEMINI_API_KEY, model: GEMINI_MODEL, ffmpeg: !!ffmpeg, version: '1.0.1', statusMessage: statusMsg, aiStatus: aiStatus, ttsStatus: ttsStatus, videoFormat: `${VIDEO_WIDTH}x${VIDEO_HEIGHT} 9:16` });
});

app.get('/api/content', (req, res) => res.json(loadDB().items.slice(0, 50)));
app.get('/api/lessons', (req, res) => res.json(lessonBank));
app.get('/api/settings', (req, res) => res.json(loadDB().settings));
app.post('/api/settings', (req, res) => {
  const db = loadDB();
  db.settings = { ...db.settings, ...req.body };
  saveDB(db);
  res.json(db.settings);
});

app.post('/api/generate', async(req, res) => {
  try {
    const item = await createItem(req.body);
    res.json(item);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generate-lesson', async(req, res) => {
  try {
    const db = loadDB();
    const i = (db.settings.topicIndex || 0) % lessonBank.length;
    const l = lessonBank[i];
    db.settings.topicIndex = i + 1;
    saveDB(db);
    const item = await createItem(l);
    res.json(item);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/content/:id', (req, res) => {
  const db = loadDB();
  db.items = db.items.filter(x => x.id !== req.params.id);
  saveDB(db);
  try {
    fs.rmSync(path.join(VIDEO_DIR, req.params.id), { recursive: true, force: true });
  } catch(e) {}
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'Forex Vision Pros AI Autopilot' }));

app.get(/.*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.listen(PORT, () => console.log(`${BRAND} AI Autopilot running on ${PORT}`));
