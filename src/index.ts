import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import type { JwtPayload } from './middlewares/auth';
import { taskRoutes } from './routes/tasks';
import { userRoutes } from './routes/users';

process.on('uncaughtException', (err) => {
   console.error('UNCAUGHT EXCEPTION DI RAILWAY:', err);
});

process.on('unhandledRejection', (reason, promise) => {
   console.error('UNHANDLED REJECTION DI RAILWAY:', reason);
});

declare module 'hono' {
   interface ContextVariableMap {
      user: JwtPayload;
   }
}

export const app = new Hono();

// Basic Middleware
app.use('/*', cors({
   origin: [
     'http://localhost:3000', // Untuk lokal
     'https://reihan-nst-assessment.vercel.app' // <-- URL Frontend Vercel-mu (TANPA / slash di belakang)
   ],
   allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
   allowHeaders: ['Content-Type', 'Authorization'],
   credentials: true,
}));

// Health check
app.get('/', (c) => c.text('NST Assessment API - Running on Bun & Hono'));

// Mount rute
app.route('/api/auth', authRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/users', userRoutes);

// Port Config for Bun
export default {
   port: process.env.PORT || 3000,
   fetch: app.fetch,
};