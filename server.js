const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// CORS ve JSON desteği
app.use(cors());
app.use(express.json());

// Statik dosyaları public klasöründen sun
app.use(express.static(path.join(__dirname, 'public')));

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1) Site içeriğini çek
app.post('/fetch-site', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL gerekli.' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MexaAI/1.0)' },
      timeout: 10000
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

// 2) Dosya çek (script.js, style.css)
app.post('/fetch-file', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Dosya URL’si gerekli.' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MexaAI/1.0)' },
      timeout: 10000
    });
    if (!response.ok) throw new Error(`Dosya bulunamadı (${response.status})`);

    let content = await response.text();
    if (content.length > 10000) {
      content = content.substring(0, 10000) + '\n... (dosya kısaltıldı)';
    }

    res.json({
      content,
      type: response.headers.get('content-type') || 'text/plain'
    });
  } catch (error) {
    console.error('fetch-file hatası:', error.message);
    res.status(500).json({ error: `Dosya alınamadı: ${error.message}` });
  }
});

// 3) DeepSeek API
app.post('/ask-ai', async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: 'API anahtarı sunucuda tanımlı değil.' });
  }

  const { messages } = req.body;
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
      }),
      timeout: 30000
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `API hatası (${response.status})`);
    }

    res.json({ reply: data.choices[0].message.content });
  } catch (error) {
    console.error('/ask-ai hatası:', error.message);
    res.status(500).json({ error: error.message || 'Sunucu hatası' });
  }
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`✅ Mexa AI http://localhost:${PORT} adresinde çalışıyor.`);
});