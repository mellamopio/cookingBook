import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ExtractedRecipe = {
  title: string
  description: string
  category: string
  ingredients: string[]
  steps: string[]
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  servings: number | null
}

type TranslatableRecipe = {
  title: string
  description: string
  category: string
  ingredients: string[]
  steps: string[]
}

type RecipeTranslation = TranslatableRecipe

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host.includes(':')
  ) return true

  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
}

function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i)
  if (!match) return null
  const minutes = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  return minutes || null
}

function instructionText(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.flatMap(instructionText)
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (typeof item.text === 'string') return instructionText(item.text)
    if (Array.isArray(item.itemListElement)) return item.itemListElement.flatMap(instructionText)
  }
  return []
}

function findRecipe(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipe(item)
      if (found) return found
    }
  } else if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    const type = item['@type']
    if ((typeof type === 'string' && type.toLowerCase() === 'recipe') ||
      (Array.isArray(type) && type.some((entry) => typeof entry === 'string' && entry.toLowerCase() === 'recipe'))) {
      return item
    }
    return findRecipe(item['@graph'])
  }
  return null
}

function fromStructuredData(html: string): ExtractedRecipe | null {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const match of scripts) {
    try {
      const recipe = findRecipe(JSON.parse(match[1]))
      if (!recipe || typeof recipe.name !== 'string') continue
      const yieldValue = Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield
      const servingsMatch = typeof yieldValue === 'string' ? yieldValue.match(/\d+/) : null
      const servings = servingsMatch ? Number(servingsMatch[0]) : typeof yieldValue === 'number' ? yieldValue : null
      const category = Array.isArray(recipe.recipeCategory) ? recipe.recipeCategory[0] : recipe.recipeCategory
      return {
        title: recipe.name,
        description: typeof recipe.description === 'string' ? recipe.description : '',
        category: typeof category === 'string' ? category : 'Other',
        ingredients: Array.isArray(recipe.recipeIngredient)
          ? recipe.recipeIngredient.filter((entry): entry is string => typeof entry === 'string')
          : [],
        steps: instructionText(recipe.recipeInstructions),
        prep_time_minutes: parseDuration(recipe.prepTime),
        cook_time_minutes: parseDuration(recipe.cookTime),
        servings: servings && servings > 0 ? servings : null,
      }
    } catch {
      continue
    }
  }
  return null
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('The recipe page is too large to import.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function pageText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24000)
}

function validRecipe(value: unknown): ExtractedRecipe {
  if (!value || typeof value !== 'object') throw new Error('The extraction service returned an invalid recipe.')
  const item = value as Record<string, unknown>
  const list = (entry: unknown) => Array.isArray(entry)
    ? entry.filter((line): line is string => typeof line === 'string').map((line) => line.trim()).filter(Boolean).slice(0, 100)
    : []
  const numberOrNull = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 ? Math.round(entry) : null
  const servingsOrNull = (entry: unknown) => {
    const value = numberOrNull(entry)
    return value && value > 0 ? value : null
  }
  const title = typeof item.title === 'string' ? item.title.trim().slice(0, 160) : ''
  if (!title) throw new Error('No recipe title could be extracted. Try another source or enter it manually.')
  return {
    title,
    description: typeof item.description === 'string' ? item.description.trim().slice(0, 1000) : '',
    category: typeof item.category === 'string' && item.category.trim() ? item.category.trim().slice(0, 60) : 'Other',
    ingredients: list(item.ingredients),
    steps: list(item.steps),
    prep_time_minutes: numberOrNull(item.prep_time_minutes),
    cook_time_minutes: numberOrNull(item.cook_time_minutes),
    servings: servingsOrNull(item.servings),
  }
}

async function extractWithOpenAI(content: { text?: string; imageDataUrl?: string }): Promise<ExtractedRecipe> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('Recipe extraction is not configured yet. Add the OPENAI_API_KEY secret to your Supabase project.')

  const prompt = `Extract one recipe from the provided ${content.imageDataUrl ? 'photo' : 'webpage text'}. Return a JSON object with exactly these fields: title (string), description (string), category (short string such as Breakfast, Lunch, Dinner, Dessert, or Other), ingredients (array of strings), steps (array of strings), prep_time_minutes (number or null), cook_time_minutes (number or null), servings (number or null). Preserve the language used by the source; do not translate. Do not invent missing ingredients, instructions, times, or servings. For a photo, transcribe only what is legible. If no recipe is present, use an empty title.`
  const userContent = content.imageDataUrl
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: content.imageDataUrl, detail: 'high' } },
      ]
    : `${prompt}\n\nWebpage text:\n${content.text ?? ''}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You extract recipe details faithfully and return valid JSON only.' },
        { role: 'user', content: userContent },
      ],
      max_tokens: 2500,
    }),
  })
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI extraction failed (${response.status}): ${details.slice(0, 300)}`)
  }
  const result = await response.json()
  const message = result.choices?.[0]?.message?.content
  if (typeof message !== 'string') throw new Error('The extraction service did not return a recipe.')
  return validRecipe(JSON.parse(message))
}

function validTranslation(value: unknown, source: TranslatableRecipe): RecipeTranslation {
  if (!value || typeof value !== 'object') throw new Error('The translation service returned invalid recipe text.')
  const item = value as Record<string, unknown>
  if (
    typeof item.title !== 'string' ||
    typeof item.description !== 'string' ||
    typeof item.category !== 'string' ||
    !Array.isArray(item.ingredients) ||
    !Array.isArray(item.steps) ||
    item.ingredients.length !== source.ingredients.length ||
    item.steps.length !== source.steps.length ||
    !item.ingredients.every((entry) => typeof entry === 'string') ||
    !item.steps.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('The translation service returned an incomplete recipe. Please try again.')
  }
  return {
    title: item.title,
    description: item.description,
    category: item.category,
    ingredients: item.ingredients,
    steps: item.steps,
  }
}

async function translateRecipe(source: TranslatableRecipe, language: 'English' | 'German' | 'Spanish'): Promise<RecipeTranslation> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('Recipe translation is not configured yet. Add the OPENAI_API_KEY secret to your Supabase project.')

  const prompt = `Translate this recipe text into ${language}. Preserve quantities, units, cooking terms, and meaning exactly; do not add or remove content. Return JSON with exactly five fields: title (string), description (string), category (string), ingredients (array of strings), and steps (array of strings). Keep the ingredient and step array lengths and order unchanged. Translate even entries that are already in another language.`
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You translate recipe text accurately and return valid JSON only.' },
        { role: 'user', content: `${prompt}\n\nRecipe JSON:\n${JSON.stringify(source)}` },
      ],
      max_tokens: 2500,
    }),
  })
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Recipe translation failed (${response.status}): ${details.slice(0, 300)}`)
  }
  const result = await response.json()
  const message = result.choices?.[0]?.message?.content
  if (typeof message !== 'string') throw new Error('The translation service did not return recipe text.')
  return validTranslation(JSON.parse(message), source)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!authorization || !supabaseUrl || !anonKey) {
      return jsonResponse({ error: 'Sign in before importing a recipe.' }, 401)
    }
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return jsonResponse({ error: 'Your session is invalid. Please sign in again.' }, 401)

    const body = await request.json()
    if (body.action === 'translate') {
      if (body.language !== 'en' && body.language !== 'de' && body.language !== 'es') {
        return jsonResponse({ error: 'Choose English, German, or Spanish as the translation language.' }, 400)
      }
      const source = body.recipe as TranslatableRecipe | undefined
      if (
        !source ||
        typeof source.title !== 'string' || source.title.length > 160 ||
        typeof source.description !== 'string' || source.description.length > 1000 ||
        typeof source.category !== 'string' || source.category.length > 60 ||
        !Array.isArray(source.ingredients) || source.ingredients.length > 100 ||
        !Array.isArray(source.steps) || source.steps.length > 100 ||
        !source.ingredients.every((entry) => typeof entry === 'string' && entry.length <= 1000) ||
        !source.steps.every((entry) => typeof entry === 'string' && entry.length <= 2000)
      ) {
        return jsonResponse({ error: 'The recipe text is invalid or too long to translate.' }, 400)
      }
      const language = body.language === 'en' ? 'English' : body.language === 'de' ? 'German' : 'Spanish'
      return jsonResponse({ translation: await translateRecipe(source, language) })
    }
    if (typeof body.url === 'string') {
      let url: URL
      try {
        url = new URL(body.url)
      } catch {
        return jsonResponse({ error: 'Enter a valid recipe-page URL.' }, 400)
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isBlockedHostname(url.hostname)) {
        return jsonResponse({ error: 'That recipe-page address is not allowed.' }, 400)
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      let page: Response
      try {
        page = await fetch(url, {
          signal: controller.signal,
          redirect: 'manual',
          headers: { 'User-Agent': 'MiseRecipeImporter/1.0', Accept: 'text/html,application/xhtml+xml' },
        })
      } finally {
        clearTimeout(timeout)
      }
      if (page.status >= 300 && page.status < 400) {
        return jsonResponse({ error: 'This page redirects. Open the final recipe page and import its URL instead.' }, 400)
      }
      if (!page.ok) return jsonResponse({ error: `The recipe page could not be opened (HTTP ${page.status}).` }, 422)
      const contentType = page.headers.get('content-type') ?? ''
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        return jsonResponse({ error: 'That link does not point to a web page.' }, 422)
      }
      const html = await readLimited(page, 2_000_000)
      const structured = fromStructuredData(html)
      if (structured?.title && structured.ingredients.length && structured.steps.length) {
        return jsonResponse({ recipe: validRecipe(structured) })
      }
      const recipe = await extractWithOpenAI({ text: pageText(html) })
      return jsonResponse({ recipe })
    }

    if (typeof body.imageDataUrl === 'string') {
      if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(body.imageDataUrl) || body.imageDataUrl.length > 11_500_000) {
        return jsonResponse({ error: 'Choose a supported image smaller than 8 MB.' }, 400)
      }
      return jsonResponse({ recipe: await extractWithOpenAI({ imageDataUrl: body.imageDataUrl }) })
    }
    return jsonResponse({ error: 'Provide a recipe-page URL or an image.' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred while extracting the recipe.'
    return jsonResponse({ error: message }, 500)
  }
})
