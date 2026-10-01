import { handle } from 'hono/vercel';
import { app } from '../src/index';

export const config = {
  runtime: 'nodejs',
};

export const fetch = handle(app);