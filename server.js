const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.warn('⚠️ Puppeteer yüklenemedi, ekran görüntüsü devre dışı.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPSEEK_API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY ortam değişkeni tanımlanmamış!');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1) Site HTML içeriğini getir
app.post('/fetch-site', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL gerekli.' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MexaAI/1.0)' }
    });
    if (!response.ok) throw new Error(`Site yanıt vermedi (${response.status})`);
    const html = await response.text();
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 8000);
    res.json({ content: text });
  } catch (error) {
    console.error('fetch-site hatası:', error.message);
    res.status(500).json({ error: `Site içeriği alınamadı: ${error.message}` });
  }
});

// 2) Belirli bir dosyayı getir (script.js, style.css vb.)
app.post('/fetch-file', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Dosya URL’si gerekli.' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MexaAI/1.0)' }
    });
    if (!response.ok) throw new Error(`Dosya bulunamadı (${response.status})`);
    let content = await response.text();
    if (content.length > 10000) content = content.substring(0, 10000) + '\n... (dosya kısaltıldı)';
    res.json({ content, type: response.headers.get('content-type') || 'text/plain' });
  } catch (error) {
    console.error('fetch-file hatası:', error.message);
    res.status(500).json({ error: `Dosya alınamadı: ${error.message}` });
  }
});

// 3) DeepSeek API ile sohbet
app.post('/ask-ai', async (req, res) => {
  const { messages } = req.body;
  if (!DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY tanımlı değil!');
    return res.status(500).json({ error: 'Sunucuda API anahtarı tanımlanmamış.' });
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mesaj dizisi gerekli.' });
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.8,
        max_tokens: 2000
      })
    });

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('API yanıtı JSON değil:', parseError);
      return res.status(502).json({ error: 'API’den geçersiz yanıt alındı.' });
    }

    if (!response.ok) {
      console.error('DeepSeek API hatası:', data);
      throw new Error(data.error?.message || `API hatası (${response.status})`);
    }

    res.json({ reply: data.choices[0].message.content });
  } catch (error) {
    console.error('/ask-ai hatası:', error.message);
    res.status(500).json({ error: error.message || 'Sunucu hatası' });
  }
});

// 4) Ekran görüntüsü (opsiyonel)
app.post('/screenshot', async (req, res) => {
  if (!puppeteer) return res.status(500).json({ error: 'Puppeteer kurulu değil.' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL gerekli.' });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    const screenshotBuffer = await page.screenshot({ fullPage: false, encoding: 'base64' });
    res.json({ screenshot: `data:image/png;base64,${screenshotBuffer}` });
  } catch (err) {
    console.error('screenshot hatası:', err.message);
    res.status(500).json({ error: `Ekran görüntüsü alınamadı: ${err.message}` });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`✅ Mexa AI sunucusu ${PORT} portunda çalışıyor.`);
});