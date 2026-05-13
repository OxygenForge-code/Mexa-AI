const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Site içeriğini çekme proxy'si
app.post('/fetch-site', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(url);
    const html = await response.text();
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 7000);
    res.json({ content: text });
  } catch (error) {
    res.status(500).json({ error: 'Site içeriği alınamadı.' });
  }
});

// DeepSeek API proxy'si
app.post('/ask-ai', async (req, res) => {
  const { messages } = req.body;
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.75,
        max_tokens: 1500
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API hatası');
    res.json({ reply: data.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Mexa AI proxy sunucusu ${PORT} portunda çalışıyor`);
});
