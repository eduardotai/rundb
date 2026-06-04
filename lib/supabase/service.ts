import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let serviceClient: SupabaseClient | null = null

/** Server-only Supabase client with service role (bypasses RLS). */
export function createServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.\n' +
      'These must be in .env.local (or set in the current shell env).\n' +
      'The service_role key is required for seeding (it bypasses RLS). Never commit it.'
    )
  }

  serviceClient = createClient(url, key)
  return serviceClient
}
