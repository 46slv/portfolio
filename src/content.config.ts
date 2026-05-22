import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const gear = defineCollection({
  loader: glob({
    pattern: '*.md',
    base: './src/content/gear',
    retainBody: true
  }),
  schema: z.object({
    category: z.string(),
    maker: z.string(),
    status: z.string(),
    tags: z.array(z.string()).default([])
  })
});

export const collections = {
  gear
};
