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

// 1) Site içeriğini getir
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
    
    // Form analizi
    const forms = analyzeForms(html, url);
    
    // Linkleri çıkar
    const links = extractLinks(html, url);
    
    // Meta bilgileri
    const meta = extractMeta(html);
    
    // Temiz metin
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 8000);

    res.json({ 
      content: text, 
      html: html.substring(0, 50000),
      forms,
      links: links.slice(0, 30),
      meta,
      url 
    });
  } catch (error) {
    console.error('fetch-site hatası:', error.message);
    res.status(500).json({ error: `Site içeriği alınamadı: ${error.message}` });
  }
});

// Form analizi fonksiyonu
function analyzeForms(html, baseUrl) {
  const forms = [];
  const formRegex = /<form[^>]*>[\s\S]*?<\/form>/gi;
  const inputRegex = /<input[^>]*>/gi;
  const nameRegex = /name=["']([^"']+)["']/i;
  const typeRegex = /type=["']([^"']+)["']/i;
  const placeholderRegex = /placeholder=["']([^"']*)["']/i;
  const idRegex = /id=["']([^"']+)["']/i;
  const actionRegex = /action=["']([^"']*)["']/i;
  const methodRegex = /method=["']([^"']+)["']/i;
  const labelRegex = /<label[^>]*>([^<]*)<\/label>/gi;
  
  let formMatch;
  while ((formMatch = formRegex.exec(html)) !== null) {
    const formHtml = formMatch[0];
    const form = {
      html: formHtml.substring(0, 2000),
      action: (formHtml.match(actionRegex) || [])[1] || '',
      method: (formHtml.match(methodRegex) || [])[1] || 'post',
      inputs: [],
      labels: []
    };
    
    // Input'ları bul
    let inputMatch;
    const inputRegexLocal = new RegExp(inputRegex);
    while ((inputMatch = inputRegexLocal.exec(formHtml)) !== null) {
      const inputHtml = inputMatch[0];
      form.inputs.push({
        name: (inputHtml.match(nameRegex) || [])[1] || '',
        type: (inputHtml.match(typeRegex) || [])[1] || 'text',
        placeholder: (inputHtml.match(placeholderRegex) || [])[1] || '',
        id: (inputHtml.match(idRegex) || [])[1] || ''
      });
    }
    
    // Label'ları bul
    let labelMatch;
    const labelRegexLocal = new RegExp(labelRegex);
    while ((labelMatch = labelRegexLocal.exec(formHtml)) !== null) {
      form.labels.push(labelMatch[1].trim());
    }
    
    forms.push(form);
  }
  
  return forms;
}

// Link çıkarma
function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    if (href.startsWith('/')) {
      const base = new URL(baseUrl);
      href = base.origin + href;
    }
    links.push({ url: href, text: match[2].trim() });
  }
  return links;
}

// Meta bilgileri
function extractMeta(html) {
  const meta = {};
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const viewportMatch = html.match(/<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']+)["']/i);
  
  meta.title = titleMatch ? titleMatch[1] : '';
  meta.description = descMatch ? descMatch[1] : '';
  meta.viewport = viewportMatch ? viewportMatch[1] : '';
  
  return meta;
}

// 2) Dosya çek
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

// 3) Ana sohbet endpoint'i (DeepSeek -> Groq fallback)
app.post('/ask-ai', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mesaj dizisi gerekli.' });
  }

  if (DEEPSEEK_API_KEY) {
    try {
      const reply = await callDeepSeek(messages);
      return res.json({ reply, used: 'deepseek' });
    } catch (err) {
      console.warn('DeepSeek başarısız, Groq deneniyor:', err.message);
    }
  }

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

// 4) Siteyi iframe'de göster (bazı siteler X-Frame-Options nedeniyle engelleyebilir)
app.post('/check-headers', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    res.json({ 
      canIframe: !headers['x-frame-options'] && !headers['content-security-policy']?.includes('frame-ancestors'),
      headers 
    });
  } catch (error) {
    res.json({ canIframe: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Mexa AI http://localhost:${PORT} adresinde çalışıyor.`);
});