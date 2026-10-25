import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { loadEnv, type Connect, type Plugin } from 'vite'

const MAX_REFERENCES = 4
const MAX_DESCRIPTION = 600
const MAX_BODY = 12_000_000
const BLAZERES_ENV = '/Users/matthewcorcoran/Repos/Blazeres/.env.local'

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

interface FuseInput {
  images: { mimeType: string; data: string }[]
  description: string
}

interface GeminiEnv {
  key: string
  textModel: string
  imageModel: string
}

/** The key stays on the server. Workshop env wins, then the Blazeres app env. */
function geminiEnv(root: string, mode: string): GeminiEnv {
  const local = loadEnv(mode, root, '')
  const app = readEnvFile(BLAZERES_ENV)
  const pick = (name: string, fallback: string) => process.env[name] || local[name] || app[name] || fallback
  return {
    key: process.env.GEMINI_API_KEY || local.GEMINI_API_KEY || app.GEMINI_API_KEY || '',
    textModel: pick('GEMINI_MODEL', 'gemini-4-argon'),
    imageModel: pick('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image'),
  }
}

function readEnvFile(file: string): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const cut = trimmed.indexOf('=')
      if (cut < 1) continue
      out[trimmed.slice(0, cut).trim()] = trimmed.slice(cut + 1).trim().replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

function readBody(req: IncomingMessage & { body?: unknown }): Promise<string> {
  if (typeof req.body === 'string') return Promise.resolve(req.body)
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Those photos are too large. Try fewer, or smaller ones.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function parseInput(raw: string): FuseInput {
  const body = JSON.parse(raw) as { images?: unknown; description?: unknown }
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, MAX_DESCRIPTION) : ''
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_REFERENCES) : []
  const parsed = images.map((url) => {
    if (typeof url !== 'string') throw new Error('Photos need to be images.')
    const match = url.match(/^data:(image\/[a-z+.-]+);base64,([a-z0-9+/=\s]+)$/i)
    if (!match) throw new Error('Photos need to be images.')
    return { mimeType: match[1].toLowerCase(), data: match[2].replace(/\s/g, '') }
  })
  if (!description && parsed.length === 0) throw new Error('Add a photo or describe the garment.')
  return { images: parsed, description }
}

async function generate(model: string, key: string, body: unknown): Promise<unknown> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!res.ok) throw new Error(json?.error?.message || `Gemini returned ${res.status}.`)
  return json
}

function partsOf(json: unknown): { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[] {
  const candidate = (json as { candidates?: { content?: { parts?: unknown[] } }[] } | null)?.candidates?.[0]
  return (candidate?.content?.parts ?? []) as { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[]
}

function textOf(json: unknown): string {
  return partsOf(json).map((part) => part.text ?? '').join('').trim()
}

function imageOf(json: unknown): string | null {
  for (const part of partsOf(json)) {
    const inline = part.inlineData ?? part.inline_data
    if (!inline?.data) continue
    const mime = ('mimeType' in inline ? inline.mimeType : undefined) ?? ('mime_type' in inline ? inline.mime_type : undefined) ?? 'image/png'
    return `data:${mime};base64,${inline.data}`
  }
  return null
}

function stripFences(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return match ? match[1] : text.trim()
}

/** Photos and words → one garment sentence, then one product picture. Same job as the studio's design step. */
async function fuse(input: FuseInput, env: GeminiEnv) {
  const intro = [
    input.images.length
      ? `There are ${input.images.length} reference photo${input.images.length === 1 ? '' : 's'}.`
      : 'There are no reference photos.',
    input.description ? `The designer wrote: "${input.description}"` : 'The designer wrote no description.',
    'Fuse these into one wearable garment. The written words win over the photos.',
  ].join('\n')

  const textParts: GeminiPart[] = [{ text: intro }]
  input.images.forEach((image, index) => {
    textParts.push({ text: `Photo ${index + 1}:` }, { inlineData: image })
  })

  const described = await generate(env.textModel, env.key, {
    systemInstruction: {
      parts: [{
        text: `You fuse reference photos and a written description into one garment for a made-to-measure studio.
Answer with JSON only, in this shape:
{"garment":"a short name, such as evening coat","summary":"one precise sentence a photographer could shoot: silhouette, length, neckline or collar, closure, fabric, colour, and the details taken from the references.","axis":"Length","less":{"label":"Shorter"},"more":{"label":"Longer"}}
"axis" is exactly "Length" or "Ease". Pick the one dimension that matters most for this garment.
If the axis is Length, "less" is Shorter or Cropped and "more" is Longer.
If the axis is Ease, "less" is Narrower and "more" is Baggier or Roomier.
The garment stays identical apart from that one measurement: same fabric, colour, collar, and closure. Do not invent belts, pockets, hoods, or a new hem.
Do not mention people, backgrounds, or the camera.`,
      }],
    },
    contents: [{ role: 'user', parts: textParts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  })

  let garment = 'Your garment'
  let summary = input.description || 'A garment fused from the reference photos.'
  let fit: { axis: Axis; less: FitStop; more: FitStop } = FALLBACK_FIT
  try {
    const parsed = JSON.parse(stripFences(textOf(described))) as { garment?: unknown; summary?: unknown; axis?: unknown; less?: unknown; more?: unknown }
    if (typeof parsed.garment === 'string' && parsed.garment.trim()) garment = parsed.garment.trim().slice(0, 80)
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) summary = parsed.summary.trim().slice(0, 400)
    fit = readFit(parsed)
  } catch {
    const fallback = textOf(described)
    if (fallback) summary = fallback.slice(0, 400)
  }

  const image = await productPhoto(env, summary, input)
  return { garment, summary, image, ...fit, model: env.imageModel }
}

/** The two ends of the slider. The base picture is already on the page. */
async function vary(input: FuseInput, summary: string, less: FitStop, more: FitStop, env: GeminiEnv) {
  const [lessImage, moreImage] = await Promise.all([
    productPhoto(env, `${summary} ${less.change}`, input, true).catch(() => null),
    productPhoto(env, `${summary} ${more.change}`, input, true).catch(() => null),
  ])
  return { less: lessImage, more: moreImage }
}

const FIT_LABELS = ['Shorter', 'Cropped', 'Longer', 'Baggier', 'Narrower', 'Roomier'] as const

const FIT_CHANGES: Record<(typeof FIT_LABELS)[number], string> = {
  Shorter: 'The same garment, made shorter.',
  Cropped: 'The same garment, cropped.',
  Longer: 'The same garment, made longer.',
  Baggier: 'The same garment, with a baggier fit.',
  Narrower: 'The same garment, cut narrower.',
  Roomier: 'The same garment, with a roomier fit.',
}

type Axis = 'Length' | 'Ease'
interface FitStop { label: (typeof FIT_LABELS)[number]; change: string }

const LENGTH_LESS = ['Shorter', 'Cropped'] as const
const LENGTH_MORE = ['Longer'] as const
const EASE_LESS = ['Narrower'] as const
const EASE_MORE = ['Baggier', 'Roomier'] as const

const FALLBACK_FIT = {
  axis: 'Length' as Axis,
  less: { label: 'Shorter' as const, change: FIT_CHANGES.Shorter },
  more: { label: 'Longer' as const, change: FIT_CHANGES.Longer },
}

function readFit(raw: { axis?: unknown; less?: unknown; more?: unknown }): { axis: Axis; less: FitStop; more: FitStop } {
  const axis: Axis = typeof raw.axis === 'string' && raw.axis.toLowerCase().includes('ease') ? 'Ease' : 'Length'
  const less = readStop(raw.less, axis === 'Length' ? LENGTH_LESS : EASE_LESS)
  const more = readStop(raw.more, axis === 'Length' ? LENGTH_MORE : EASE_MORE)
  if (!less || !more) return FALLBACK_FIT
  return { axis, less, more }
}

function readStop(raw: unknown, allowed: readonly (typeof FIT_LABELS)[number][]): FitStop | null {
  const text = typeof (raw as { label?: unknown } | null)?.label === 'string' ? (raw as { label: string }).label : ''
  const label = allowed.find((word) => text.toLowerCase().includes(word.toLowerCase()))
  return label ? { label, change: FIT_CHANGES[label] } : null
}

async function productPhoto(env: GeminiEnv, sentence: string, input: FuseInput, sameGarment = false): Promise<string> {
  const prompt = [
    `Create one photorealistic product photo of ${sentence}.`,
    'Show the whole garment from the front, on an invisible mannequin or laid flat, centred, on a plain light grey studio background, with soft even light. No people, no text, no logos.',
    sameGarment
      ? 'Keep this the identical garment: same fabric, colour, collar, and closure. Change only the length or the ease. Do not add belts, pockets, hoods, or a different hem shape.'
      : 'Show every detail listed above exactly, and do not add any pockets, hoods or belts that are not listed.',
    input.images.length
      ? `The attached reference photos show the style and fabric feel to take inspiration from (${input.images.length} photo${input.images.length === 1 ? '' : 's'}). Match the listed details, not the people or the background.`
      : '',
    input.description ? `The designer also wrote: "${input.description}"` : '',
  ].filter(Boolean).join('\n')
  const pictured = await generate(env.imageModel, env.key, {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...input.images.map((image) => ({ inlineData: image }))] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '3:4' } },
  })
  const image = imageOf(pictured)
  if (!image) throw new Error(`The image model sent back no picture. ${textOf(pictured).slice(0, 160)}`.trim())
  return image
}

const MODEL_PROMPT = [
  'Create one photorealistic full-length fashion photograph of one woman, a house model.',
  'Striking editorial pose: her body is angled about forty degrees, weight on the back leg, one hip out, one hand on her hip, chin lifted, eyes to the camera. Three-quarter view, not straight-on.',
  'Full body from head to shoes, plain warm light-grey studio, soft side light.',
  'She wears a plain light-grey t-shirt and straight dark trousers. Dark hair pulled back, no jewellery, no text, no logos, no one else.',
].join(' ')

/** One saved portrait, so every garment is worn by the same woman. */
async function studioModel(root: string, env: GeminiEnv): Promise<{ mimeType: string; data: string }> {
  const file = path.join(root, 'public', 'mascot.jpg')
  if (fs.existsSync(file)) {
    const bytes = fs.readFileSync(file)
    const mimeType = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg'
    return { mimeType, data: bytes.toString('base64') }
  }
  const pictured = await generate(env.imageModel, env.key, {
    contents: [{ role: 'user', parts: [{ text: MODEL_PROMPT }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '3:4' } },
  })
  const image = imageOf(pictured)
  if (!image) throw new Error('Could not prepare the model photo.')
  const match = image.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i)
  if (!match) throw new Error('Could not prepare the model photo.')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(match[2], 'base64'))
  return { mimeType: match[1], data: match[2] }
}

async function wear(root: string, garment: { mimeType: string; data: string }, summary: string, env: GeminiEnv) {
  const model = await studioModel(root, env)
  const prompt = [
    `The first image is a photo of a person. The second image is ${summary}.`,
    'Create one photorealistic photo of this same person wearing this garment.',
    'Keep her exact face, hair, and this exact angled pose. Do not turn her to face the camera straight on.',
    'Keep the same body, expression, background, camera and light.',
    'Replace only their clothing with this garment. Fit it to their body as it would really sit and drape, with natural folds. Keep every detail of the garment: colour, fabric, collar, closure, pockets and length.',
    'No text, no logos, no extra people.',
  ].join('\n')
  const pictured = await generate(env.imageModel, env.key, {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: model }, { inlineData: garment }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '3:4' } },
  })
  const image = imageOf(pictured)
  if (!image) throw new Error(`Could not dress her. ${textOf(pictured).slice(0, 160)}`.trim())
  return { image }
}

function parseWear(raw: string): { garment: { mimeType: string; data: string }; summary: string } {
  const body = JSON.parse(raw) as { garment?: unknown; summary?: unknown }
  if (typeof body.garment !== 'string') throw new Error('Send the garment picture.')
  const match = body.garment.match(/^data:(image\/[a-z+.-]+);base64,([a-z0-9+/=\s]+)$/i)
  if (!match) throw new Error('Send the garment picture.')
  const summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, 400) : 'the designed garment'
  return { garment: { mimeType: match[1].toLowerCase(), data: match[2].replace(/\s/g, '') }, summary }
}

function parseVary(raw: string): FuseInput & { summary: string; less: FitStop; more: FitStop } {
  const body = JSON.parse(raw) as { images?: unknown; description?: unknown; summary?: unknown; less?: unknown; more?: unknown }
  const input = parseInput(JSON.stringify({ images: body.images, description: body.description }))
  const summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, 400) : input.description || 'the designed garment'
  const less = readStop(body.less, FIT_LABELS)
  const more = readStop(body.more, FIT_LABELS)
  if (!less || !more) throw new Error('Send the garment picture.')
  return { ...input, summary, less, more }
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function handler(root: string, mode: string): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0]
    if (url !== '/api/fuse' && url !== '/api/vary' && url !== '/api/wear') return next()
    if (req.method !== 'POST') {
      send(res, 405, { error: 'Send a description and any reference photos.' })
      return
    }
    const env = geminiEnv(root, mode)
    if (!env.key) {
      send(res, 503, { error: 'Pictures need a GEMINI_API_KEY.' })
      return
    }
    try {
      const raw = await readBody(req)
      if (url === '/api/wear') {
        const input = parseWear(raw)
        send(res, 200, await wear(root, input.garment, input.summary, env))
        return
      }
      if (url === '/api/vary') {
        const input = parseVary(raw)
        send(res, 200, await vary(input, input.summary, input.less, input.more, env))
        return
      }
      send(res, 200, await fuse(parseInput(raw), env))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not fuse that idea.'
      const status = message.startsWith('Add a photo') || message.startsWith('Photos') || message.startsWith('Those photos') || message.startsWith('Send the garment') ? 400 : 502
      send(res, status, { error: message.split(env.key).join('…').slice(0, 280) })
    }
  }
}

export async function handleSeamstressRequest(req: IncomingMessage, res: ServerResponse, root: string, mode: string) {
  await handler(root, mode)(req, res, () => {
    send(res, 404, { error: 'Send a description and any reference photos.' })
  })
}

export function seamstressFuse(): Plugin {
  return {
    name: 'seamstress-fuse',
    configureServer(server) {
      server.middlewares.use(handler(server.config.root, server.config.mode))
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler(server.config.root, server.config.mode))
    },
  }
}
