import axios from 'axios'
import type { AIConfig } from '../shared/types'

const SYSTEM_PROMPT = `Eres un experto en Minecraft y su ecosistema de mods y modloaders (Forge, Fabric, NeoForge, Quilt). Analiza el reporte proporcionado y responde EN ESPAÑOL con formato markdown estructurado:

**Error principal**: qué falló exactamente
**Causa**: qué mod, librería o configuración lo provocó
**Solución**: pasos concretos y ordenados para resolverlo

Sé directo y específico. Si no puedes determinar la causa con certeza, indícalo.`

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
