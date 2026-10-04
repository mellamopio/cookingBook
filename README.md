# My personal Cookbook

A personal recipe library for collecting recipes from links and photos. The app extracts ingredients, instructions, timing, and categories, then saves recipes to your Supabase account.

## Run locally

1. Install Node.js 20 or newer.
2. Create a [Supabase project](https://supabase.com/dashboard) and an OpenAI API key.
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your Supabase project URL and publishable (anon) key.
4. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

   Restart the dev server after changing `.env.local`.

5. In the Supabase SQL editor, run the SQL files in `supabase/migrations` in filename order. When setting up an existing project, run any new migration files that have not yet been applied; do not rerun migrations that have already been applied.
6. Set the `OPENAI_API_KEY` secret and deploy the extraction function:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY
   npx supabase functions deploy extract-recipe
   ```

Sign up with your email in the app. Supabase email confirmation settings determine whether a new account must verify its email before signing in.

Recipes use a category dropdown, with an option to create a new category that will then appear in the list. Add comma-separated tags to recipes to find them with the search field. The optional “Recommended from” field records who or what introduced you to a recipe.

Rate recipes from one to five stars on their card or detail view. Select the current rating again to clear it.

Imported recipe text is kept in its original language. Open a recipe and use its language selector to view the original or translate the title, description, category, ingredients, and method into English, German, or Spanish. Translations are generated on demand and do not replace the saved original. After updating the Edge Function, deploy it with `npx supabase functions deploy extract-recipe`.

Recipes are private unless you create a read-only sharing link from the recipe detail view. Anyone with that link can view the recipe; revoke the link at any time. Friends can open shared links without an account, and can create accounts using your private app URL to save and share their own recipes. Run the `20261004160000_add_recipe_shares.sql` migration and deploy the `share-recipe` Edge Function before using sharing.

## Recipe imports

Paste a recipe page URL or choose a recipe photo. The extraction function first checks recipe-page structured data, then uses OpenAI to extract the recipe. Review and edit the extracted recipe before saving it, and upload or replace its picture in the recipe form. Images are stored in a private Supabase Storage bucket. Recipe rows and images are scoped to their owner with row-level security.

The OpenAI key is only used by the Supabase Edge Function and must never be added to the frontend environment.

## Stack

- React, TypeScript, and Vite
- Supabase Auth, Postgres, and private Storage
- Supabase Edge Functions and the OpenAI API for recipe extraction
