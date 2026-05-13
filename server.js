const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

// Puppeteer opsiyonel – eğer yüklü değilse screenshot çalışmaz
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.warn('Puppeteer yüklenemedi, ekran görüntüsü devre dışı.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

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
  try {
    const response = await fetch(url);
    const html = await response.text();
    // Basit metin çıkarma
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
    res.status(500).json({ error: 'Site içeriği alınamadı.' });
  }
});

// 2) Belirli bir dosyayı getir (script.js, style.css vb.)
app.post('/fetch-file', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Dosya bulunamadı');
    let content = await response.text();
    // Çok büyük dosyaları kırp
    if (content.length > 10000) content = content.substring(0, 10000) + '\n... (dosya kısaltıldı)';
    res.json({ content, type: response.headers.get('content-type') || 'text/plain' });
  } catch (error) {
    res.status(500).json({ error: `Dosya alınamadı: ${error.message}` });
  }
});

// 3) DeepSeek API ile sohbet
app.post('/ask-ai', async (req, res) => {
  const { messages } = req.body;
  if (!DEEPSEEK_API_KEY) return res.status(500).json({ error: 'Sunucuda API anahtarı tanımlanmamış.' });

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
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API hatası');
    res.json({ reply: data.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4) Ekran görüntüsü (opsiyonel)
app.post('/screenshot', async (req, res) => {
  if (!puppeteer) return res.status(500).json({ error: 'Puppeteer kurulu değil.' });
  const { url } = req.body;
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
    res.status(500).json({ error: `Ekran görüntüsü alınamadı: ${err.message}` });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`Mexa AI sunucusu ${PORT} portunda hazır.`);
});
