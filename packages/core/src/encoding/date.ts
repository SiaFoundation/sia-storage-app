import { z } from 'zod'

export const isoToEpochCodec = z.codec(z.number(), z.date(), {
  decode: (value) => new Date(value),
  encode: (date) => date.getTime(),
})
