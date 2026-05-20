import axios from 'axios'
import type { AIConfig } from '../shared/types'

const SYSTEM_PROMPT = `Eres un experto en Minecraft y su ecosistema de mods y modloaders (Forge, Fabric, NeoForge, Quilt). Tu trabajo es ayudar a jugadores de cualquier edad (incluyendo niños de 12 años) a entender y solucionar errores en su juego.

Responde SIEMPRE en español, usando emojis y un lenguaje claro y amigable, como si le explicaras a un amigo que no sabe mucho de informática. Usa el siguiente formato markdown:

## 🔴 ¿Qué salió mal?
Explica en 1-2 frases simples qué fue lo que falló, sin tecnicismos innecesarios.

## 🔍 ¿Por qué pasó esto?
Explica la causa: qué mod, librería, configuración o conflicto lo provocó. Si no puedes determinarlo con certeza, dilo claramente.

## ✅ ¿Cómo lo arreglo? (Sigue estos pasos)
Lista numerada con pasos concretos, claros y ordenados. Cada paso debe ser tan específico que cualquier persona pueda seguirlo:
1. Usa rutas exactas si las conoces
2. Explica qué hacer en cada programa (ej: "Abre el launcher → haz clic en ...")
3. Si hay varias opciones, empieza por la más fácil

## 💡 Consejos extra (opcional)
Si hay algo importante que el usuario deba saber para evitar este error en el futuro, inclúyelo aquí.

Recuerda: sé amable, paciente y usa emojis para hacer la respuesta más fácil de leer. Si no tienes suficiente información en el log para dar una solución segura, dilo con honestidad.`

function buildUserMsg(content: string, type: 'crash' | 'log'): string {
  const truncated =
    content.length > 8000
      ? content.slice(0, 4000) + '\n\n[...truncado...]\n\n' + content.slice(-4000)
      : content
  return type === 'crash'
    ? `Analiza este crash report de Minecraft:\n\n\`\`\`\n${truncated}\n\`\`\``
    : `Analiza este log de Minecraft y detecta errores o problemas:\n\n\`\`\`\n${truncated}\n\`\`\``
}

export async function analyzeWithAI(
  content: string,
  type: 'crash' | 'log',
  config: AIConfig
): Promise<string> {
  const userMsg = buildUserMsg(content, type)
  switch (config.provider) {
    case 'claude':  return analyzeWithClaude(userMsg, config.apiKey!, config.model)
    case 'openai':  return analyzeWithOpenAI(userMsg, config.apiKey!, config.model)
    case 'gemini':  return analyzeWithGemini(userMsg, config.apiKey!, config.model)
    case 'grok':    return analyzeWithGrok(userMsg, config.apiKey!, config.model)
    case 'ollama':  return analyzeWithOllama(userMsg, config.model, config.ollamaUrl ?? 'http://localhost:11434')
    default: throw new Error('Proveedor de IA no válido')
  }
}

async function analyzeWithClaude(userMsg: string, apiKey: string, model: string): Promise<string> {
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model, max_tokens: 1024, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMsg }] },
    {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      timeout: 30000
    }
  )
  return data.content[0].text
}

async function analyzeWithOpenAI(userMsg: string, apiKey: string, model: string): Promise<string> {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMsg }], max_tokens: 1024 },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000
    }
  )
  return data.choices[0].message.content
}

async function analyzeWithGemini(userMsg: string, apiKey: string, model: string): Promise<string> {
  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userMsg }] }],
      generationConfig: { maxOutputTokens: 1024 }
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
  )
  return data.candidates[0].content.parts[0].text
}

async function analyzeWithGrok(userMsg: string, apiKey: string, model: string): Promise<string> {
  const { data } = await axios.post(
    'https://api.x.ai/v1/chat/completions',
    { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMsg }], max_tokens: 1024 },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000
    }
  )
  return data.choices[0].message.content
}

async function analyzeWithOllama(userMsg: string, model: string, baseUrl: string): Promise<string> {
  const url = baseUrl.replace(/\/$/, '') + '/api/chat'
  const { data } = await axios.post(
    url,
    { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMsg }], stream: false },
    { timeout: 120000 }
  )
  return data.message.content
}
