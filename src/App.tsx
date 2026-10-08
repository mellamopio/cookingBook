import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Bell,
  Check,
  ChefHat,
  Clock3,
  Coffee,
  Compass,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Settings,
  Camera,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkles,
  Star,
  Utensils,
  Users,
  X,
} from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { emptyDraft } from './types'
import type { Recipe, RecipeDraft } from './types'

type ExtractedRecipe = Pick<
  Recipe,
  'title' | 'description' | 'ingredients' | 'steps' | 'category' |
  'prep_time_minutes' | 'cook_time_minutes' | 'servings'
>

type RecipeTranslation = {
  title: string
  description: string
  category: string
  ingredients: string[]
  steps: string[]
}

type RecipeSourceImage = { id: string; imageUrl: string }

function isRecipeTranslation(value: unknown): value is RecipeTranslation {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.title === 'string' &&
    typeof item.description === 'string' &&
    typeof item.category === 'string' &&
    Array.isArray(item.ingredients) &&
    Array.isArray(item.steps) &&
    item.ingredients.every((entry) => typeof entry === 'string') &&
    item.steps.every((entry) => typeof entry === 'string')
}

type CookbookFriend = {
  id: string
  email: string
}

type FriendRequest = {
  id: string
  email: string
  requesterId: string
}

type SocialRecipe = Recipe & {
  authorUsername?: string | null
  ratingCount?: number
  averageRating?: number | null
}

type RecipeComment = {
  id: string
  recipe_id: string
  user_id: string
  body: string
  image_path: string | null
  created_at: string
  author: string
  imageUrl: string | null
}

type CookbookNotification = {
  id: string
  actor_id: string | null
  event_type: string
  recipe_id: string | null
  created_at: string
  read_at: string | null
  actorName: string
}

function weightedRating(recipe: SocialRecipe, prior: number): number {
  const count = recipe.ratingCount ?? 0
  if (!count) return -1
  const priorVotes = 5
  return (((recipe.averageRating ?? 0) * count) + (prior * priorVotes)) / (count + priorVotes)
}

const categories = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack']
const createCategoryOption = '__create_category__'
type RecipeVisibility = Recipe['visibility']

function parseTags(value: string): string[] {
  const seen = new Set<string>()
  return value.split(',').map((tag) => tag.trim()).filter((tag) => {
    const normalized = tag.toLocaleLowerCase()
    if (!tag || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

async function functionErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  if (error.context instanceof Response) {
    try {
      const body: unknown = await error.context.clone().json()
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        return body.error
      }
    } catch {
      return `HTTP ${error.context.status}: ${error.message}`
    }
    return `HTTP ${error.context.status}: ${error.message}`
  }
  return error.message
}

async function compressImageForExtraction(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('The selected photo could not be prepared for import.')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const compressed = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The selected photo could not be compressed.')), 'image/jpeg', 0.72)
  })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The selected photo could not be read.'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The selected photo could not be read.'))
    reader.readAsDataURL(compressed)
  })
}

function minutesLabel(prep: number | null, cook: number | null): string {
  const total = (prep ?? 0) + (cook ?? 0)
  if (!total) return 'Time varies'
  return `${total} min`
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [discoveryRecipes, setDiscoveryRecipes] = useState<SocialRecipe[]>([])
  const [friendsFeedRecipes, setFriendsFeedRecipes] = useState<SocialRecipe[]>([])
  const [followingFeedRecipes, setFollowingFeedRecipes] = useState<SocialRecipe[]>([])
  const [savedRecipes, setSavedRecipes] = useState<Recipe[]>([])
  const [recentlyViewedRecipes, setRecentlyViewedRecipes] = useState<Recipe[]>([])
  const [savedRecipeIds, setSavedRecipeIds] = useState<Set<string>>(new Set())
  const [friends, setFriends] = useState<CookbookFriend[]>([])
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([])
  const [recipesLoading, setRecipesLoading] = useState(false)
  const [activeCategory, setActiveCategory] = useState('All recipes')
  const [activeView, setActiveView] = useState<'discover' | 'cookbook' | 'saved'>('cookbook')
  const [discoverySort, setDiscoverySort] = useState<'new' | 'best'>('new')
  const [discoveryFeed, setDiscoveryFeed] = useState<'public' | 'friends' | 'following'>('public')
  const [query, setQuery] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isFriendsOpen, setIsFriendsOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [friendCookbookEmail, setFriendCookbookEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!supabase) {
      setSessionLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setLoadError(error.message)
      setUser(data.session?.user ?? null)
      setSessionLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setRecipes([])
    setDiscoveryRecipes([])
    setFollowingFeedRecipes([])
    setSavedRecipes([])
    setRecentlyViewedRecipes([])
    setSavedRecipeIds(new Set())
    setFriends([])
    setFriendRequests([])
    setAvatarUrl(null)
    setActiveCategory('All recipes')
    setSelectedRecipe(null)
    if (user) {
      void loadRecipes()
      void loadFriends()
      void loadDiscoveryRecipes()
      void loadRecentlyViewed()
    } else {
      setRecipesLoading(false)
    }
  }, [user])

  useEffect(() => {
    let isCurrent = true
    async function loadAvatar() {
      const path = user?.user_metadata?.avatar_path
      if (!supabase || !user || typeof path !== 'string' || !path.startsWith(`${user.id}/`)) {
        setAvatarUrl(null)
        return
      }
      const { data, error } = await supabase.storage.from('profile-images').createSignedUrl(path, 3600)
      if (!isCurrent) return
      if (error) {
        setLoadError(`Could not load your profile picture: ${error.message}`)
        return
      }
      setAvatarUrl(data.signedUrl)
    }
    void loadAvatar()
    return () => { isCurrent = false }
  }, [user])

  async function loadFriends() {
    if (!supabase || !user) return
    const { data, error } = await supabase.functions.invoke('friend-cookbook', {
      body: { action: 'list_friends' },
    })
    if (error) {
      setLoadError(`Could not load your friends: ${await functionErrorMessage(error)}`)
      return
    }
    if (!data || !Array.isArray(data.friends) || !Array.isArray(data.requests) || !data.friends.every((friend: unknown) =>
      friend && typeof friend === 'object' && 'id' in friend && typeof friend.id === 'string' && 'email' in friend && typeof friend.email === 'string',
    )) {
      setLoadError('Could not load your friends: the server returned an invalid response.')
      return
    }
    setFriends(data.friends as CookbookFriend[])
    setFriendRequests(data.requests as FriendRequest[])
  }

  async function loadRecipes() {
    if (!supabase || !user) return
    const client = supabase
    setRecipesLoading(true)
    setLoadError('')
    const { data, error } = await client
      .from('recipes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) {
      setLoadError(error.message)
      setRecipesLoading(false)
      return
    }
    const withImages = await Promise.all((data ?? []).map(async (recipe) => {
      if (!recipe.image_path) return recipe as Recipe
      const { data: signedImage, error: imageError } = await client.storage
        .from('recipe-images')
        .createSignedUrl(recipe.image_path, 3600)
      if (imageError) {
        setLoadError(`Could not load a recipe image: ${imageError.message}`)
        return recipe as Recipe
      }
      return { ...recipe, imageUrl: signedImage.signedUrl } as Recipe
    }))
    setRecipes(withImages)
    setRecipesLoading(false)
    await loadSavedRecipes(client)
  }

  async function loadSavedRecipes(client = supabase) {
    if (!client || !user) return
    const { data: saves, error: savesError } = await client
      .from('recipe_saves')
      .select('recipe_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (savesError) {
      setLoadError(`Could not load saved recipes: ${savesError.message}`)
      return
    }
    const ids = (saves ?? []).map((save) => save.recipe_id)
    setSavedRecipeIds(new Set(ids))
    if (!ids.length) {
      setSavedRecipes([])
      return
    }
    const { data, error } = await client.from('recipes').select('*').in('id', ids)
    if (error) {
      setLoadError(`Could not load saved recipes: ${error.message}`)
      return
    }
    const recipesById = new Map((data ?? []).map((recipe) => [recipe.id, recipe]))
    const ordered = ids.flatMap((id) => {
      const recipe = recipesById.get(id)
      return recipe ? [recipe as Recipe] : []
    })
    if (!ordered.length) {
      setSavedRecipes([])
      return
    }
    const [{ data: ratings, error: ratingsError }, { data: profiles, error: profilesError }] = await Promise.all([
      client.from('recipe_ratings').select('recipe_id, user_id, rating').in('recipe_id', ids),
      client.from('cookbook_profiles').select('user_id, username').in('user_id', [...new Set(ordered.map((recipe) => recipe.user_id).filter((id): id is string => Boolean(id)))]),
    ])
    if (ratingsError) {
      setLoadError(`Could not load saved recipe ratings: ${ratingsError.message}`)
      return
    }
    if (profilesError) {
      setLoadError(`Could not load saved recipe authors: ${profilesError.message}`)
      return
    }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const withRatings = ordered.map((recipe) => {
      const recipeRatings = (ratings ?? []).filter((item) => item.recipe_id === recipe.id)
      return {
        ...recipe,
        rating: recipe.user_id === user.id ? recipe.rating : recipeRatings.find((item) => item.user_id === user.id)?.rating ?? null,
        averageRating: recipeRatings.length ? recipeRatings.reduce((sum, item) => sum + item.rating, 0) / recipeRatings.length : null,
        ratingCount: recipeRatings.length,
        authorUsername: recipe.user_id ? names.get(recipe.user_id) ?? null : null,
      } as SocialRecipe
    })
    const withImages = await Promise.all(withRatings.map(async (recipe) => {
      if (!recipe.image_path) return recipe
      const { data: image, error: imageError } = await client.storage.from('recipe-images').createSignedUrl(recipe.image_path, 3600)
      if (imageError) {
        setLoadError(`Could not load a saved recipe image: ${imageError.message}`)
        return recipe
      }
      return { ...recipe, imageUrl: image.signedUrl }
    }))
    setSavedRecipes(withImages)
  }

  async function loadRecentlyViewed() {
    if (!supabase || !user) return
    const client = supabase
    const { data: views, error: viewsError } = await client
      .from('recipe_views')
      .select('recipe_id, viewed_at')
      .eq('user_id', user.id)
      .order('viewed_at', { ascending: false })
      .limit(12)
    if (viewsError) {
      setLoadError(`Could not load recently viewed recipes: ${viewsError.message}`)
      return
    }
    const ids = (views ?? []).map((view) => view.recipe_id)
    if (!ids.length) {
      setRecentlyViewedRecipes([])
      return
    }
    const { data, error } = await client.from('recipes').select('*').in('id', ids)
    if (error) {
      setLoadError(`Could not load recently viewed recipes: ${error.message}`)
      return
    }
    const ordered = new Map((data ?? []).map((recipe) => [recipe.id, recipe]))
    const recent = ids.flatMap((id) => {
      const recipe = ordered.get(id)
      return recipe ? [recipe] : []
    })
    const { data: ratings, error: ratingsError } = await client.from('recipe_ratings').select('recipe_id, user_id, rating').in('recipe_id', ids)
    if (ratingsError) {
      setLoadError(`Could not load recent recipe ratings: ${ratingsError.message}`)
      return
    }
    const withRatings = recent.map((recipe) => ({
      ...recipe,
      rating: recipe.user_id === user.id
        ? recipe.rating
        : (ratings ?? []).find((rating) => rating.recipe_id === recipe.id && rating.user_id === user.id)?.rating ?? null,
    }) as Recipe)
    const withImages = await Promise.all(withRatings.map(async (recipe) => {
      if (!recipe.image_path) return recipe as Recipe
      const { data: image, error: imageError } = await client.storage.from('recipe-images').createSignedUrl(recipe.image_path, 3600)
      if (imageError) {
        setLoadError(`Could not load a recent recipe image: ${imageError.message}`)
        return recipe as Recipe
      }
      return { ...recipe, imageUrl: image.signedUrl } as Recipe
    }))
    setRecentlyViewedRecipes(withImages)
  }

  async function openRecipe(recipe: Recipe) {
    let openedRecipe = recipe
    if (!supabase || !user) return
    if (recipe.user_id !== user.id) {
      const { data: rating, error: ratingError } = await supabase
        .from('recipe_ratings')
        .select('rating')
        .eq('recipe_id', recipe.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (ratingError) {
        setNotice(`Could not load your rating: ${ratingError.message}`)
      } else {
        openedRecipe = { ...recipe, rating: rating?.rating ?? null }
      }
    }
    setSelectedRecipe(openedRecipe)
    const { error } = await supabase
      .from('recipe_views')
      .upsert({ user_id: user.id, recipe_id: openedRecipe.id, viewed_at: new Date().toISOString() }, { onConflict: 'user_id,recipe_id' })
    if (error) {
      setNotice(`Recipe opened, but its view history could not be saved: ${error.message}`)
      return
    }
    setRecentlyViewedRecipes((current) => [openedRecipe, ...current.filter((item) => item.id !== openedRecipe.id)].slice(0, 12))
  }

  async function loadDiscoveryRecipes() {
    if (!supabase) return
    const client = supabase
    const { data, error } = await client
      .from('recipes')
      .select('*')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) {
      setLoadError(`Could not load public recipes: ${error.message}`)
      return
    }
    const rows = data ?? []
    if (!rows.length) {
      setDiscoveryRecipes([])
      return
    }
    const ids = rows.map((recipe) => recipe.id)
    const ownerIds = [...new Set(rows.map((recipe) => recipe.user_id))]
    const [{ data: ratings, error: ratingsError }, { data: profiles, error: profilesError }] = await Promise.all([
      client.from('recipe_ratings').select('recipe_id, user_id, rating').in('recipe_id', ids),
      client.from('cookbook_profiles').select('user_id, username').in('user_id', ownerIds),
    ])
    if (ratingsError) {
      setLoadError(`Could not load public recipe ratings: ${ratingsError.message}`)
      return
    }
    if (profilesError) {
      setLoadError(`Could not load recipe authors: ${profilesError.message}`)
      return
    }
    const ratingGroups = new Map<string, number[]>()
    for (const rating of ratings ?? []) {
      ratingGroups.set(rating.recipe_id, [...(ratingGroups.get(rating.recipe_id) ?? []), rating.rating])
    }
    const profileNames = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const enriched = await Promise.all(rows.map(async (row) => {
      const recipe = row as Recipe & { user_id: string }
      const values = ratingGroups.get(recipe.id) ?? []
      const average = values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
      const myRating = (ratings ?? []).find((rating) => rating.recipe_id === recipe.id && rating.user_id === user?.id)?.rating ?? null
      const image = recipe.image_path
        ? await client.storage.from('recipe-images').createSignedUrl(recipe.image_path, 3600)
        : null
      if (image?.error) setLoadError(`Could not load a public recipe image: ${image.error.message}`)
      return {
        ...recipe,
        rating: myRating,
        averageRating: average,
        ratingCount: values.length,
        authorUsername: profileNames.get(recipe.user_id) ?? null,
        imageUrl: image?.data?.signedUrl ?? null,
      } as SocialRecipe
    }))
    setDiscoveryRecipes(enriched)
  }

  async function loadFriendsFeed() {
    if (!supabase) return
    const { data, error } = await supabase.functions.invoke('friend-cookbook', { body: { action: 'friends_feed' } })
    if (error) {
      setLoadError(`Could not load friends' recipes: ${await functionErrorMessage(error)}`)
      return
    }
    if (!data || !Array.isArray(data.recipes)) {
      setLoadError('Friends feed returned an invalid response.')
      return
    }
    const rows = data.recipes as (Recipe & { user_id: string; imageUrl?: string | null })[]
    if (!rows.length) {
      setFriendsFeedRecipes([])
      return
    }
    const ids = rows.map((recipe) => recipe.id)
    const ownerIds = [...new Set(rows.map((recipe) => recipe.user_id))]
    const [{ data: ratings, error: ratingsError }, { data: profiles, error: profilesError }] = await Promise.all([
      supabase.from('recipe_ratings').select('recipe_id, user_id, rating').in('recipe_id', ids),
      supabase.from('cookbook_profiles').select('user_id, username').in('user_id', ownerIds),
    ])
    if (ratingsError) {
      setLoadError(`Could not load recipe ratings: ${ratingsError.message}`)
      return
    }
    if (profilesError) {
      setLoadError(`Could not load recipe authors: ${profilesError.message}`)
      return
    }
    const profileNames = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    setFriendsFeedRecipes(rows.map((recipe) => {
      const recipeRatings = (ratings ?? []).filter((rating) => rating.recipe_id === recipe.id)
      const average = recipeRatings.length
        ? recipeRatings.reduce((sum, item) => sum + item.rating, 0) / recipeRatings.length
        : null
      const myRating = recipeRatings.find((item) => item.user_id === user?.id)?.rating ?? null
      return {
        ...recipe,
        rating: myRating,
        averageRating: average,
        ratingCount: recipeRatings.length,
        authorUsername: profileNames.get(recipe.user_id) ?? null,
      }
    }))
  }

  async function loadFollowingFeed() {
    if (!supabase || !user) return
    const client = supabase
    const { data: follows, error: followsError } = await client
      .from('cookbook_follows')
      .select('followed_id')
      .eq('follower_id', user.id)
    if (followsError) {
      setLoadError(`Could not load followed cooks: ${followsError.message}`)
      return
    }
    const userIds = (follows ?? []).map((follow) => follow.followed_id)
    if (!userIds.length) {
      setFollowingFeedRecipes([])
      return
    }
    const { data: rows, error: recipesError } = await client
      .from('recipes')
      .select('*')
      .in('user_id', userIds)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(60)
    if (recipesError) {
      setLoadError(`Could not load recipes from followed cooks: ${recipesError.message}`)
      return
    }
    if (!rows?.length) {
      setFollowingFeedRecipes([])
      return
    }
    const recipeIds = rows.map((row) => row.id)
    const [{ data: ratings, error: ratingsError }, { data: profiles, error: profilesError }] = await Promise.all([
      client.from('recipe_ratings').select('recipe_id, user_id, rating').in('recipe_id', recipeIds),
      client.from('cookbook_profiles').select('user_id, username').in('user_id', userIds),
    ])
    if (ratingsError) {
      setLoadError(`Could not load followed recipe ratings: ${ratingsError.message}`)
      return
    }
    if (profilesError) {
      setLoadError(`Could not load followed cooks: ${profilesError.message}`)
      return
    }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const enriched = await Promise.all(rows.map(async (row) => {
      const recipeRatings = (ratings ?? []).filter((rating) => rating.recipe_id === row.id)
      const image = row.image_path
        ? await client.storage.from('recipe-images').createSignedUrl(row.image_path, 3600)
        : null
      if (image?.error) setLoadError(`Could not load a followed recipe image: ${image.error.message}`)
      return {
        ...row,
        rating: recipeRatings.find((item) => item.user_id === user.id)?.rating ?? null,
        averageRating: recipeRatings.length ? recipeRatings.reduce((sum, item) => sum + item.rating, 0) / recipeRatings.length : null,
        ratingCount: recipeRatings.length,
        authorUsername: names.get(row.user_id) ?? null,
        imageUrl: image?.data?.signedUrl ?? null,
      } as SocialRecipe
    }))
    setFollowingFeedRecipes(enriched)
  }

  async function toggleSavedRecipe(recipe: Recipe) {
    if (!supabase || !user) return
    const alreadySaved = savedRecipeIds.has(recipe.id)
    const result = alreadySaved
      ? await supabase.from('recipe_saves').delete().eq('user_id', user.id).eq('recipe_id', recipe.id)
      : await supabase.from('recipe_saves').insert({ user_id: user.id, recipe_id: recipe.id })
    if (result.error) {
      setNotice(`Could not ${alreadySaved ? 'remove' : 'save'} recipe: ${result.error.message}`)
      return
    }
    setSavedRecipeIds((current) => {
      const next = new Set(current)
      if (alreadySaved) next.delete(recipe.id)
      else next.add(recipe.id)
      return next
    })
    await loadSavedRecipes()
    setNotice(alreadySaved ? 'Recipe removed from saved recipes.' : 'Recipe saved to your cookbook.')
  }

  async function setRecipeRating(recipe: Recipe, rating: number | null) {
    if (!supabase) return
    const { error } = await supabase
      .from('recipes')
      .update({ rating })
      .eq('id', recipe.id)
    if (error) {
      setNotice(`Could not save recipe rating: ${error.message}`)
      return
    }
    setRecipes((current) => current.map((item) =>
      item.id === recipe.id ? { ...item, rating } : item,
    ))
    setSelectedRecipe((current) => current?.id === recipe.id
      ? { ...current, rating }
      : current)
  }

  async function rateAnyRecipe(recipe: Recipe, rating: number) {
    if (!supabase || !user) return
    if (recipe.user_id === user.id) {
      await setRecipeRating(recipe, recipe.rating === rating ? null : rating)
      return
    }
    const result = recipe.rating === rating
      ? await supabase.from('recipe_ratings').delete().eq('user_id', user.id).eq('recipe_id', recipe.id)
      : await supabase.from('recipe_ratings').upsert(
        { user_id: user.id, recipe_id: recipe.id, rating },
        { onConflict: 'user_id,recipe_id' },
      )
    if (result.error) {
      setNotice(`Could not save your rating: ${result.error.message}`)
      return
    }
    const nextRating = recipe.rating === rating ? null : rating
    setSelectedRecipe((current) => current?.id === recipe.id ? { ...current, rating: nextRating } : current)
    setRecentlyViewedRecipes((current) => current.map((item) => item.id === recipe.id ? { ...item, rating: nextRating } : item))
    const refresh: Promise<void>[] = []
    if (discoveryRecipes.some((item) => item.id === recipe.id)) refresh.push(loadDiscoveryRecipes())
    if (friendsFeedRecipes.some((item) => item.id === recipe.id)) refresh.push(loadFriendsFeed())
    if (followingFeedRecipes.some((item) => item.id === recipe.id)) refresh.push(loadFollowingFeed())
    if (savedRecipes.some((item) => item.id === recipe.id)) refresh.push(loadSavedRecipes())
    await Promise.all(refresh)
  }

  async function removeFriend(friend: CookbookFriend) {
    if (!supabase) return
    const { error } = await supabase.functions.invoke('friend-cookbook', {
      body: { action: 'remove_friend', friendId: friend.id },
    })
    if (error) {
      setNotice(`Could not remove friend: ${await functionErrorMessage(error)}`)
      return
    }
    setFriends((current) => current.filter((item) => item.id !== friend.id))
    setNotice(`${friend.email} was removed from your friends.`)
  }

  async function respondToFriendRequest(request: FriendRequest, accept: boolean) {
    if (!supabase) return
    const { error } = await supabase.functions.invoke('friend-cookbook', {
      body: { action: accept ? 'accept_friend' : 'decline_friend', requesterId: request.requesterId },
    })
    if (error) {
      setNotice(`Could not ${accept ? 'accept' : 'decline'} friend request: ${await functionErrorMessage(error)}`)
      return
    }
    setFriendRequests((current) => current.filter((item) => item.requesterId !== request.requesterId))
    if (accept) {
      setFriends((current) => current.some((item) => item.id === request.id) ? current : [...current, { id: request.id, email: request.email }])
      setNotice(`You and ${request.email} are now friends.`)
    } else {
      setNotice(`Friend request from ${request.email} declined.`)
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setNotice(`Could not sign out: ${error.message}`)
  }

  const availableCategories = useMemo(() => {
    const existing = recipes.map((recipe) => recipe.category).filter(Boolean)
    return [...new Set([...categories, 'Other', ...existing])]
  }, [recipes])

  const filteredRecipes = useMemo(() => recipes.filter((recipe) => {
    const matchesCategory = activeCategory === 'All recipes' ||
      recipe.category === activeCategory
    const searchText = `${recipe.title} ${recipe.description} ${recipe.ingredients.join(' ')} ${(recipe.tags ?? []).join(' ')}`.toLowerCase()
    return matchesCategory && searchText.includes(query.trim().toLowerCase())
  }), [recipes, activeCategory, query])
  const priorRating = useMemo(() => {
    const feedRecipes = discoveryFeed === 'friends' ? friendsFeedRecipes : discoveryRecipes
    const total = feedRecipes.reduce((sum, recipe) => sum + (recipe.averageRating ?? 0) * (recipe.ratingCount ?? 0), 0)
    const count = feedRecipes.reduce((sum, recipe) => sum + (recipe.ratingCount ?? 0), 0)
    return count ? total / count : 3.5
  }, [discoveryFeed, discoveryRecipes, friendsFeedRecipes])
  const visibleDiscoveryRecipes = discoveryFeed === 'friends' ? friendsFeedRecipes : discoveryFeed === 'following' ? followingFeedRecipes : discoveryRecipes

  const sharedToken = window.location.pathname.match(/^\/shared\/([^/]+)\/?$/)?.[1]
  if (sharedToken) return <SharedRecipePage token={sharedToken} />
  if (!isSupabaseConfigured) return <SetupScreen />
  if (sessionLoading) return <div className="screen-loader"><LoaderCircle className="spin" /> Loading your kitchen…</div>
  if (!user) return <AuthScreen />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Cook & Tell home">
          <span className="brand-mark"><ChefHat size={19} strokeWidth={1.8} /></span>
          <span>Cook &amp; Tell</span>
        </a>
        <div className="side-intro">
          <span className="eyebrow">YOUR RECIPE COMMUNITY</span>
          <p>A little inspiration for whatever’s in the fridge.</p>
        </div>
        <nav className="side-nav" aria-label="Recipe categories">
          <span className="nav-label">COOK &amp; TELL</span>
          <button className={`nav-item ${activeView === 'discover' ? 'active' : ''}`} onClick={() => setActiveView('discover')}>
            <Compass size={17} /> <span>Discover</span>
          </button>
          <button className={`nav-item ${activeView === 'cookbook' ? 'active' : ''}`} onClick={() => { setActiveView('cookbook'); setActiveCategory('All recipes') }}>
            <BookOpen size={17} /> <span>My recipes</span><span className="nav-count">{recipes.length}</span>
          </button>
          <button className={`nav-item ${activeView === 'saved' ? 'active' : ''}`} onClick={() => setActiveView('saved')}>
            <Bookmark size={17} /> <span>Saved recipes</span><span className="nav-count">{savedRecipes.length}</span>
          </button>
          <button className={`nav-item ${isFriendsOpen ? 'active' : ''}`} onClick={() => setIsFriendsOpen(true)}>
            <Users size={17} /> <span>Find a friend</span>
          </button>
          {friendRequests.length > 0 && <span className="nav-label friends-label">FRIEND REQUESTS</span>}
          {friendRequests.map((request) => (
            <div className="friend-request-row" key={request.requesterId}>
              <span className="friend-request-email" title={request.email}>{request.email}</span>
              <button aria-label={`Accept friend request from ${request.email}`} title="Accept" onClick={() => void respondToFriendRequest(request, true)}><Check size={13} /></button>
              <button aria-label={`Decline friend request from ${request.email}`} title="Decline" onClick={() => void respondToFriendRequest(request, false)}><X size={13} /></button>
            </div>
          ))}
          <span className="nav-label category-label">CATEGORIES</span>
          {availableCategories.map((category) => (
            <button
              className={`nav-item ${activeCategory === category ? 'active' : ''}`}
              key={category}
              onClick={() => setActiveCategory(category)}
            >
              <span className="category-dot" /> <span>{category}</span>
            </button>
          ))}
          <span className="nav-label friends-label">FRIENDS</span>
          {friends.map((friend) => (
            <div className="friend-nav-row" key={friend.id}>
              <button
                className="friend-nav-item"
                title={`View ${friend.email}’s cookbook`}
                onClick={() => {
                  setFriendCookbookEmail(friend.email)
                  setIsFriendsOpen(true)
                }}
              >
                <span className="friend-avatar">{friend.email[0].toUpperCase()}</span>
                <span>{friend.email}</span>
              </button>
              <button
                className="friend-remove"
                aria-label={`Remove ${friend.email} from friends`}
                title="Remove friend"
                onClick={() => void removeFriend(friend)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Sparkles size={15} />
            <p><strong>A good recipe is worth keeping.</strong><br />Save one you love today.</p>
          </div>
          <button className="account-button" onClick={() => setIsSettingsOpen(true)}>
            {avatarUrl ? <img className="avatar avatar-image" src={avatarUrl} alt="" /> : <span className="avatar">{(user.email?.[0] ?? 'Y').toUpperCase()}</span>}
            <span className="account-email">{user.email}</span>
            <Settings size={15} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Cook &amp; Tell</span><ArrowRight size={13} /><strong>{activeCategory}</strong></div>
          <div className="top-actions">
            <NotificationsButton key={user.id} userId={user.id} onOpenRecipe={(recipe) => void openRecipe(recipe)} />
            <label className="search-box">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes…" aria-label="Search recipes" />
            </label>
            <button className="primary-button top-add" onClick={() => setIsAddOpen(true)}><Plus size={17} /> Add a recipe</button>
          </div>
        </header>

        {activeView === 'discover' ? (
          <section className="page-heading">
            <div>
              <span className="eyebrow">A TABLE FULL OF INSPIRATION</span>
              <h1>Discover recipes</h1>
              <p>{discoveryFeed === 'following' ? 'Public recipes from cooks you follow.' : 'Fresh ideas shared by cooks in the community.'}</p>
            </div>
            <div className="recipe-total"><span>{discoveryRecipes.length.toString().padStart(2, '0')}</span><small>PUBLIC<br />RECIPES</small></div>
          </section>
        ) : <section className="page-heading">
          <div>
            <span className="eyebrow">{activeView === 'saved' ? 'KEPT CLOSE FOR LATER' : 'A COLLECTION MADE YOURS'}</span>
            <h1>{activeView === 'saved' ? 'Saved recipes' : activeCategory === 'All recipes' ? 'The recipe box' : activeCategory}</h1>
            <p>{activeView === 'saved'
              ? 'Recipes you saved from other cooks.'
              : activeCategory === 'All recipes'
              ? 'The keepers, the weeknight wins, and the ones you can’t wait to make again.'
              : `A few good ideas for ${activeCategory.toLowerCase()}.`}
            </p>
          </div>
          <div className="recipe-total"><span>{(activeView === 'saved' ? savedRecipes.length : recipes.length).toString().padStart(2, '0')}</span><small>RECIPES<br />COLLECTED</small></div>
        </section>}

        {loadError && <div className="inline-alert" role="alert">{loadError}<button onClick={() => setLoadError('')} aria-label="Dismiss"><X size={15} /></button></div>}
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}

        {activeView === 'discover' ? (
          <div className="collection-toolbar discovery-toolbar">
            <div className="collection-label"><span className="green-indicator" /> {discoveryFeed === 'friends' ? 'FRIENDS’ RECIPES' : discoveryFeed === 'following' ? 'FOLLOWING' : 'COMMUNITY RECIPES'} <span className="toolbar-count">{visibleDiscoveryRecipes.length}</span></div>
            <div className="discovery-controls">
              <div className="discovery-sort" role="group" aria-label="Recipe feed">
                <button className={discoveryFeed === 'public' ? 'selected' : ''} onClick={() => setDiscoveryFeed('public')}>Everyone</button>
                <button className={discoveryFeed === 'friends' ? 'selected' : ''} onClick={() => { setDiscoveryFeed('friends'); void loadFriendsFeed() }}>Friends</button>
                <button className={discoveryFeed === 'following' ? 'selected' : ''} onClick={() => { setDiscoveryFeed('following'); void loadFollowingFeed() }}>Following</button>
              </div>
              <div className="discovery-sort" role="group" aria-label="Sort recipes">
                <button className={discoverySort === 'new' ? 'selected' : ''} onClick={() => setDiscoverySort('new')}>Newest</button>
                <button className={discoverySort === 'best' ? 'selected' : ''} onClick={() => setDiscoverySort('best')}>Best rated</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="collection-toolbar">
            <div className="collection-label"><span className="green-indicator" /> {query ? 'SEARCH RESULTS' : activeView === 'saved' ? 'SAVED RECIPES' : 'YOUR COLLECTION'} <span className="toolbar-count">{activeView === 'saved' ? savedRecipes.length : filteredRecipes.length}</span></div>
            {activeView !== 'saved' && <button className="sort-button" onClick={() => setIsAddOpen(true)}><ArrowDownToLine size={15} /> Import a recipe</button>}
          </div>
        )}

        {activeView === 'discover' && recentlyViewedRecipes.length > 0 && (
          <section className="recent-section" aria-label="Recently viewed recipes">
            <div className="recent-heading"><h2>Back for another look</h2><span>RECENTLY VIEWED</span></div>
            <div className="recipe-grid recent-grid">
              {recentlyViewedRecipes.slice(0, 3).map((recipe, index) => (
                <RecipeCard key={recipe.id} recipe={recipe} index={index} onOpen={() => void openRecipe(recipe)} onRate={(rating) => void rateAnyRecipe(recipe, rating)} />
              ))}
            </div>
          </section>
        )}

        {activeView !== 'discover' && recipesLoading ? (
          <div className="empty-state"><LoaderCircle className="spin" /><p>Gathering your recipes…</p></div>
        ) : activeView === 'discover' ? (
          visibleDiscoveryRecipes.length ? (
            <div className="recipe-grid">
              {[...visibleDiscoveryRecipes]
                .sort((first, second) => discoverySort === 'new'
                  ? second.created_at.localeCompare(first.created_at)
                  : weightedRating(second, priorRating) - weightedRating(first, priorRating))
                .map((recipe, index) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    index={index}
                    author={recipe.authorUsername ? `@${recipe.authorUsername}` : 'A Cook & Tell cook'}
                    ratingCount={recipe.ratingCount ?? 0}
                    averageRating={recipe.averageRating ?? null}
                    saved={savedRecipeIds.has(recipe.id)}
                    onSave={() => void toggleSavedRecipe(recipe)}
                    onOpen={() => void openRecipe(recipe)}
                    onRate={(rating) => void rateAnyRecipe(recipe, rating)}
                  />
                ))}
            </div>
          ) : <div className="empty-state"><div className="empty-icon"><Compass size={24} /></div><h2>{discoveryFeed === 'friends' ? 'No friend recipes to show' : discoveryFeed === 'following' ? 'No recipes from cooks you follow' : 'No public recipes yet'}</h2><p>{discoveryFeed === 'friends' ? 'Accepted friends can share recipes with you by setting them to Friends or Public.' : discoveryFeed === 'following' ? 'Follow a cook from Find a friend, and their public recipes will show up here.' : 'Recipes are private until their owners choose to share them publicly.'}</p></div>
        ) : (activeView === 'saved' ? savedRecipes : filteredRecipes).length ? (
          <div className="recipe-grid">
            {(activeView === 'saved' ? savedRecipes : filteredRecipes).map((recipe, index) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                index={index}
                author={recipe.user_id === user.id ? 'Your cookbook' : ('authorUsername' in recipe && recipe.authorUsername ? `@${recipe.authorUsername}` : undefined)}
                ratingCount={'ratingCount' in recipe ? recipe.ratingCount : undefined}
                averageRating={'averageRating' in recipe ? recipe.averageRating : undefined}
                saved={activeView === 'saved'}
                onSave={activeView === 'saved' ? () => void toggleSavedRecipe(recipe) : undefined}
                onOpen={() => void openRecipe(recipe)}
                onRate={(rating) => void (recipe.user_id === user.id
                  ? setRecipeRating(recipe, recipe.rating === rating ? null : rating)
                  : rateAnyRecipe(recipe, rating))}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><Utensils size={24} /></div>
            <h2>{activeView === 'saved' ? 'No saved recipes yet' : query ? 'Nothing in the pantry yet' : 'A fresh page'}</h2>
            <p>{activeView === 'saved' ? 'Visit Discover and save recipes you would like to cook.' : query ? 'Try another search, or add a recipe to your collection.' : 'Save a recipe link or snap a photo to start your collection.'}</p>
            {activeView !== 'saved' && <button className="primary-button" onClick={() => setIsAddOpen(true)}><Plus size={16} /> Add your first recipe</button>}
          </div>
        )}
        <footer className="page-footer"><span>Made for the love of good food.</span><span>Cook &amp; Tell</span></footer>
      </main>

      {isAddOpen && <AddRecipeModal user={user} categoryOptions={availableCategories} onClose={() => setIsAddOpen(false)} onSaved={(message) => { void loadRecipes(); if (message) setNotice(message) }} />}
      {isFriendsOpen && <FriendCookbookModal
        userId={user.id}
        initialEmail={friendCookbookEmail}
        onClose={() => { setIsFriendsOpen(false); setFriendCookbookEmail('') }}
        onFriendAdded={(friend) => {
          setFriends((current) => current.some((item) => item.id === friend.id) ? current : [...current, friend])
          setFriendRequests((current) => current.filter((item) => item.id !== friend.id))
        }}
        onFriendRequestReceived={() => void loadFriends()}
        onAdded={(title) => {
          void loadRecipes()
          setNotice(`“${title}” was added to your cookbook.`)
        }}
      />}
      {isSettingsOpen && <SettingsModal
        user={user}
        avatarUrl={avatarUrl}
        onAvatarChanged={setAvatarUrl}
        onClose={() => setIsSettingsOpen(false)}
        onSignOut={() => void signOut()}
      />}
      {editingRecipe && (
        <AddRecipeModal
          user={user}
          categoryOptions={availableCategories}
          recipe={editingRecipe}
          onClose={() => setEditingRecipe(null)}
          onSaved={(message) => { void loadRecipes(); if (message) setNotice(message) }}
        />
      )}
      {selectedRecipe && (
        <RecipeDetail
          recipe={selectedRecipe}
          ownerId={user.id}
          canEdit={selectedRecipe.user_id === user.id}
          onRate={(rating) => void rateAnyRecipe(selectedRecipe, rating)}
          onClose={() => setSelectedRecipe(null)}
          onTagClick={(tag) => {
            setActiveCategory('All recipes')
            setQuery(tag)
            setSelectedRecipe(null)
          }}
          onEdit={() => {
            if (selectedRecipe.user_id !== user.id) return
            setEditingRecipe(selectedRecipe)
            setSelectedRecipe(null)
          }}
        />
      )}
    </div>
  )
}

function SetupScreen() {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <span className="brand"><span className="brand-mark"><ChefHat size={19} /></span><span>Cook &amp; Tell</span></span>
        <span className="eyebrow">ONE QUICK SETUP</span>
        <h1>Your cookbook is almost ready.</h1>
        <p>Connect your Supabase project to enable accounts, cloud-saved recipes, and photo uploads.</p>
        <ol>
          <li>Copy <code>.env.example</code> to <code>.env.local</code>.</li>
          <li>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>.</li>
          <li>Run the database migration and extraction function. See the README for setup.</li>
        </ol>
        <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="primary-button">Open Supabase <ArrowRight size={16} /></a>
      </div>
    </div>
  )
}

function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    const result = isSignUp
      ? await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (result.error) {
      setMessage(result.error.message)
    } else if (isSignUp && !result.data.session) {
      setMessage('Check your email to confirm your account, then come back to sign in.')
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-left">
        <a className="brand" href="#"><span className="brand-mark"><ChefHat size={19} /></span><span>Cook &amp; Tell</span></a>
        <div className="auth-story">
          <span className="eyebrow">GOOD THINGS ARE MADE AT HOME</span>
          <h1>A place for all the recipes you <em>love.</em></h1>
          <p>Collect inspiration from anywhere. Keep the good ones close.</p>
          <div className="auth-note"><Sparkles size={17} /><span>Your own little corner of the kitchen.</span></div>
        </div>
        <div className="auth-left-footer">A COOKBOOK THAT FEELS LIKE YOURS</div>
      </div>
      <div className="auth-right">
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <span className="eyebrow">{isSignUp ? 'START YOUR COLLECTION' : 'WELCOME BACK'}</span>
          <h2>{isSignUp ? 'Make yourself at home.' : 'Come on in.'}</h2>
          <p className="auth-subtitle">{isSignUp ? 'Create an account to save your recipes.' : 'Your next favorite is waiting.'}</p>
          <label className="field-label">Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <label className="field-label">Password<input type="password" required minLength={6} autoComplete={isSignUp ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>
          {message && <div className="form-message" role="status">{message}</div>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{isSignUp ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
          <div className="auth-toggle">{isSignUp ? 'Already have an account?' : 'New to your cookbook?'} <button type="button" onClick={() => { setIsSignUp(!isSignUp); setMessage('') }}>{isSignUp ? 'Sign in' : 'Create an account'}</button></div>
        </form>
      </div>
    </div>
  )
}

function NotificationsButton({ userId, onOpenRecipe }: { userId: string; onOpenRecipe: (recipe: Recipe) => void }) {
  const [notifications, setNotifications] = useState<CookbookNotification[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const unreadCount = notifications.filter((notification) => !notification.read_at).length

  const loadNotifications = useCallback(async () => {
    if (!supabase) return
    const { data, error: queryError } = await supabase
      .from('cookbook_notifications')
      .select('id, actor_id, event_type, recipe_id, created_at, read_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (queryError) {
      setError(`Could not load notifications: ${queryError.message}`)
      return
    }
    const actorIds = [...new Set((data ?? []).flatMap((item) => item.actor_id ? [item.actor_id] : []))]
    const { data: profiles, error: profileError } = actorIds.length
      ? await supabase.from('cookbook_profiles').select('user_id, username').in('user_id', actorIds)
      : { data: [], error: null }
    if (profileError) {
      setError(`Could not load notification authors: ${profileError.message}`)
      return
    }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    setNotifications((data ?? []).map((item) => ({
      ...item,
      actorName: item.actor_id ? names.get(item.actor_id) || 'A cook' : 'A cook',
    })))
    setError('')
  }, [userId])

  useEffect(() => { void loadNotifications() }, [loadNotifications])

  async function openNotification(notification: CookbookNotification) {
    if (!supabase) return
    setError('')
    if (!notification.read_at) {
      const readAt = new Date().toISOString()
      const { error: updateError } = await supabase.from('cookbook_notifications').update({ read_at: readAt }).eq('id', notification.id)
      if (updateError) {
        setError(`Could not mark notification as read: ${updateError.message}`)
        return
      }
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: readAt } : item))
    }
    if (notification.recipe_id) {
      const { data, error: recipeError } = await supabase.from('recipes').select('*').eq('id', notification.recipe_id).maybeSingle()
      if (recipeError) {
        setError(`Could not open the recipe: ${recipeError.message}`)
        return
      }
      if (!data) {
        setError('This recipe is no longer available to you.')
        return
      }
      let recipe = data as Recipe
      if (recipe.image_path) {
        const { data: image, error: imageError } = await supabase.storage.from('recipe-images').createSignedUrl(recipe.image_path, 3600)
        if (imageError) {
          setError(`Could not load the recipe image: ${imageError.message}`)
          return
        }
        recipe = { ...recipe, imageUrl: image.signedUrl }
      }
      onOpenRecipe(recipe)
      setOpen(false)
    }
  }

  function notificationLabel(notification: CookbookNotification) {
    const labels: Record<string, string> = {
      friend_request: 'sent you a friend request',
      friend_accepted: 'accepted your friend request',
      follow: 'started following you',
      comment: 'left a note on your recipe',
      rating: 'rated your recipe',
      save: 'saved your recipe',
    }
    return `${notification.actorName} ${labels[notification.event_type] ?? 'updated your cookbook'}`
  }

  return (
    <div className="notification-wrap">
      <button type="button" className="notification-button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void loadNotifications() }}>
        <Bell size={17} />{unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && <section className="notification-popover" aria-label="Notifications">
        <div className="notification-heading"><strong>Notifications</strong><button type="button" className="text-button" onClick={() => void loadNotifications()}>Refresh</button></div>
        {error && <p className="notification-error" role="alert">{error}</p>}
        {notifications.length ? <div className="notification-list">{notifications.map((notification) => (
          <button key={notification.id} type="button" className={`notification-item ${notification.read_at ? '' : 'unread'}`} onClick={() => void openNotification(notification)}>
            <span className="notification-dot" />
            <span><strong>{notificationLabel(notification)}</strong><small>{new Date(notification.created_at).toLocaleString()}</small></span>
          </button>
        ))}</div> : <p className="notification-empty">You’re all caught up.</p>}
      </section>}
    </div>
  )
}

function RecipeCard({ recipe, index, onOpen, onRate, author, ratingCount, averageRating, saved, onSave }: {
  recipe: Recipe
  index: number
  onOpen: () => void
  onRate: (rating: number) => void
  author?: string
  ratingCount?: number
  averageRating?: number | null
  saved?: boolean
  onSave?: () => void
}) {
  return (
    <article className="recipe-card" style={{ animationDelay: `${Math.min(index * 55, 330)}ms` }}>
      <button className="card-image-button" onClick={onOpen} aria-label={`Open ${recipe.title}`}>
        <div className={`card-image ${!recipe.imageUrl ? `art-${index % 4}` : ''}`}>
          {recipe.imageUrl
            ? <img src={recipe.imageUrl} alt="" />
            : <div className="image-placeholder"><span className="placeholder-ring" /><span className="placeholder-herb">✳</span><span className="placeholder-word">{recipe.category}</span><Utensils className="placeholder-utensils" size={32} strokeWidth={1} /></div>}
          <span className="card-category">{recipe.category || 'Other'}</span>
        </div>
      </button>
      <RatingStars rating={recipe.rating} onRate={onRate} compact />
      {averageRating !== undefined && averageRating !== null && <span className="card-average-rating">{averageRating.toFixed(1)} · {ratingCount ?? 0} {ratingCount === 1 ? 'rating' : 'ratings'}</span>}
      <button className="card-copy" onClick={onOpen}>
        <span className="card-title">{recipe.title}</span>
        <span className="card-description">{recipe.description || 'A new favorite for the table.'}</span>
        {author && <span className="card-author">by {author}</span>}
        {(recipe.tags ?? []).length > 0 && <span className="recipe-tags">{recipe.tags.slice(0, 3).map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</span>}
        <span className="card-meta"><Clock3 size={14} /> {minutesLabel(recipe.prep_time_minutes, recipe.cook_time_minutes)}{recipe.servings ? <><span className="meta-divider">·</span>{recipe.servings} servings</> : null}</span>
        <span className="visibility-indicator">{recipe.visibility === 'public' ? 'Public' : recipe.visibility === 'friends' ? 'Friends' : 'Private'}</span>
      </button>
      {onSave && <button className="secondary-button card-save" type="button" onClick={onSave}><Bookmark size={13} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save recipe'}</button>}
    </article>
  )
}

function RatingStars({ rating, onRate, compact = false }: {
  rating: number | null
  onRate: (rating: number) => void
  compact?: boolean
}) {
  return (
    <div className={`rating-stars ${compact ? 'compact' : ''}`} role="group" aria-label={rating ? `Rated ${rating} out of 5 stars` : 'Rate this recipe'}>
      {Array.from({ length: 5 }, (_, index) => {
        const value = index + 1
        const selected = rating !== null && value <= rating
        return (
          <button
            key={value}
            type="button"
            className={`rating-star ${selected ? 'selected' : ''}`}
            onClick={(event) => { event.stopPropagation(); onRate(value) }}
            aria-label={`Rate ${value} out of 5 stars${rating === value ? ', clear rating' : ''}`}
            aria-pressed={rating === value}
            title={rating === value ? 'Click to clear rating' : `${value} out of 5 stars`}
          >
            <Star size={compact ? 14 : 20} fill={selected ? 'currentColor' : 'none'} />
          </button>
        )
      })}
    </div>
  )
}

function AddRecipeModal({ user, recipe, categoryOptions, onClose, onSaved }: {
  user: User
  recipe?: Recipe
  categoryOptions: string[]
  onClose: () => void
  onSaved: (message?: string) => void
}) {
  const [sourceType, setSourceType] = useState<'link' | 'photo'>('link')
  const [visibility, setVisibility] = useState<RecipeVisibility>(recipe?.visibility ?? 'private')
  const [url, setUrl] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [recipePhotoFile, setRecipePhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(recipe?.imageUrl ?? null)
  const [draft, setDraft] = useState<RecipeDraft>(() => recipe ? {
    title: recipe.title,
    description: recipe.description,
    ingredients: recipe.ingredients.join('\n'),
    steps: recipe.steps.join('\n'),
    category: recipe.category,
    tags: (recipe.tags ?? []).join(', '),
    recommended_from: recipe.recommended_from ?? '',
    prep_time_minutes: recipe.prep_time_minutes?.toString() ?? '',
    cook_time_minutes: recipe.cook_time_minutes?.toString() ?? '',
    servings: recipe.servings?.toString() ?? '',
  } : emptyDraft())
  const [isCreatingCategory, setIsCreatingCategory] = useState(Boolean(recipe && !categoryOptions.includes(recipe.category)))
  const [extracted, setExtracted] = useState(Boolean(recipe))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!recipePhotoFile) {
      setPhotoPreview(recipe?.imageUrl ?? null)
      return
    }
    const previewUrl = URL.createObjectURL(recipePhotoFile)
    setPhotoPreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [recipePhotoFile, recipe?.imageUrl])

  function update(field: keyof RecipeDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function importRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    try {
      let body: { url: string } | { imageDataUrls: string[] }
      if (sourceType === 'link') {
        body = { url: url.trim() }
      } else {
        if (!imageFiles.length) throw new Error('Choose at least one recipe page photo.')
        if (imageFiles.length > 4) throw new Error('Choose up to 4 recipe page photos at a time.')
        if (imageFiles.some((file) => file.size > 8 * 1024 * 1024)) throw new Error('Each photo must be smaller than 8 MB.')
        if (imageFiles.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) throw new Error('Choose photos with a combined size under 20 MB.')
        const imageDataUrls = await Promise.all(imageFiles.map(compressImageForExtraction))
        if (imageDataUrls.reduce((total, image) => total + image.length, 0) > 5_500_000) {
          throw new Error('The compressed photos are too large to send together. Try fewer or smaller pages.')
        }
        body = { imageDataUrls }
      }
      const { data, error: invokeError } = await supabase.functions.invoke('extract-recipe', { body })
      if (invokeError) throw new Error(await functionErrorMessage(invokeError))
      if (data?.error) throw new Error(data.error)
      const recipe = data?.recipe as ExtractedRecipe | undefined
      if (!recipe) throw new Error('No recipe was returned. Please try another source.')
      const extractedCategory = recipe.category || 'Other'
      setIsCreatingCategory(!categoryOptions.includes(extractedCategory))
      setDraft({
        title: recipe.title ?? '',
        description: recipe.description ?? '',
        ingredients: (recipe.ingredients ?? []).join('\n'),
        steps: (recipe.steps ?? []).join('\n'),
        category: extractedCategory,
        tags: '',
        recommended_from: '',
        prep_time_minutes: recipe.prep_time_minutes?.toString() ?? '',
        cook_time_minutes: recipe.cook_time_minutes?.toString() ?? '',
        servings: recipe.servings?.toString() ?? '',
      })
      setExtracted(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recipe import failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    let uploadedImagePath: string | null = null
    try {
      if (recipePhotoFile) {
        if (recipePhotoFile.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.')
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(recipePhotoFile.type)) {
          throw new Error('Choose a JPG, PNG, WEBP, or GIF image.')
        }
        const extension = recipePhotoFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        uploadedImagePath = `${user.id}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage
          .from('recipe-images')
          .upload(uploadedImagePath, recipePhotoFile, { contentType: recipePhotoFile.type, upsert: false })
        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`)
      }
      const recipeFields = {
        title: draft.title.trim(),
        visibility,
        description: draft.description.trim(),
        ingredients: draft.ingredients.split('\n').map((line) => line.trim()).filter(Boolean),
        steps: draft.steps.split('\n').map((line) => line.trim()).filter(Boolean),
        category: draft.category.trim() || 'Other',
        tags: parseTags(draft.tags),
        recommended_from: draft.recommended_from.trim() || null,
        prep_time_minutes: draft.prep_time_minutes ? Number(draft.prep_time_minutes) : null,
        cook_time_minutes: draft.cook_time_minutes ? Number(draft.cook_time_minutes) : null,
        servings: draft.servings ? Number(draft.servings) : null,
      }
      const { data: savedRecipe, error: insertError } = recipe
        ? await supabase.from('recipes').update({
          ...recipeFields,
          ...(uploadedImagePath ? { image_path: uploadedImagePath } : {}),
        }).eq('id', recipe.id).eq('user_id', user.id).select('id').single()
        : await supabase.from('recipes').insert({
          ...recipeFields,
          user_id: user.id,
          source_url: sourceType === 'link' ? url.trim() : null,
          image_path: uploadedImagePath,
        }).select('id').single()
      if (insertError) {
        if (uploadedImagePath) {
          const { error: cleanupError } = await supabase.storage.from('recipe-images').remove([uploadedImagePath])
          if (cleanupError) throw new Error(`Recipe save failed: ${insertError.message}. Uploaded image cleanup also failed: ${cleanupError.message}`)
        }
        throw new Error(`Recipe save failed: ${insertError.message}`)
      }
      if (!recipe && sourceType === 'photo' && imageFiles.length > 0) {
        if (!savedRecipe || typeof savedRecipe.id !== 'string') throw new Error('Recipe saved, but its original photo pages could not be linked to the recipe.')
        const savedId = savedRecipe.id
        const sourceRows: { recipe_id: string; user_id: string; image_path: string; position: number }[] = []
        const uploadedSourcePaths: string[] = []
        try {
          for (const [position, file] of imageFiles.entries()) {
            const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
            const path = `${user.id}/${crypto.randomUUID()}.${extension}`
            const { error: sourceUploadError } = await supabase.storage
              .from('recipe-source-images')
              .upload(path, file, { contentType: file.type, upsert: false })
            if (sourceUploadError) throw new Error(sourceUploadError.message)
            uploadedSourcePaths.push(path)
            sourceRows.push({ recipe_id: savedId, user_id: user.id, image_path: path, position })
          }
          const { error: sourceInsertError } = await supabase.from('recipe_source_images').insert(sourceRows)
          if (sourceInsertError) throw new Error(sourceInsertError.message)
        } catch (cause) {
          const cleanup = uploadedSourcePaths.length
            ? await supabase.storage.from('recipe-source-images').remove(uploadedSourcePaths)
            : { error: null }
          const { error: rollbackError } = await supabase.from('recipes').delete().eq('id', savedId).eq('user_id', user.id)
          let heroCleanupError: string | null = null
          if (uploadedImagePath) {
            const { error: removeHeroError } = await supabase.storage.from('recipe-images').remove([uploadedImagePath])
            if (removeHeroError) heroCleanupError = removeHeroError.message
          }
          const detail = cause instanceof Error ? cause.message : 'Unknown error'
          const cleanupErrors = [
            cleanup.error ? `Source-page cleanup also failed: ${cleanup.error.message}` : '',
            rollbackError ? `The recipe could not be rolled back: ${rollbackError.message}` : '',
            heroCleanupError ? `Cover-photo cleanup also failed: ${heroCleanupError}` : '',
          ].filter(Boolean)
          throw new Error(`Could not save the original photo pages: ${detail}${cleanupErrors.length ? ` ${cleanupErrors.join(' ')}` : ''}`)
        }
      }
      let notice: string | undefined
      if (uploadedImagePath && recipe?.image_path) {
        const { error: removeError } = await supabase.storage.from('recipe-images').remove([recipe.image_path])
        if (removeError) notice = `Recipe saved, but its previous photo could not be removed: ${removeError.message}`
      }
      onSaved(notice)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recipe could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 4) {
      setError('Choose up to 4 recipe page photos.')
      event.target.value = ''
      return
    }
    if (files.some((file) => file.size > 8 * 1024 * 1024)) {
      setError('Each photo must be smaller than 8 MB.')
      event.target.value = ''
      return
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
      setError('Choose JPG, PNG, WEBP, or GIF photos.')
      event.target.value = ''
      return
    }
    setImageFiles(files)
    setRecipePhotoFile(files[0] ?? null)
    if (files.length) setError('')
  }

  function chooseRecipePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError('Choose an image smaller than 8 MB.')
      event.target.value = ''
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choose a JPG, PNG, WEBP, or GIF image.')
      event.target.value = ''
      return
    }
    setRecipePhotoFile(file)
    setError('')
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`recipe-modal ${extracted ? 'review-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="add-title">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        {!extracted && !recipe ? (
          <>
            <span className="eyebrow">SAVE SOMETHING DELICIOUS</span>
            <h2 id="add-title">Bring a recipe in.</h2>
            <p className="modal-lede">Share a recipe link or a photo. We’ll gather the details for you.</p>
            <div className="source-tabs" role="tablist" aria-label="Recipe source">
              <button className={sourceType === 'link' ? 'selected' : ''} onClick={() => setSourceType('link')} type="button"><BookOpen size={16} /> Recipe link</button>
              <button className={sourceType === 'photo' ? 'selected' : ''} onClick={() => setSourceType('photo')} type="button"><ImagePlus size={16} /> Photo</button>
            </div>
            <form onSubmit={(event) => void importRecipe(event)}>
              {sourceType === 'link' ? (
                <label className="field-label">Recipe page URL<input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" autoFocus /></label>
              ) : (
                <label className="upload-box">
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={choosePhoto} />
                  <span className="upload-icon"><ImagePlus size={20} /></span>
                  <strong>{imageFiles.length ? `${imageFiles.length} recipe page${imageFiles.length === 1 ? '' : 's'} selected` : 'Choose recipe page photos'}</strong>
                  <span>{imageFiles.length ? `${(imageFiles.reduce((total, file) => total + file.size, 0) / 1024 / 1024).toFixed(1)} MB total · Up to 4 pages` : 'JPG, PNG, WEBP or GIF · Up to 4 pages, 8 MB each'}</span>
                </label>
              )}
              {error && <div className="form-message" role="alert">{error}</div>}
              <div className="privacy-note"><Sparkles size={15} /> Ingredients and steps are extracted with AI. You can review everything before saving.</div>
              <button className="primary-button modal-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={16} />}{busy ? 'Reading recipe…' : 'Find the recipe details'}<ArrowRight size={16} /></button>
            </form>
          </>
        ) : (
          <>
            {!recipe && <button className="back-link" onClick={() => { setExtracted(false); setError('') }} type="button"><ArrowLeft size={15} /> Back to source</button>}
            <span className="eyebrow">{recipe ? 'YOUR RECIPE, YOUR WAY' : 'LOOKS GOOD? MAKE IT YOURS'}</span>
            <h2 id="add-title">{recipe ? 'Edit your recipe.' : 'Review your recipe.'}</h2>
            <p className="modal-lede">{recipe ? 'Update the details and save your changes.' : 'We’ve gathered what we could. Edit anything before adding it to your cookbook.'}</p>
            <form className="recipe-edit-form" onSubmit={(event) => void saveRecipe(event)}>
              <label className="field-label">Recipe name<input required maxLength={160} value={draft.title} onChange={(event) => update('title', event.target.value)} /></label>
              <label className="field-label">Who can see this recipe
                <select value={visibility} onChange={(event) => {
                  if (event.target.value === 'private' || event.target.value === 'friends' || event.target.value === 'public') {
                    setVisibility(event.target.value)
                  }
                }}>
                  <option value="private">Private — only me</option>
                  <option value="friends">Friends — accepted friends</option>
                  <option value="public">Public — anyone</option>
                </select>
              </label>
              <p className="visibility-note">Imported recipes start private. You can change visibility any time.</p>
              <label className="field-label">Recipe picture
                <span className="recipe-photo-picker">
                  {photoPreview && <img src={photoPreview} alt="Recipe photo preview" />}
                  <span>{recipePhotoFile?.name ?? (recipe?.image_path ? 'Current photo will be kept' : 'No photo selected')}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={chooseRecipePhoto} />
                </span>
                <span className="photo-hint">JPG, PNG, WEBP, or GIF · Up to 8 MB</span>
              </label>
              <label className="field-label">A little note<textarea rows={2} maxLength={1000} value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="What makes this one special?" /></label>
              <div className="field-row">
                <div className="category-field">
                  <label className="field-label">Category
                    <select
                      value={isCreatingCategory ? createCategoryOption : draft.category}
                      onChange={(event) => {
                        const value = event.target.value
                        const creating = value === createCategoryOption
                        setIsCreatingCategory(creating)
                        if (!creating) update('category', value)
                        else update('category', '')
                      }}
                    >
                      {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                      <option value={createCategoryOption}>Create new category…</option>
                    </select>
                  </label>
                  {isCreatingCategory && <label className="field-label">New category<input required maxLength={60} value={draft.category} onChange={(event) => update('category', event.target.value)} placeholder="e.g. Weeknight" autoFocus /></label>}
                </div>
                <label className="field-label">Servings<input type="number" min="1" value={draft.servings} onChange={(event) => update('servings', event.target.value)} placeholder="4" /></label>
              </div>
              <label className="field-label">Tags <span className="label-hint">separate with commas</span><input maxLength={300} value={draft.tags} onChange={(event) => update('tags', event.target.value)} placeholder="quick, vegetarian, meal prep" /></label>
              <label className="field-label">Recommended from<input maxLength={160} value={draft.recommended_from} onChange={(event) => update('recommended_from', event.target.value)} placeholder="A friend, cookbook, or website" /></label>
              <div className="field-row">
                <label className="field-label">Prep · minutes<input type="number" min="0" value={draft.prep_time_minutes} onChange={(event) => update('prep_time_minutes', event.target.value)} placeholder="15" /></label>
                <label className="field-label">Cook · minutes<input type="number" min="0" value={draft.cook_time_minutes} onChange={(event) => update('cook_time_minutes', event.target.value)} placeholder="30" /></label>
              </div>
              <label className="field-label">Ingredients <span className="label-hint">one per line</span><textarea required rows={5} value={draft.ingredients} onChange={(event) => update('ingredients', event.target.value)} placeholder={'2 cups flour\n1 tsp sea salt'} /></label>
              <label className="field-label">Method <span className="label-hint">one step per line</span><textarea required rows={5} value={draft.steps} onChange={(event) => update('steps', event.target.value)} placeholder={'Preheat the oven…\nWhisk together…'} /></label>
              {error && <div className="form-message" role="alert">{error}</div>}
              <div className="review-actions">
                <span className="privacy-note"><Check size={15} /> {visibility === 'private' ? 'Only you can see this recipe.' : visibility === 'friends' ? 'Only accepted friends can see this recipe.' : 'Anyone can find this recipe in Discover.'}</span>
                <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{busy ? 'Saving…' : recipe ? 'Save changes' : 'Add to my cookbook'}<ArrowRight size={16} /></button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function RecipeComments({ recipe, userId, canModerate }: { recipe: Recipe; userId: string; canModerate: boolean }) {
  const [comments, setComments] = useState<RecipeComment[]>([])
  const [body, setBody] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadComments = useCallback(async () => {
    if (!supabase) return
    const client = supabase
    const { data, error: queryError } = await client
      .from('recipe_comments')
      .select('id, recipe_id, user_id, body, image_path, created_at')
      .eq('recipe_id', recipe.id)
      .order('created_at', { ascending: true })
    if (queryError) {
      setError(`Could not load comments: ${queryError.message}`)
      return
    }
    const rows = data ?? []
    const ids = [...new Set(rows.map((item) => item.user_id))]
    const { data: profiles, error: profileError } = ids.length
      ? await client.from('cookbook_profiles').select('user_id, username').in('user_id', ids)
      : { data: [], error: null }
    if (profileError) {
      setError(`Could not load comment authors: ${profileError.message}`)
      return
    }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const nextComments = await Promise.all(rows.map(async (item) => {
      let imageUrl: string | null = null
      if (item.image_path) {
        const { data: image, error: imageError } = await client.storage.from('comment-images').createSignedUrl(item.image_path, 3600)
        if (imageError) {
          setError(`Could not load a comment photo: ${imageError.message}`)
        } else {
          imageUrl = image.signedUrl
        }
      }
      return {
        ...item,
        author: names.get(item.user_id) || 'Cook',
        imageUrl,
      }
    }))
    setComments(nextComments)
  }, [recipe.id])

  useEffect(() => { void loadComments() }, [loadComments])

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    let imagePath: string | null = null
    try {
      if (imageFile) {
        if (imageFile.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.')
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type)) throw new Error('Choose a JPG, PNG, or WEBP image.')
        const extension = imageFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        imagePath = `${userId}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage.from('comment-images').upload(imagePath, imageFile, { contentType: imageFile.type, upsert: false })
        if (uploadError) throw new Error(`Could not upload comment photo: ${uploadError.message}`)
      }
      const { error: insertError } = await supabase.from('recipe_comments').insert({
        recipe_id: recipe.id,
        user_id: userId,
        body: body.trim(),
        image_path: imagePath,
      })
      if (insertError) throw new Error(`Could not post comment: ${insertError.message}`)
      setBody('')
      setImageFile(null)
      await loadComments()
    } catch (cause) {
      let message = cause instanceof Error ? cause.message : 'Could not post comment.'
      if (imagePath && supabase) {
        const { error: cleanupError } = await supabase.storage.from('comment-images').remove([imagePath])
        if (cleanupError) message += ` The uploaded image could not be cleaned up: ${cleanupError.message}`
      }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function saveComment(comment: RecipeComment) {
    if (!supabase) return
    const text = editingBody.trim()
    if (!text) {
      setError('A comment cannot be empty.')
      return
    }
    const { error: updateError } = await supabase.from('recipe_comments').update({ body: text, updated_at: new Date().toISOString() }).eq('id', comment.id)
    if (updateError) {
      setError(`Could not update comment: ${updateError.message}`)
      return
    }
    setEditingId(null)
    setEditingBody('')
    await loadComments()
  }

  async function deleteComment(comment: RecipeComment) {
    if (!supabase) return
    if (comment.image_path) {
      const { error: imageError } = await supabase.storage.from('comment-images').remove([comment.image_path])
      if (imageError) {
        setError(`Could not delete the comment photo: ${imageError.message}`)
        return
      }
    }
    const { error: deleteError } = await supabase.from('recipe_comments').delete().eq('id', comment.id)
    if (deleteError) {
      setError(`Could not delete comment: ${deleteError.message}`)
      return
    }
    setComments((current) => current.filter((item) => item.id !== comment.id))
  }

  return (
    <section className="recipe-comments">
      <h3>Cook’s notes <span>{comments.length}</span></h3>
      {error && <div className="form-message" role="alert">{error}</div>}
      {comments.length > 0 ? <div className="comment-list">{comments.map((comment) => (
        <article className="comment-item" key={comment.id}>
          <div className="comment-heading"><strong>@{comment.author}</strong><time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleDateString()}</time></div>
          {editingId === comment.id
            ? <div className="comment-edit"><textarea value={editingBody} onChange={(event) => setEditingBody(event.target.value)} maxLength={2000} /><button type="button" className="secondary-button" onClick={() => void saveComment(comment)}>Save</button><button type="button" className="text-button" onClick={() => setEditingId(null)}>Cancel</button></div>
            : <p>{comment.body}</p>}
          {comment.imageUrl && <img className="comment-image" src={comment.imageUrl} alt="Photo attached to comment" />}
          <div className="comment-actions">
            {comment.user_id === userId && editingId !== comment.id && <button type="button" className="text-button" onClick={() => { setEditingId(comment.id); setEditingBody(comment.body) }}>Edit</button>}
            {(comment.user_id === userId || canModerate) && <button type="button" className="text-button danger-text" onClick={() => void deleteComment(comment)}>Delete</button>}
          </div>
        </article>
      ))}</div> : <p className="comments-empty">No notes yet. Share how it turned out.</p>}
      <form className="comment-form" onSubmit={(event) => void addComment(event)}>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Leave a note about this recipe…" maxLength={2000} required aria-label="Comment" />
        <div className="comment-form-actions"><label className="secondary-button comment-photo"><ImagePlus size={14} />{imageFile ? imageFile.name : 'Add a photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /></label><button className="primary-button" disabled={busy || !body.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : null}Post note</button></div>
      </form>
    </section>
  )
}

function RecipeDetail({ recipe, ownerId, canEdit, onClose, onRate, onEdit, onTagClick }: {
  recipe: Recipe
  ownerId: string
  canEdit: boolean
  onClose: () => void
  onRate: (rating: number) => void
  onEdit: () => void
  onTagClick: (tag: string) => void
}) {
  const [language, setLanguage] = useState<'original' | 'en' | 'de' | 'es'>('original')
  const [translations, setTranslations] = useState<Partial<Record<'en' | 'de' | 'es', RecipeTranslation>>>({})
  const [translationLoading, setTranslationLoading] = useState(false)
  const [translationError, setTranslationError] = useState('')
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'de' | 'es'>('en')
  const [sourceImages, setSourceImages] = useState<RecipeSourceImage[]>([])
  const [sourceImageError, setSourceImageError] = useState('')
  const visibility = recipe.visibility ?? 'private'
  const displayRecipe = language === 'original' ? recipe : translations[language] ?? recipe

  useEffect(() => {
    let current = true
    const client = supabase
    async function loadRecipeExtras() {
      if (!client) return
      const [{ data: pages, error: pagesError }, { data: savedTranslations, error: translationsError }, { data: preferences, error: preferenceError }] = await Promise.all([
        client.from('recipe_source_images').select('id, image_path').eq('recipe_id', recipe.id).order('position'),
        client.from('recipe_translations').select('language, translation').eq('recipe_id', recipe.id).eq('user_id', ownerId),
        client.from('cookbook_preferences').select('preferred_language').eq('user_id', ownerId).maybeSingle(),
      ])
      if (!current) return
      if (pagesError) setSourceImageError(`Could not load original recipe photos: ${pagesError.message}`)
      else {
        const signedPages = await Promise.all((pages ?? []).map(async (page) => {
          const { data, error } = await client.storage.from('recipe-source-images').createSignedUrl(page.image_path, 3600)
          if (error) {
            setSourceImageError(`Could not load an original recipe photo: ${error.message}`)
            return null
          }
          return { id: page.id, imageUrl: data.signedUrl }
        }))
        if (current) setSourceImages(signedPages.filter((page): page is RecipeSourceImage => page !== null))
      }
      if (translationsError) {
        setTranslationError(`Could not load saved translations: ${translationsError.message}`)
      } else {
        const restored: Partial<Record<'en' | 'de' | 'es', RecipeTranslation>> = {}
        for (const entry of savedTranslations ?? []) {
          const entryLanguage: unknown = entry.language
          const entryTranslation: unknown = entry.translation
          if ((entryLanguage === 'en' || entryLanguage === 'de' || entryLanguage === 'es') && isRecipeTranslation(entryTranslation)) {
            restored[entryLanguage] = entryTranslation
          }
        }
        if (current) setTranslations(restored)
      }
      if (preferenceError) {
        setTranslationError(`Could not load your language preference: ${preferenceError.message}`)
      } else if (preferences?.preferred_language === 'en' || preferences?.preferred_language === 'de' || preferences?.preferred_language === 'es') {
        setPreferredLanguage(preferences.preferred_language)
      }
    }
    void loadRecipeExtras()
    return () => { current = false }
  }, [ownerId, recipe.id])

  async function changeLanguage(nextLanguage: 'original' | 'en' | 'de' | 'es') {
    setLanguage(nextLanguage)
    setTranslationError('')
    if (nextLanguage === 'original' || translations[nextLanguage]) return
    if (!supabase) {
      setTranslationError('Translation is unavailable because Supabase is not configured.')
      return
    }
    setTranslationLoading(true)
    const { data: saved, error: savedError } = await supabase
      .from('recipe_translations')
      .select('translation')
      .eq('recipe_id', recipe.id)
      .eq('user_id', ownerId)
      .eq('language', nextLanguage)
      .maybeSingle()
    if (savedError) {
      setLanguage('original')
      setTranslationLoading(false)
      setTranslationError(`Could not load the saved translation: ${savedError.message}`)
      return
    }
    if (saved && isRecipeTranslation(saved.translation)) {
      setTranslations((current) => ({ ...current, [nextLanguage]: saved.translation }))
      setTranslationLoading(false)
      return
    }
    const { data, error } = await supabase.functions.invoke('extract-recipe', {
      body: {
        action: 'translate',
        language: nextLanguage,
        recipe: {
          title: recipe.title,
          description: recipe.description,
          category: recipe.category,
          ingredients: recipe.ingredients,
          steps: recipe.steps,
        },
      },
    })
    setTranslationLoading(false)
    if (error) {
      setLanguage('original')
      const message = await functionErrorMessage(error)
      setTranslationError(`Could not translate this recipe: ${message}`)
      return
    }
    const translation: unknown = data?.translation
    if (!isRecipeTranslation(translation)) {
      setLanguage('original')
      setTranslationError('Could not translate this recipe: the translation response was incomplete.')
      return
    }
    setTranslations((current) => ({ ...current, [nextLanguage]: translation }))
    const { error: saveError } = await supabase.from('recipe_translations').upsert({
      recipe_id: recipe.id,
      user_id: ownerId,
      language: nextLanguage,
      translation,
    }, { onConflict: 'recipe_id,user_id,language' })
    if (saveError) setTranslationError(`Translated successfully, but could not save this translation: ${saveError.message}`)
  }

  return (
    <div className="modal-backdrop detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <article className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className={`detail-cover ${!recipe.imageUrl ? 'detail-art' : ''}`}>
          {recipe.imageUrl ? <img src={recipe.imageUrl} alt="" /> : <div className="detail-cover-placeholder"><Coffee size={46} strokeWidth={1} /><span>MADE WITH A LITTLE LOVE</span></div>}
          <span className="card-category">{displayRecipe.category}</span>
        </div>
        <div className="detail-content">
          <div className="detail-title-row"><div><span className="eyebrow">{canEdit ? 'YOUR RECIPE' : 'COMMUNITY RECIPE'} · {visibility.toUpperCase()}</span><h2 id="detail-title">{displayRecipe.title}</h2>
            {recipe.authorUsername && <span className="detail-author">by @{recipe.authorUsername}</span>}
            {recipe.averageRating !== undefined && recipe.averageRating !== null && <span className="detail-rating-summary">{recipe.averageRating.toFixed(1)} average · {recipe.ratingCount ?? 0} {(recipe.ratingCount ?? 0) === 1 ? 'rating' : 'ratings'}</span>}
          </div></div>
          {canEdit ? <RatingStars rating={recipe.rating} onRate={onRate} /> : <RatingStars rating={recipe.rating} onRate={onRate} />}
          {canEdit && <ShareRecipeButton recipe={recipe} ownerId={ownerId} />}
          <label className="language-picker">Recipe language
            <select
              value={language}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'original' || value === 'en' || value === 'de' || value === 'es') void changeLanguage(value)
              }}
              disabled={translationLoading}
            >
              <option value="original">Original language</option>
              <option value="en">English</option>
              <option value="de">German</option>
              <option value="es">Spanish</option>
            </select>
            {translationLoading && <span className="language-status" role="status"><LoaderCircle size={13} className="spin" /> Translating…</span>}
          </label>
          {language === 'original' && <button className="secondary-button preferred-translate" type="button" disabled={translationLoading} onClick={() => void changeLanguage(preferredLanguage)}>Translate to my preferred language</button>}
          {translationError && <div className="form-message" role="alert">{translationError}</div>}
          {displayRecipe.description && <p className="detail-description">{displayRecipe.description}</p>}
          <div className="detail-facts"><span><Clock3 size={16} /> {minutesLabel(recipe.prep_time_minutes, recipe.cook_time_minutes)}</span>{recipe.servings ? <span><Utensils size={16} /> Serves {recipe.servings}</span> : null}</div>
          {recipe.recommended_from && <p className="detail-recommendation"><strong>Recommended from:</strong> {recipe.recommended_from}</p>}
          {(recipe.tags ?? []).length > 0 && <div className="detail-tags" aria-label="Recipe tags">{recipe.tags.map((tag) => <button className="tag-chip" key={tag} onClick={() => onTagClick(tag)}>{tag}</button>)}</div>}
          {sourceImageError && <div className="form-message" role="alert">{sourceImageError}</div>}
          {sourceImages.length > 0 && <section className="source-pages"><h3>Original recipe pages</h3><div>{sourceImages.map((page, index) => <a key={page.id} href={page.imageUrl} target="_blank" rel="noreferrer"><img src={page.imageUrl} alt={`Original recipe page ${index + 1}`} /><span>Page {index + 1}</span></a>)}</div></section>}
          <div className="detail-columns">
            <section><h3>Ingredients <span>{displayRecipe.ingredients.length}</span></h3><ul className="ingredient-list">{displayRecipe.ingredients.map((item, index) => <li key={`${index}-${item}`}><span className="check-circle"><Check size={11} /></span>{item}</li>)}</ul></section>
            <section><h3>Method</h3><ol className="step-list">{displayRecipe.steps.map((step, index) => <li key={`${index}-${step}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol></section>
          </div>
          {canEdit && <button className="primary-button" onClick={onEdit}><Pencil size={15} /> Edit recipe</button>}
          {recipe.source_url && <a className="source-link" href={recipe.source_url} target="_blank" rel="noreferrer">Visit original recipe <ArrowRight size={14} /></a>}
          <RecipeComments recipe={recipe} userId={ownerId} canModerate={canEdit} />
        </div>
      </article>
    </div>
  )
}

function ShareRecipeButton({ recipe, ownerId }: { recipe: Recipe; ownerId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadOrCreateShareLink(create: boolean) {
    if (!supabase) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data: existing, error: lookupError } = await supabase
      .from('recipe_shares')
      .select('token')
      .eq('recipe_id', recipe.id)
      .maybeSingle()
    if (lookupError) {
      setError(`Could not check sharing status: ${lookupError.message}`)
      setBusy(false)
      return
    }
    if (existing) {
      setShareUrl(new URL(`/shared/${existing.token}`, window.location.origin).toString())
      setBusy(false)
      return
    }
    if (!create) {
      setBusy(false)
      return
    }
    const { data, error: createError } = await supabase
      .from('recipe_shares')
      .insert({ recipe_id: recipe.id, owner_id: ownerId })
      .select('token')
      .single()
    if (createError) {
      setError(`Could not create a sharing link: ${createError.message}`)
    } else {
      setShareUrl(new URL(`/shared/${data.token}`, window.location.origin).toString())
      setNotice('Anyone with this link can view the recipe.')
    }
    setBusy(false)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setNotice('Link copied. Anyone with the link can view this recipe.')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? `Could not copy the link: ${cause.message}` : 'Could not copy the link.')
    }
  }

  async function revokeLink() {
    if (!supabase) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('recipe_shares').delete().eq('recipe_id', recipe.id)
    if (deleteError) {
      setError(`Could not revoke the sharing link: ${deleteError.message}`)
    } else {
      setShareUrl('')
      setNotice('Sharing link revoked.')
      setError('')
    }
    setBusy(false)
  }

  return (
    <section className="share-recipe">
      <button className="secondary-button" type="button" onClick={() => {
        const nextOpen = !isOpen
        setIsOpen(nextOpen)
        if (nextOpen) void loadOrCreateShareLink(false)
      }}>
        <Share2 size={15} /> Share recipe
      </button>
      {isOpen && (
        <div className="share-panel">
          <p>Recipes are private unless you share a link. Anyone with the link can view this recipe.</p>
          {shareUrl
            ? <label className="field-label">Share link<input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /></label>
            : <button className="primary-button" type="button" disabled={busy} onClick={() => void loadOrCreateShareLink(true)}>{busy ? 'Checking…' : 'Create share link'}</button>}
          {shareUrl && <div className="share-actions">
            <button className="primary-button" type="button" onClick={() => void copyLink()}>Copy link</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void revokeLink()}>Revoke link</button>
          </div>}
          {busy && <span className="language-status" role="status"><LoaderCircle size={13} className="spin" /> Working…</span>}
          {error && <div className="form-message" role="alert">{error}</div>}
          {notice && <div className="share-notice" role="status">{notice}</div>}
        </div>
      )}
    </section>
  )
}

function SharedRecipePage({ token }: { token: string }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isCurrent = true
    async function loadSharedRecipe() {
      if (!supabase) {
        setError('This shared recipe is unavailable because the app is not configured.')
        setLoading(false)
        return
      }
      const { data, error: invokeError } = await supabase.functions.invoke('share-recipe', { body: { token } })
      if (!isCurrent) return
      if (invokeError) {
        let message = invokeError.message
        if (invokeError.context instanceof Response) {
          try {
            const body: unknown = await invokeError.context.clone().json()
            if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
              message = body.error
            }
          } catch {
            message = `HTTP ${invokeError.context.status}: ${invokeError.message}`
          }
        }
        setError(message)
      } else {
        const shared = data?.recipe as Recipe | undefined
        if (!shared || typeof shared.title !== 'string' || !Array.isArray(shared.ingredients) || !Array.isArray(shared.steps)) {
          setError('This recipe sharing link is invalid or has been revoked.')
        } else {
          setRecipe(shared)
        }
      }
      setLoading(false)
    }
    void loadSharedRecipe()
    return () => { isCurrent = false }
  }, [token])

  return (
    <main className="shared-page">
      <a className="shared-brand" href="/"><ChefHat size={19} /> Cook &amp; Tell</a>
      {loading
        ? <div className="empty-state"><LoaderCircle className="spin" /><p>Loading shared recipe…</p></div>
        : error
          ? <div className="shared-error" role="alert"><h1>Recipe unavailable</h1><p>{error}</p><a href="/">Open Cook &amp; Tell</a></div>
          : recipe && <article className="detail-modal shared-recipe">
            <div className={`detail-cover ${!recipe.imageUrl ? 'detail-art' : ''}`}>
              {recipe.imageUrl ? <img src={recipe.imageUrl} alt="" /> : <div className="detail-cover-placeholder"><Coffee size={46} strokeWidth={1} /><span>MADE WITH A LITTLE LOVE</span></div>}
              <span className="card-category">{recipe.category}</span>
            </div>
            <div className="detail-content">
              <span className="eyebrow">SHARED WITH YOU</span>
              <h1 className="shared-title">{recipe.title}</h1>
              {recipe.rating && <div className="shared-rating" aria-label={`Rated ${recipe.rating} out of 5 stars`}>{'★'.repeat(recipe.rating)}{'☆'.repeat(5 - recipe.rating)}</div>}
              {recipe.description && <p className="detail-description">{recipe.description}</p>}
              <div className="detail-facts"><span><Clock3 size={16} /> {minutesLabel(recipe.prep_time_minutes, recipe.cook_time_minutes)}</span>{recipe.servings ? <span><Utensils size={16} /> Serves {recipe.servings}</span> : null}</div>
              {recipe.recommended_from && <p className="detail-recommendation"><strong>Recommended from:</strong> {recipe.recommended_from}</p>}
              {(recipe.tags ?? []).length > 0 && <div className="detail-tags">{recipe.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</div>}
              <div className="detail-columns">
                <section><h2>Ingredients <span>{recipe.ingredients.length}</span></h2><ul className="ingredient-list">{recipe.ingredients.map((item, index) => <li key={`${index}-${item}`}><span className="check-circle"><Check size={11} /></span>{item}</li>)}</ul></section>
                <section><h2>Method</h2><ol className="step-list">{recipe.steps.map((step, index) => <li key={`${index}-${step}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol></section>
              </div>
              {recipe.source_url && <a className="source-link" href={recipe.source_url} target="_blank" rel="noreferrer">Visit original recipe <ArrowRight size={14} /></a>}
              <p className="shared-footer">This is a read-only shared recipe. <a href="/">Open your cookbook</a></p>
            </div>
          </article>}
    </main>
  )
}

function FriendCookbookModal({ userId, initialEmail, onClose, onAdded, onFriendAdded, onFriendRequestReceived }: {
  userId: string
  initialEmail: string
  onClose: () => void
  onAdded: (title: string) => void
  onFriendAdded: (friend: CookbookFriend) => void
  onFriendRequestReceived: () => void
}) {
  const [identifier, setIdentifier] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [friendRequestStatus, setFriendRequestStatus] = useState<'none' | 'request_sent' | 'request_received' | 'accepted'>('none')
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [friendBusy, setFriendBusy] = useState(false)
  const [isFollowing, setIsFollowing] = useState(false)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadCookbook = useCallback(async (searchEmail: string) => {
    if (!supabase) return
    setBusy(true)
    setError('')
    setRecipes([])
    setOwnerEmail('')
    setOwnerId('')
    setIsFollowing(false)
    setFriendRequestStatus('none')
    setSearched(false)
    const identifier = searchEmail.trim().replace(/^@(?=[^@]*$)/, '')
    const { data, error: searchError } = await supabase.functions.invoke('friend-cookbook', {
      body: {
        action: 'search',
        identifier,
        ...(identifier.includes('@') ? { email: identifier } : {}),
      },
    })
    if (searchError) {
      const message = await functionErrorMessage(searchError)
      setError(message === 'Enter a valid email address.'
        ? 'The deployed friend search function is out of date. Deploy the updated friend-cookbook function from the latest code, then try again.'
        : message)
      setBusy(false)
      return
    }
    if (
      !data ||
      !Array.isArray(data.recipes) ||
      typeof data.email !== 'string' ||
      typeof data.friendId !== 'string' ||
      (data.relationshipStatus !== 'none' && data.relationshipStatus !== 'request_sent' && data.relationshipStatus !== 'request_received' && data.relationshipStatus !== 'accepted')
    ) {
      setError('The cookbook lookup returned an invalid response.')
      setBusy(false)
      return
    }
    setOwnerEmail(data.email)
    setOwnerId(data.friendId)
    if (data.friendId !== userId) {
      const { data: follow, error: followError } = await supabase
        .from('cookbook_follows')
        .select('followed_id')
        .eq('follower_id', userId)
        .eq('followed_id', data.friendId)
        .maybeSingle()
      if (followError) {
        setError(`Could not check follow status: ${followError.message}`)
        setBusy(false)
        return
      }
      setIsFollowing(Boolean(follow))
    }
    setRecipes(data.recipes as Recipe[])
    setFriendRequestStatus(data.relationshipStatus)
    setSearched(true)
    setBusy(false)
  }, [userId])

  useEffect(() => {
    if (initialEmail) {
      setIdentifier(initialEmail)
      void loadCookbook(initialEmail)
    }
  }, [initialEmail, loadCookbook])

  async function searchCookbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await loadCookbook(identifier.trim())
  }

  async function sendFriendRequest() {
    if (!supabase || !ownerEmail || friendBusy || friendRequestStatus === 'accepted') return
    setFriendBusy(true)
    setError('')
    const { data, error: requestError } = await supabase.functions.invoke('friend-cookbook', {
      body: { action: 'add_friend', email: ownerEmail },
    })
    setFriendBusy(false)
    if (requestError) {
      setError(await functionErrorMessage(requestError))
      return
    }
    const status = data?.status
    if (status !== 'request_sent' && status !== 'request_received' && status !== 'accepted') {
      setError('The friend request returned an invalid response.')
      return
    }
    setFriendRequestStatus(status)
    if (status === 'accepted') {
      const friend = data?.friend
      if (friend && typeof friend.id === 'string' && typeof friend.email === 'string') onFriendAdded(friend)
    } else if (status === 'request_received') {
      onFriendRequestReceived()
    }
  }

  async function toggleFollow() {
    if (!supabase || !ownerId || ownerId === userId || friendBusy) return
    setFriendBusy(true)
    setError('')
    const result = isFollowing
      ? await supabase.from('cookbook_follows').delete().eq('follower_id', userId).eq('followed_id', ownerId)
      : await supabase.from('cookbook_follows').insert({ follower_id: userId, followed_id: ownerId })
    setFriendBusy(false)
    if (result.error) {
      setError(`Could not ${isFollowing ? 'unfollow' : 'follow'} this cook: ${result.error.message}`)
      return
    }
    setIsFollowing(!isFollowing)
  }

  async function addRecipe(recipe: Recipe) {
    if (!supabase) return
    setCopyingId(recipe.id)
    setError('')
    const { data, error: copyError } = await supabase.functions.invoke('friend-cookbook', {
      body: { action: 'copy', email: ownerEmail, recipeId: recipe.id },
    })
    setCopyingId(null)
    if (copyError) {
      setError(await functionErrorMessage(copyError))
      return
    }
    const copiedTitle = data?.recipe?.title
    if (typeof copiedTitle !== 'string') {
      setError('The recipe was copied, but the response was incomplete. Refresh your cookbook to check.')
      return
    }
    setCopiedIds((current) => new Set(current).add(recipe.id))
    onAdded(copiedTitle)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !copyingId) onClose() }}>
      <section className="friend-modal" role="dialog" aria-modal="true" aria-labelledby="friend-title">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <span className="eyebrow">COOK TOGETHER</span>
        <h2 id="friend-title">Find a friend.</h2>
        <p className="modal-lede">Search by username or signup email to send a friend request. You can browse and copy their recipes after they accept.</p>
        <form className="friend-search" onSubmit={(event) => void searchCookbook(event)}>
          <label className="field-label">Friend’s username or email<input type="text" required autoComplete="off" autoCapitalize="none" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="@homecook42 or friend@example.com" /></label>
          <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}{busy ? 'Searching…' : 'Find friend'}</button>
        </form>
        {error && <div className="form-message" role="alert">{error}</div>}
        {searched && ownerId && <div className="friend-request-action">
          {ownerId !== userId && <button className="secondary-button" type="button" disabled={friendBusy} onClick={() => void toggleFollow()}>{friendBusy ? <LoaderCircle size={14} className="spin" /> : <Users size={14} />}{isFollowing ? 'Following' : 'Follow cook'}</button>}
          {friendRequestStatus === 'accepted'
            ? <span className="friend-status"><Check size={14} /> Friends</span>
            : friendRequestStatus === 'request_sent'
              ? <span className="friend-status">Friend request sent — waiting for confirmation</span>
              : friendRequestStatus === 'request_received'
                ? <span className="friend-status">They sent you a friend request. Accept it from the sidebar.</span>
                : <button className="secondary-button" type="button" disabled={friendBusy} onClick={() => void sendFriendRequest()}>
                  {friendBusy ? <LoaderCircle size={14} className="spin" /> : <Users size={14} />}
                  {friendBusy ? 'Sending…' : 'Add friend'}
                </button>}
        </div>}
        {searched && !error && recipes.length === 0 && friendRequestStatus === 'accepted' && <div className="friend-empty">This cookbook has no saved recipes yet.</div>}
        {searched && !error && recipes.length === 0 && friendRequestStatus !== 'accepted' && <div className="friend-empty">You can browse this cookbook after you become friends.</div>}
        {recipes.length > 0 && (
          <div className="friend-results">
            <div className="friend-results-heading">
              <strong>{ownerEmail}’s cookbook</strong>
              <span>{recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}</span>
            </div>
            {recipes.map((recipe) => (
              <article className="friend-recipe" key={recipe.id}>
                <button className="friend-recipe-summary" type="button" onClick={() => setExpandedId((current) => current === recipe.id ? null : recipe.id)}>
                  {recipe.imageUrl
                    ? <img src={recipe.imageUrl} alt="" />
                    : <span className="friend-recipe-placeholder"><Utensils size={20} /></span>}
                  <span className="friend-recipe-copy">
                    <strong>{recipe.title}</strong>
                    <span>{recipe.category} · {minutesLabel(recipe.prep_time_minutes, recipe.cook_time_minutes)}</span>
                    {recipe.rating && <span className="friend-rating" aria-label={`Rated ${recipe.rating} out of 5 stars`}>{'★'.repeat(recipe.rating)}{'☆'.repeat(5 - recipe.rating)}</span>}
                  </span>
                  <span className="friend-expand">{expandedId === recipe.id ? 'Hide' : 'View'}</span>
                </button>
                {expandedId === recipe.id && <div className="friend-recipe-detail">
                  {recipe.description && <p>{recipe.description}</p>}
                  {recipe.recommended_from && <p><strong>Recommended from:</strong> {recipe.recommended_from}</p>}
                  {(recipe.tags ?? []).length > 0 && <div className="recipe-tags">{recipe.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</div>}
                  <h3>Ingredients</h3>
                  <ul>{recipe.ingredients.map((ingredient, index) => <li key={`${index}-${ingredient}`}>{ingredient}</li>)}</ul>
                  <h3>Method</h3>
                  <ol>{recipe.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
                </div>}
                <button
                  className="secondary-button friend-copy-button"
                  type="button"
                  disabled={copyingId === recipe.id || copiedIds.has(recipe.id)}
                  onClick={() => void addRecipe(recipe)}
                >
                  {copyingId === recipe.id
                    ? <LoaderCircle size={14} className="spin" />
                    : copiedIds.has(recipe.id) ? <Check size={14} /> : <Plus size={14} />}
                  {copyingId === recipe.id ? 'Adding…' : copiedIds.has(recipe.id) ? 'Added to your cookbook' : 'Add to my cookbook'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SettingsModal({ user, avatarUrl, onAvatarChanged, onClose, onSignOut }: {
  user: User
  avatarUrl: string | null
  onAvatarChanged: (url: string | null) => void
  onClose: () => void
  onSignOut: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'de' | 'es'>('en')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!supabase) return
    void supabase.functions.invoke('friend-cookbook', { body: { action: 'get_username' } }).then(({ data, error: usernameError }) => {
      if (usernameError) {
        setError(`Could not load your username: ${usernameError.message}`)
      } else if (data && typeof data.username === 'string') {
        setUsername(data.username)
      }
    })
    void supabase.from('cookbook_preferences').select('preferred_language').eq('user_id', user.id).maybeSingle().then(({ data, error: preferenceError }) => {
      if (preferenceError) {
        setError((current) => [current, `Could not load your language preference: ${preferenceError.message}`].filter(Boolean).join(' '))
      } else if (data?.preferred_language === 'en' || data?.preferred_language === 'de' || data?.preferred_language === 'es') {
        setPreferredLanguage(data.preferred_language)
      }
    })
  }, [user.id])

  async function saveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: saveError } = await supabase.functions.invoke('friend-cookbook', {
      body: { action: 'set_username', username },
    })
    setBusy(false)
    if (saveError) {
      setError(await functionErrorMessage(saveError))
      return
    }
    if (!data || typeof data.username !== 'string') {
      setError('Your username could not be saved. Please try again.')
      return
    }
    setUsername(data.username)
    setNotice(`Your username is @${data.username}.`)
  }

  async function savePreferredLanguage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const { error: saveError } = await supabase.from('cookbook_preferences').upsert({
      user_id: user.id,
      preferred_language: preferredLanguage,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    setBusy(false)
    if (saveError) {
      setError(`Could not save your preferred language: ${saveError.message}`)
      return
    }
    setNotice('Your preferred language was saved. Recipe translations are kept for your account.')
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) {
      setError(`Could not update your password: ${updateError.message}`)
      return
    }
    setPassword('')
    setNotice('Your password was updated.')
  }

  async function changeProfilePicture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !supabase || busy) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WEBP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Choose an image smaller than 5 MB.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
    const newPath = `${user.id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('profile-images').upload(newPath, file, {
      contentType: file.type,
      upsert: false,
    })
    if (uploadError) {
      setBusy(false)
      setError(`Could not upload your profile picture: ${uploadError.message}`)
      return
    }
    const oldPath = user.user_metadata?.avatar_path
    const { error: metadataError } = await supabase.auth.updateUser({ data: { avatar_path: newPath } })
    if (metadataError) {
      const { error: cleanupError } = await supabase.storage.from('profile-images').remove([newPath])
      setBusy(false)
      setError(cleanupError
        ? `Could not save your profile picture: ${metadataError.message}. Uploaded file cleanup also failed: ${cleanupError.message}`
        : `Could not save your profile picture: ${metadataError.message}`)
      return
    }
    const { data: signedImage, error: signedUrlError } = await supabase.storage.from('profile-images').createSignedUrl(newPath, 3600)
    if (signedUrlError) {
      setBusy(false)
      setError(`Your picture was saved, but could not be displayed: ${signedUrlError.message}`)
      return
    }
    onAvatarChanged(signedImage.signedUrl)
    let cleanupWarning = ''
    if (typeof oldPath === 'string' && oldPath.startsWith(`${user.id}/`) && oldPath !== newPath) {
      const { error: cleanupError } = await supabase.storage.from('profile-images').remove([oldPath])
      if (cleanupError) cleanupWarning = ` The previous image could not be removed: ${cleanupError.message}`
    }
    setBusy(false)
    setNotice(`Your profile picture was updated.${cleanupWarning}`)
  }

  async function removeProfilePicture() {
    if (!supabase || busy) return
    const oldPath = user.user_metadata?.avatar_path
    if (typeof oldPath !== 'string' || !oldPath.startsWith(`${user.id}/`)) return
    setBusy(true)
    setError('')
    setNotice('')
    const { error: metadataError } = await supabase.auth.updateUser({ data: { avatar_path: null } })
    if (metadataError) {
      setBusy(false)
      setError(`Could not remove your profile picture: ${metadataError.message}`)
      return
    }
    onAvatarChanged(null)
    const { error: removeError } = await supabase.storage.from('profile-images').remove([oldPath])
    setBusy(false)
    if (removeError) {
      setError(`Your picture was removed from your profile, but its stored file could not be deleted: ${removeError.message}`)
      return
    }
    setNotice('Your profile picture was removed.')
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h2 id="settings-title">Settings</h2>
        <p className="modal-lede">{user.email}</p>
        {error && <div className="form-message" role="alert">{error}</div>}
        {notice && <div className="settings-notice" role="status">{notice}</div>}
        <section className="settings-section">
          <h3>Profile picture</h3>
          <div className="settings-picture-row">
            {avatarUrl
              ? <img className="settings-avatar" src={avatarUrl} alt="Your profile" />
              : <span className="settings-avatar settings-avatar-placeholder">{(user.email?.[0] ?? 'Y').toUpperCase()}</span>}
            <div className="settings-picture-actions">
              <label className="secondary-button" htmlFor="profile-picture"><Camera size={14} /> Choose picture</label>
              <input id="profile-picture" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void changeProfilePicture(event)} />
              {typeof user.user_metadata?.avatar_path === 'string' && <button className="text-button" type="button" disabled={busy} onClick={() => void removeProfilePicture()}>Remove picture</button>}
              <span className="settings-help">JPEG, PNG, or WEBP · up to 5 MB</span>
            </div>
          </div>
        </section>
        <form className="settings-section settings-form" onSubmit={(event) => void saveUsername(event)}>
          <h3>Username</h3>
          <p>Friends can find you by this unique username.</p>
          <label className="field-label">Your username<input type="text" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" autoComplete="off" autoCapitalize="none" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. homecook42" /></label>
          <button className="secondary-button" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : null}Save username</button>
        </form>
        <form className="settings-section settings-form" onSubmit={(event) => void savePreferredLanguage(event)}>
          <h3>Preferred language</h3>
          <p>Choose the language you most often want recipes translated into.</p>
          <label className="field-label">Language<select value={preferredLanguage} onChange={(event) => {
            const value = event.target.value
            if (value === 'en' || value === 'de' || value === 'es') setPreferredLanguage(value)
          }}><option value="en">English</option><option value="de">German</option><option value="es">Spanish</option></select></label>
          <button className="secondary-button" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : null}Save language</button>
        </form>
        <form className="settings-section settings-form" onSubmit={(event) => void changePassword(event)}>
          <h3>Password</h3>
          <label className="field-label">New password<input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>
          <button className="secondary-button" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : null}Update password</button>
        </form>
        <div className="settings-footer">
          <button className="secondary-button" type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
          {busy && <span className="settings-help">Saving…</span>}
        </div>
      </section>
    </div>
  )
}

export default App
