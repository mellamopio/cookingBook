import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type RecipeRow = {
  id: string
  title: string
  description: string
  ingredients: string[]
  steps: string[]
  category: string
  tags: string[] | null
  recommended_from: string | null
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  servings: number | null
  source_url: string | null
  image_path: string | null
  rating: number | null
  created_at: string
}

const recipeColumns = 'id, title, description, ingredients, steps, category, tags, recommended_from, prep_time_minutes, cook_time_minutes, servings, source_url, image_path, rating, created_at'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Cookbook lookup is not configured. Sign in and try again.' }, 401)
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'Your session is invalid. Please sign in again.' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const body = await request.json()
    if (body.action === 'get_username') {
      const { data, error } = await admin
        .from('cookbook_profiles')
        .select('username')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) throw new Error(`Could not load your username: ${error.message}`)
      return jsonResponse({ username: data?.username ?? '' })
    }

    if (body.action === 'set_username') {
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return jsonResponse({ error: 'Use 3–24 characters: lowercase letters, numbers, or underscores.' }, 400)
      }
      const { error } = await admin
        .from('cookbook_profiles')
        .upsert({ user_id: user.id, username }, { onConflict: 'user_id' })
      if (error?.code === '23505') return jsonResponse({ error: 'That username is already taken. Try another one.' }, 409)
      if (error) throw new Error(`Could not save your username: ${error.message}`)
      return jsonResponse({ username })
    }

    if (body.action === 'list_friends') {
      const { data: friendships, error: friendsError } = await admin
        .from('cookbook_friendships')
        .select('requester_id, recipient_id, status, created_at')
        .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order('created_at', { ascending: true })
      if (friendsError) throw new Error(`Could not load your friends: ${friendsError.message}`)
      const friends: { id: string; email: string }[] = []
      const requests: { id: string; email: string; requesterId: string }[] = []
      for (const friendship of friendships ?? []) {
        const isRequester = friendship.requester_id === user.id
        const otherId = isRequester ? friendship.recipient_id : friendship.requester_id
        if (friendship.status !== 'accepted' && (isRequester || friendship.status !== 'pending')) continue
        const { data, error } = await admin.auth.admin.getUserById(otherId)
        if (error) throw new Error(`Could not load a friend account: ${error.message}`)
        if (!data.user?.email || !data.user.email_confirmed_at) continue
        if (friendship.status === 'accepted') {
          friends.push({ id: data.user.id, email: data.user.email })
        } else {
          requests.push({ id: data.user.id, email: data.user.email, requesterId: friendship.requester_id })
        }
      }
      return jsonResponse({ friends, requests })
    }

    if (body.action === 'remove_friend') {
      if (typeof body.friendId !== 'string' || !uuidPattern.test(body.friendId)) {
        return jsonResponse({ error: 'Choose a valid friend to remove.' }, 400)
      }
      const { error } = await admin
        .from('cookbook_friendships')
        .delete()
        .eq('status', 'accepted')
        .or(`and(requester_id.eq.${user.id},recipient_id.eq.${body.friendId}),and(requester_id.eq.${body.friendId},recipient_id.eq.${user.id})`)
      if (error) throw new Error(`Could not remove this friend: ${error.message}`)
      return jsonResponse({ removed: true })
    }

    if (body.action === 'accept_friend' || body.action === 'decline_friend') {
      if (typeof body.requesterId !== 'string' || !uuidPattern.test(body.requesterId)) {
        return jsonResponse({ error: 'Choose a valid friend request.' }, 400)
      }
      const query = admin
        .from('cookbook_friendships')
        .update({ status: 'accepted' })
        .eq('requester_id', body.requesterId)
        .eq('recipient_id', user.id)
        .eq('status', 'pending')
      const result = body.action === 'accept_friend'
        ? await query.select('requester_id').maybeSingle()
        : await admin
          .from('cookbook_friendships')
          .delete()
          .eq('requester_id', body.requesterId)
          .eq('recipient_id', user.id)
          .eq('status', 'pending')
      if (result.error) throw new Error(`Could not update this friend request: ${result.error.message}`)
      if (body.action === 'accept_friend' && !result.data) {
        return jsonResponse({ error: 'This friend request is no longer available.' }, 404)
      }
      return jsonResponse({ updated: true })
    }

    const rawIdentifier = typeof body.identifier === 'string'
      ? body.identifier.trim()
      : typeof body.email === 'string' ? body.email.trim() : ''
    const identifier = rawIdentifier.startsWith('@') ? rawIdentifier.slice(1) : rawIdentifier
    if (!identifier || identifier.length > 254) {
      return jsonResponse({ error: 'Enter a valid username or email address.' }, 400)
    }
    let friendId: string | null
    let email = ''
    if (identifier.includes('@')) {
      email = identifier.toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ error: 'Enter a valid username or email address.' }, 400)
      }
      const { data, error: lookupError } = await admin.rpc('find_confirmed_user_by_email', { email_query: email })
      if (lookupError) throw new Error(`Could not look up this account: ${lookupError.message}`)
      friendId = data
    } else {
      const username = identifier.toLowerCase()
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return jsonResponse({ error: 'Enter a username (3–24 letters, numbers, or underscores) or an email address.' }, 400)
      }
      const { data, error: lookupError } = await admin
        .from('cookbook_profiles')
        .select('user_id')
        .eq('username', username)
        .maybeSingle()
      if (lookupError) throw new Error(`Could not look up this account: ${lookupError.message}`)
      friendId = data?.user_id ?? null
    }
    if (!friendId || friendId === user.id) {
      return jsonResponse({ error: friendId ? 'That is your own account.' : 'No account was found for that username or email.' }, 404)
    }
    const { data: friendUser, error: friendUserError } = await admin.auth.admin.getUserById(friendId)
    if (friendUserError) throw new Error(`Could not load this account: ${friendUserError.message}`)
    if (!friendUser.user?.email || !friendUser.user.email_confirmed_at) {
      return jsonResponse({ error: 'No confirmed account was found for that username or email.' }, 404)
    }
    email = friendUser.user.email

    if (body.action === 'add_friend') {
      const { data: existing, error: existingError } = await admin
        .from('cookbook_friendships')
        .select('requester_id, recipient_id, status')
        .or(`and(requester_id.eq.${user.id},recipient_id.eq.${friendId}),and(requester_id.eq.${friendId},recipient_id.eq.${user.id})`)
        .maybeSingle()
      if (existingError) throw new Error(`Could not check friend status: ${existingError.message}`)
      if (existing?.status === 'accepted') return jsonResponse({ status: 'accepted', friend: { id: friendId, email } })
      if (existing?.status === 'pending') {
        return jsonResponse({ status: existing.requester_id === user.id ? 'request_sent' : 'request_received', friend: { id: friendId, email } })
      }
      const { error } = await admin
        .from('cookbook_friendships')
        .insert({ requester_id: user.id, recipient_id: friendId })
      if (error) throw new Error(`Could not add this friend: ${error.message}`)
      return jsonResponse({ status: 'request_sent', friend: { id: friendId, email } })
    }

    const { data: friendship, error: friendshipError } = await admin
      .from('cookbook_friendships')
      .select('requester_id, recipient_id, status')
      .or(`and(requester_id.eq.${user.id},recipient_id.eq.${friendId}),and(requester_id.eq.${friendId},recipient_id.eq.${user.id})`)
      .maybeSingle()
    if (friendshipError) throw new Error(`Could not check friend status: ${friendshipError.message}`)
    const relationshipStatus = friendship?.status === 'accepted'
      ? 'accepted'
      : friendship?.status === 'pending'
        ? friendship.requester_id === user.id ? 'request_sent' : 'request_received'
        : 'none'

    if (body.action === 'search') {
      if (relationshipStatus !== 'accepted') {
        return jsonResponse({ email, friendId, relationshipStatus, recipes: [] })
      }
      const recipes: RecipeRow[] = []
      const pageSize = 100
      for (let start = 0; ; start += pageSize) {
        const { data, error } = await admin
          .from('recipes')
          .select(recipeColumns)
          .eq('user_id', friendId)
          .order('created_at', { ascending: false })
          .range(start, start + pageSize - 1)
        if (error) throw new Error(`Could not load this cookbook: ${error.message}`)
        const page = (data ?? []) as RecipeRow[]
        for (const recipe of page) {
          let imageUrl: string | null = null
          if (recipe.image_path) {
            const { data: signedImage, error: imageError } = await admin.storage
              .from('recipe-images')
              .createSignedUrl(recipe.image_path, 3600)
            if (imageError) throw new Error(`Could not load a recipe photo: ${imageError.message}`)
            imageUrl = signedImage.signedUrl
          }
          recipes.push({ ...recipe, tags: recipe.tags ?? [], imageUrl } as RecipeRow & { imageUrl: string | null })
        }
        if (page.length < pageSize) break
      }
      return jsonResponse({ email, friendId, relationshipStatus, recipes })
    }

    if (body.action === 'copy') {
      if (relationshipStatus !== 'accepted') {
        return jsonResponse({ error: 'You must be accepted as friends before you can copy recipes from this cookbook.' }, 403)
      }
      if (typeof body.recipeId !== 'string' || !uuidPattern.test(body.recipeId)) {
        return jsonResponse({ error: 'Choose a valid recipe to add.' }, 400)
      }
      const { data: source, error: sourceError } = await admin
        .from('recipes')
        .select(recipeColumns)
        .eq('id', body.recipeId)
        .eq('user_id', friendId)
        .maybeSingle()
      if (sourceError) throw new Error(`Could not load the selected recipe: ${sourceError.message}`)
      if (!source) return jsonResponse({ error: 'This recipe is no longer available in that cookbook.' }, 404)

      let copiedImagePath: string | null = null
      if (source.image_path) {
        const { data: image, error: downloadError } = await admin.storage
          .from('recipe-images')
          .download(source.image_path)
        if (downloadError) throw new Error(`Could not copy the recipe photo: ${downloadError.message}`)
        const extension = source.image_path.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        copiedImagePath = `${user.id}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await admin.storage
          .from('recipe-images')
          .upload(copiedImagePath, image, { contentType: image.type || 'image/jpeg', upsert: false })
        if (uploadError) throw new Error(`Could not save a copy of the recipe photo: ${uploadError.message}`)
      }

      const { data: copiedRecipe, error: copyError } = await admin
        .from('recipes')
        .insert({
          user_id: user.id,
          title: source.title,
          description: source.description,
          ingredients: source.ingredients,
          steps: source.steps,
          category: source.category,
          tags: source.tags ?? [],
          recommended_from: source.recommended_from,
          prep_time_minutes: source.prep_time_minutes,
          cook_time_minutes: source.cook_time_minutes,
          servings: source.servings,
          source_url: source.source_url,
          image_path: copiedImagePath,
          rating: null,
        })
        .select('id, title')
        .single()
      if (copyError) {
        if (copiedImagePath) {
          const { error: cleanupError } = await admin.storage.from('recipe-images').remove([copiedImagePath])
          if (cleanupError) throw new Error(`Could not add the recipe: ${copyError.message}. Photo cleanup also failed: ${cleanupError.message}`)
        }
        throw new Error(`Could not add the recipe: ${copyError.message}`)
      }
      return jsonResponse({ recipe: copiedRecipe })
    }

    return jsonResponse({ error: 'Choose search or copy as the action.' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred while accessing this cookbook.'
    return jsonResponse({ error: message }, 500)
  }
})
