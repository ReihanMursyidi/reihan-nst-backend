import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';

const app = new Hono();

// Basic Middleware
app.use('/*', cors());

// Health check
app.get('/', (c) => c.text('NST Assessment API - Running on Bun & Hono'));

// Mount rute
app.route('/api/auth', authRoutes);

// Port Config for Bun
export default {
   port: process.env.PORT || 3000,
   fetch: app.fetch,
};