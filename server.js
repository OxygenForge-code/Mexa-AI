const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Site içeriğini çek
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

// Dosya çek
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

// Ana sohbet endpoint'i (DeepSeek -> Groq fallback)
app.post('/ask-ai', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mesaj dizisi gerekli.' });
  }

  // Önce DeepSeek'i dene
  if (DEEPSEEK_API_KEY) {
    try {
      const reply = await callDeepSeek(messages);
      return res.json({ reply, used: 'deepseek' });
    } catch (err) {
      console.warn('DeepSeek başarısız, Groq deneniyor:', err.message);
    }
  }

  // Groq API dene
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Hiçbir API anahtarı tanımlı değil.' });
  }

  try {
    const reply = await callGroq(messages);
    res.json({ reply, used: 'groq' });
  } catch (err) {
    console.error('Groq hatası:', err.message);
    res.status(500).json({ error: `Groq API hatası: ${err.message}` });
  }
});

async function callDeepSeek(messages) {
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
    throw new Error(data.error?.message || `DeepSeek API hatası (${response.status})`);
  }
  return data.choices[0].message.content;
}

async function callGroq(messages) {
  // Güncel Groq modelleri (sırasıyla dene)
  const models = [
    'llama-3.3-70b-versatile',
    'gemma2-9b-it',
    'llama-3.1-8b-instant'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.8,
          max_tokens: 2000
        }),
        timeout: 30000
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || `Groq API hatası (${response.status})`);
      }
      return data.choices[0].message.content;
    } catch (err) {
      console.warn(`Groq model ${model} başarısız:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Tüm Groq modelleri başarısız oldu.');
}

app.listen(PORT, () => {
  console.log(`✅ Mexa AI http://localhost:${PORT} adresinde çalışıyor.`);
});