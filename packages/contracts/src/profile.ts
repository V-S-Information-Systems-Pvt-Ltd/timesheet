import { z } from 'zod'

/** Browser self-profile write: both controlled fields are submitted together. */
export const browserProfileUpdateSchema = z.object({
  department: z.string(),
  title: z.string(),
}).strict()

export type BrowserProfileUpdateInput = z.infer<typeof browserProfileUpdateSchema>
