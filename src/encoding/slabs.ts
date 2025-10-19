import { z } from 'zod'

export const slabSchema = z.object({
  id: z.string(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
})

export const slabsStorageCodec = z.codec(z.string(), z.array(slabSchema), {
  decode: (stored) => {
    try {
      const parsed = JSON.parse(stored)
      const result = slabSchema.array().safeParse(parsed)
      return result.success ? result.data : []
    } catch {
      return []
    }
  },
  encode: (domain) => JSON.stringify(domain ?? []),
})
