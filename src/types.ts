export type Recipe = {
  id: string
  title: string
  description: string
  ingredients: string[]
  steps: string[]
  category: string
  tags: string[]
  recommended_from: string | null
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  servings: number | null
  source_url: string | null
  image_path: string | null
  rating: number | null
  created_at: string
  imageUrl?: string | null
}

export type RecipeDraft = {
  title: string
  description: string
  ingredients: string
  steps: string
  category: string
  tags: string
  recommended_from: string
  prep_time_minutes: string
  cook_time_minutes: string
  servings: string
}

export const emptyDraft = (): RecipeDraft => ({
  title: '',
  description: '',
  ingredients: '',
  steps: '',
  category: 'Dinner',
  tags: '',
  recommended_from: '',
  prep_time_minutes: '',
  cook_time_minutes: '',
  servings: '',
})
