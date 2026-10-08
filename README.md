# Cook & Tell

A social recipe cookbook for collecting recipes from links and photos, then sharing them with friends or publicly when you choose.

## Run locally

1. Install Node.js 20 or newer.
2. Create a [Supabase project](https://supabase.com/dashboard) and a [Gemini API key in Google AI Studio](https://aistudio.google.com/app/apikey).
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your Supabase project URL and publishable (anon) key.
4. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

   Restart the dev server after changing `.env.local`.

5. In the Supabase SQL editor, run the SQL files in `supabase/migrations` in filename order. When setting up an existing project, run any new migration files that have not yet been applied; do not rerun migrations that have already been applied.
6. Set the `GEMINI_API_KEY` secret in Supabase and deploy the recipe AI function:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   npx supabase functions deploy extract-recipe
   ```

   If you previously configured the OpenAI secret, it is no longer used and can be removed with `npx supabase secrets unset OPENAI_API_KEY`.

Sign up with your email in the app. For production email confirmation, set Supabase Authentication → URL Configuration → Site URL to your deployed app URL and add that URL to the Redirect URLs allow list. Signup confirmation links return to the domain where signup started.

Recipes use a category dropdown, with an option to create a new category that will then appear in the list. Add comma-separated tags to recipes to find them with the search field. The optional “Recommended from” field records who or what introduced you to a recipe.

Rate community recipes from one to five stars on their card or detail view. Select the current rating again to clear it. Discovery includes public recipes, accepted friends' recipes, and public recipes from cooks you follow; best-rated sorting uses a weighted rating so a single vote does not dominate.

Imported recipe text is kept in its original language. Open a recipe and use its language selector to view the original or translate the title, description, category, ingredients, and method into English, German, or Spanish. Translations are saved to the signed-in user's account and never replace the original. Choose a preferred language in Settings.

Recipes default to private, including recipes imported from another website. In the recipe editor, choose Private (only you), Friends (accepted friends), or Public (anyone). Supabase row-level security enforces these visibility choices; a friend request must be accepted before friends-only recipes can be read. Copying a friend's recipe creates a private copy in your cookbook. Find cooks by username or email, send friend requests, or follow them to see their public recipes. Create named friend groups, add any confirmed Cook & Tell account by username or email, and browse the group's recipe activity. Share your own recipe to a group with a message; group members can view it even if it is otherwise private. That access lasts only while the recipe remains shared in the group. Save recipes, rate and comment on accessible recipes, attach photos to comments, review recent recipe history, and receive notifications for social activity. Manage your username, password, profile picture, and preferred language in Settings. Anyone with the deployed app URL can create an account.

Run every unapplied migration in filename order. For an existing installation, the Cook & Tell social features additionally require `20261004210000_add_recipe_visibility.sql`, `20261004220000_add_social_features.sql`, and `20261004230000_add_recipe_media_and_translations.sql`. These migrations create the RLS-protected social tables and private image buckets; do not rerun migrations already recorded by Supabase. The `20261008214100_remove_recipe_shares.sql` migration removes the old direct-share links. The `20261008215000_add_friend_groups.sql` migration adds named groups, recipe activity, and member-scoped access to group-shared recipes. The `20261008222000_fix_group_and_recipe_access.sql` migration applies the required `service_role` recipe access and corrects group-owner membership policies. Delete the deployed `share-recipe` Edge Function from Supabase Dashboard → Edge Functions to disable its endpoint and invalidate any existing links. Deploy the remaining Edge Functions after applying the relevant migrations:

   ```sh
   npx supabase functions deploy friend-cookbook
   ```

## Recipe imports

Paste a recipe page URL or choose up to four recipe-page photos. The extraction function first checks recipe-page structured data, then uses Gemini to extract the recipe from page text or the ordered image pages. Review and edit the extracted recipe before saving it. Photo imports keep their original pages in a private bucket and allow a separate cover photo. Recipe rows, cover photos, source pages, and comment images are protected by row-level security and private Storage policies.

Recipe extraction and on-demand translation use Gemini from the Supabase Edge Function. Keep `GEMINI_API_KEY` in Supabase secrets only; never add it to the frontend environment or Vercel variables.

## Stack

- React, TypeScript, and Vite
- Supabase Auth, Postgres, and private Storage
- Supabase Edge Functions and Gemini for recipe extraction and translation
