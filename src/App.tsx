import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChefHat,
  Clock3,
  Coffee,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Utensils,
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

const categories = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack']
const createCategoryOption = '__create_category__'

function parseTags(value: string): string[] {
  const seen = new Set<string>()
  return value.split(',').map((tag) => tag.trim()).filter((tag) => {
    const normalized = tag.toLocaleLowerCase()
    if (!tag || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

async function compressImageForExtraction(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
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
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The selected photo could not be compressed.')), 'image/jpeg', 0.78)
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
  const [recipesLoading, setRecipesLoading] = useState(false)
  const [activeCategory, setActiveCategory] = useState('All recipes')
  const [query, setQuery] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
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
    setActiveCategory('All recipes')
    setSelectedRecipe(null)
    if (user) {
      void loadRecipes()
    } else {
      setRecipesLoading(false)
    }
  }, [user])

  async function loadRecipes() {
    if (!supabase || !user) return
    const client = supabase
    setRecipesLoading(true)
    setLoadError('')
    const { data, error } = await client
      .from('recipes')
      .select('*')
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

  if (!isSupabaseConfigured) return <SetupScreen />
  if (sessionLoading) return <div className="screen-loader"><LoaderCircle className="spin" /> Loading your kitchen…</div>
  if (!user) return <AuthScreen />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="My personal Cookbook home">
          <span className="brand-mark"><ChefHat size={19} strokeWidth={1.8} /></span>
          <span>My personal Cookbook</span>
        </a>
        <div className="side-intro">
          <span className="eyebrow">YOUR PERSONAL COOKBOOK</span>
          <p>A little inspiration for whatever’s in the fridge.</p>
        </div>
        <nav className="side-nav" aria-label="Recipe categories">
          <span className="nav-label">LIBRARY</span>
          <button className={`nav-item ${activeCategory === 'All recipes' ? 'active' : ''}`} onClick={() => setActiveCategory('All recipes')}>
            <BookOpen size={17} /> <span>All recipes</span><span className="nav-count">{recipes.length}</span>
          </button>
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
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Sparkles size={15} />
            <p><strong>A good recipe is worth keeping.</strong><br />Save one you love today.</p>
          </div>
          <button className="account-button" onClick={() => void signOut()}>
            <span className="avatar">{(user.email?.[0] ?? 'Y').toUpperCase()}</span>
            <span className="account-email">{user.email}</span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>My cookbook</span><ArrowRight size={13} /><strong>{activeCategory}</strong></div>
          <div className="top-actions">
            <label className="search-box">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes…" aria-label="Search recipes" />
            </label>
            <button className="primary-button top-add" onClick={() => setIsAddOpen(true)}><Plus size={17} /> Add a recipe</button>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <span className="eyebrow">A COLLECTION MADE YOURS</span>
            <h1>{activeCategory === 'All recipes' ? 'The recipe box' : activeCategory}</h1>
            <p>{activeCategory === 'All recipes'
              ? 'The keepers, the weeknight wins, and the ones you can’t wait to make again.'
              : `A few good ideas for ${activeCategory.toLowerCase()}.`}
            </p>
          </div>
          <div className="recipe-total"><span>{recipes.length.toString().padStart(2, '0')}</span><small>RECIPES<br />COLLECTED</small></div>
        </section>

        {loadError && <div className="inline-alert" role="alert">{loadError}<button onClick={() => setLoadError('')} aria-label="Dismiss"><X size={15} /></button></div>}
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}

        <div className="collection-toolbar">
          <div className="collection-label"><span className="green-indicator" /> {query ? 'SEARCH RESULTS' : 'YOUR COLLECTION'} <span className="toolbar-count">{filteredRecipes.length}</span></div>
          <button className="sort-button" onClick={() => setIsAddOpen(true)}><ArrowDownToLine size={15} /> Import a recipe</button>
        </div>

        {recipesLoading ? (
          <div className="empty-state"><LoaderCircle className="spin" /><p>Gathering your recipes…</p></div>
        ) : filteredRecipes.length ? (
          <div className="recipe-grid">
            {filteredRecipes.map((recipe, index) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                index={index}
                onOpen={() => setSelectedRecipe(recipe)}
                onRate={(rating) => void setRecipeRating(recipe, recipe.rating === rating ? null : rating)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><Utensils size={24} /></div>
            <h2>{query ? 'Nothing in the pantry yet' : 'A fresh page'}</h2>
            <p>{query ? 'Try another search, or add a recipe to your collection.' : 'Save a recipe link or snap a photo to start your collection.'}</p>
            <button className="primary-button" onClick={() => setIsAddOpen(true)}><Plus size={16} /> Add your first recipe</button>
          </div>
        )}
        <footer className="page-footer"><span>Made for the love of good food.</span><span>My personal Cookbook</span></footer>
      </main>

      {isAddOpen && <AddRecipeModal user={user} categoryOptions={availableCategories} onClose={() => setIsAddOpen(false)} onSaved={(message) => { void loadRecipes(); if (message) setNotice(message) }} />}
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
          onClose={() => setSelectedRecipe(null)}
          onRate={(rating) => void setRecipeRating(selectedRecipe, selectedRecipe.rating === rating ? null : rating)}
          onTagClick={(tag) => {
            setActiveCategory('All recipes')
            setQuery(tag)
            setSelectedRecipe(null)
          }}
          onEdit={() => {
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
        <span className="brand"><span className="brand-mark"><ChefHat size={19} /></span><span>My personal Cookbook</span></span>
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
      ? await supabase.auth.signUp({ email, password })
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
        <a className="brand" href="#"><span className="brand-mark"><ChefHat size={19} /></span><span>My personal Cookbook</span></a>
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

function RecipeCard({ recipe, index, onOpen, onRate }: {
  recipe: Recipe
  index: number
  onOpen: () => void
  onRate: (rating: number) => void
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
      <button className="card-copy" onClick={onOpen}>
        <span className="card-title">{recipe.title}</span>
        <span className="card-description">{recipe.description || 'A new favorite for the table.'}</span>
        {(recipe.tags ?? []).length > 0 && <span className="recipe-tags">{recipe.tags.slice(0, 3).map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</span>}
        <span className="card-meta"><Clock3 size={14} /> {minutesLabel(recipe.prep_time_minutes, recipe.cook_time_minutes)}{recipe.servings ? <><span className="meta-divider">·</span>{recipe.servings} servings</> : null}</span>
      </button>
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
  const [url, setUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
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
      let body: { url: string } | { imageDataUrl: string }
      if (sourceType === 'link') {
        body = { url: url.trim() }
      } else {
        if (!imageFile) throw new Error('Choose a photo of a recipe first.')
        if (imageFile.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.')
        const dataUrl = await compressImageForExtraction(imageFile)
        body = { imageDataUrl: dataUrl }
      }
      const { data, error: invokeError } = await supabase.functions.invoke('extract-recipe', { body })
      if (invokeError) throw new Error(invokeError.message)
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
      const { error: insertError } = recipe
        ? await supabase.from('recipes').update({
          ...recipeFields,
          ...(uploadedImagePath ? { image_path: uploadedImagePath } : {}),
        }).eq('id', recipe.id).eq('user_id', user.id)
        : await supabase.from('recipes').insert({
          ...recipeFields,
          user_id: user.id,
          source_url: sourceType === 'link' ? url.trim() : null,
          image_path: uploadedImagePath,
        })
      if (insertError) {
        if (uploadedImagePath) {
          const { error: cleanupError } = await supabase.storage.from('recipe-images').remove([uploadedImagePath])
          if (cleanupError) throw new Error(`Recipe save failed: ${insertError.message}. Uploaded image cleanup also failed: ${cleanupError.message}`)
        }
        throw new Error(`Recipe save failed: ${insertError.message}`)
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
    const file = event.target.files?.[0] ?? null
    setImageFile(file)
    setRecipePhotoFile(file)
    if (file) setError('')
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
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={choosePhoto} />
                  <span className="upload-icon"><ImagePlus size={20} /></span>
                  <strong>{imageFile ? imageFile.name : 'Choose a recipe photo'}</strong>
                  <span>{imageFile ? `${(imageFile.size / 1024 / 1024).toFixed(1)} MB · Ready to read` : 'JPG, PNG, WEBP or GIF · Up to 8 MB'}</span>
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
                <span className="privacy-note"><Check size={15} /> Only you can see this recipe.</span>
                <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{busy ? 'Saving…' : recipe ? 'Save changes' : 'Add to my cookbook'}<ArrowRight size={16} /></button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function RecipeDetail({ recipe, onClose, onRate, onEdit, onTagClick }: {
  recipe: Recipe
  onClose: () => void
  onRate: (rating: number) => void
  onEdit: () => void
  onTagClick: (tag: string) => void
}) {
  const [language, setLanguage] = useState<'original' | 'en' | 'de' | 'es'>('original')
  const [translations, setTranslations] = useState<Partial<Record<'en' | 'de' | 'es', RecipeTranslation>>>({})
  const [translationLoading, setTranslationLoading] = useState(false)
  const [translationError, setTranslationError] = useState('')
  const displayRecipe = language === 'original' ? recipe : translations[language] ?? recipe

  async function changeLanguage(nextLanguage: 'original' | 'en' | 'de' | 'es') {
    setLanguage(nextLanguage)
    setTranslationError('')
    if (nextLanguage === 'original' || translations[nextLanguage]) return
    if (!supabase) {
      setTranslationError('Translation is unavailable because Supabase is not configured.')
      return
    }
    setTranslationLoading(true)
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
      let message = error.message
      if (error.context instanceof Response) {
        try {
          const body: unknown = await error.context.clone().json()
          if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
            message = body.error
          } else {
            message = `HTTP ${error.context.status}: ${error.message}`
          }
        } catch {
          message = `HTTP ${error.context.status}: ${error.message}`
        }
      }
      setTranslationError(`Could not translate this recipe: ${message}`)
      return
    }
    const translation = data?.translation as RecipeTranslation | undefined
    if (
      !translation ||
      typeof translation.title !== 'string' ||
      typeof translation.description !== 'string' ||
      typeof translation.category !== 'string' ||
      !Array.isArray(translation.ingredients) ||
      !Array.isArray(translation.steps) ||
      !translation.ingredients.every((item: unknown) => typeof item === 'string') ||
      !translation.steps.every((item: unknown) => typeof item === 'string')
    ) {
      setLanguage('original')
      setTranslationError('Could not translate this recipe: the translation response was incomplete.')
      return
    }
    setTranslations((current) => ({ ...current, [nextLanguage]: translation }))
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
          <div className="detail-title-row"><div><span className="eyebrow">FROM YOUR COLLECTION</span><h2 id="detail-title">{displayRecipe.title}</h2></div></div>
          <RatingStars rating={recipe.rating} onRate={onRate} />
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
          {translationError && <div className="form-message" role="alert">{translationError}</div>}
          {displayRecipe.description && <p className="detail-description">{displayRecipe.description}</p>}
          <div className="detail-facts"><span><Clock3 size={16} /> {minutesLabel(recipe.prep_time_minutes, recipe.cook_time_minutes)}</span>{recipe.servings ? <span><Utensils size={16} /> Serves {recipe.servings}</span> : null}</div>
          {recipe.recommended_from && <p className="detail-recommendation"><strong>Recommended from:</strong> {recipe.recommended_from}</p>}
          {(recipe.tags ?? []).length > 0 && <div className="detail-tags" aria-label="Recipe tags">{recipe.tags.map((tag) => <button className="tag-chip" key={tag} onClick={() => onTagClick(tag)}>{tag}</button>)}</div>}
          <div className="detail-columns">
            <section><h3>Ingredients <span>{displayRecipe.ingredients.length}</span></h3><ul className="ingredient-list">{displayRecipe.ingredients.map((item, index) => <li key={`${index}-${item}`}><span className="check-circle"><Check size={11} /></span>{item}</li>)}</ul></section>
            <section><h3>Method</h3><ol className="step-list">{displayRecipe.steps.map((step, index) => <li key={`${index}-${step}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol></section>
          </div>
          <button className="primary-button" onClick={onEdit}><Pencil size={15} /> Edit recipe</button>
          {recipe.source_url && <a className="source-link" href={recipe.source_url} target="_blank" rel="noreferrer">Visit original recipe <ArrowRight size={14} /></a>}
        </div>
      </article>
    </div>
  )
}

export default App
