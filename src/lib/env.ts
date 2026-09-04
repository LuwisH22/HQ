import { z } from 'zod'

/**
 * Environment access, validated once at module load.
 *
 * Only `VITE_`-prefixed variables exist here, and every one of them is public
 * by design — Vite inlines them into the bundle. The service-role key is never
 * referenced anywhere under `src/`; it lives in Edge Function secrets only.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a valid URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, 'VITE_SUPABASE_ANON_KEY looks malformed'),
  VITE_APP_NAME: z.string().min(1).default('LFG HQ'),
  VITE_PUBLIC_SITE_URL: z.string().url().default('http://localhost:1420'),
})

export type AppEnv = z.infer<typeof envSchema>

export interface EnvResult {
  ok: boolean
  env: AppEnv | null
  /** Human-readable reasons, shown on the misconfiguration screen. */
  errors: string[]
}

function readEnv(): EnvResult {
  // Vite types ImportMetaEnv with an `any` index signature; widening it to
  // `unknown` first means Zod is the only thing deciding these are strings.
  const raw = import.meta.env as unknown as Record<string, unknown>

  const parsed = envSchema.safeParse({
    VITE_SUPABASE_URL: raw.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: raw.VITE_SUPABASE_ANON_KEY,
    VITE_APP_NAME: raw.VITE_APP_NAME,
    VITE_PUBLIC_SITE_URL: raw.VITE_PUBLIC_SITE_URL,
  })

  if (!parsed.success) {
    return {
      ok: false,
      env: null,
      errors: parsed.error.issues.map((issue) => {
        const field = issue.path.join('.')
        return field ? `${field}: ${issue.message}` : issue.message
      }),
    }
  }

  return { ok: true, env: parsed.data, errors: [] }
}

export const envResult: EnvResult = readEnv()

/**
 * The validated environment.
 *
 * Throws rather than returning a half-configured object: `AppBootstrap` checks
 * {@link envResult} first and renders a setup screen, so nothing that calls
 * this can run before configuration is known-good.
 */
export function getEnv(): AppEnv {
  if (!envResult.env) {
    throw new Error(`Environment is not configured:\n${envResult.errors.join('\n')}`)
  }
  return envResult.env
}

export const isDev = import.meta.env.DEV
