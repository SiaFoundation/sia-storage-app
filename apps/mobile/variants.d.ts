// Type declarations for variants.js (a CommonJS module so app.config.js can
// `require` it under plain node, while the TS release scripts `import` it).

export type VariantKey = 'dev' | 'beta' | 'prod'

export interface ResolvedVariant {
  key: VariantKey
  name: string
  slug: string
  xcodeName: string
  bundleId: string
  iosIcon: string
  androidIcon: string
  shareExtBundleId: string
  appGroup: string
  iosProfileName: string
  shareExtProfileName: string
  isReleaseVariant: boolean
}

export const VARIANTS: Record<VariantKey, unknown>
export const DEFAULT_VARIANT: VariantKey
export function resolveVariant(name?: string): ResolvedVariant
