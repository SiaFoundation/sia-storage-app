import z from 'zod'

export const epochOrIsoToDate = z.codec(
  z.union([z.number(), z.string()]),
  z.date(),
  {
    decode: (value) => new Date(value as any),
    encode: (date) => date.toISOString(),
  }
)
