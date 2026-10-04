import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const { token } = await request.json()
    if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      return jsonResponse({ error: 'This recipe sharing link is invalid or has been revoked.' }, 404)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Recipe sharing is not configured on the server.' }, 500)
    }

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: share, error: shareError } = await client
      .from('recipe_shares')
      .select('recipe_id')
      .eq('token', token)
      .maybeSingle()
    if (shareError) throw new Error(`Could not verify the recipe link: ${shareError.message}`)
    if (!share) return jsonResponse({ error: 'This recipe sharing link is invalid or has been revoked.' }, 404)

    const { data: recipe, error: recipeError } = await client
      .from('recipes')
      .select('id, title, description, ingredients, steps, category, tags, recommended_from, prep_time_minutes, cook_time_minutes, servings, source_url, image_path, rating')
      .eq('id', share.recipe_id)
      .maybeSingle()
    if (recipeError) throw new Error(`Could not load the shared recipe: ${recipeError.message}`)
    if (!recipe) return jsonResponse({ error: 'This recipe is no longer available.' }, 404)

    let imageUrl: string | null = null
    if (recipe.image_path) {
      const { data, error: imageError } = await client.storage
        .from('recipe-images')
        .createSignedUrl(recipe.image_path, 3600)
      if (imageError) throw new Error(`Could not load the recipe photo: ${imageError.message}`)
      imageUrl = data.signedUrl
    }

    return jsonResponse({ recipe: { ...recipe, imageUrl } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred while loading this recipe.'
    return jsonResponse({ error: message }, 500)
  }
})
