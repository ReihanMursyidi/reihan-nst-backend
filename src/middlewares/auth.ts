import type { Role } from "@prisma/client";
import type { Context, Next } from "hono";
import jwt from 'jsonwebtoken';

export interface JwtPayload {
   id: string;
   role: Role;
   department: string;
}

const isRole = (value: unknown): value is Role =>
   value === 'PM' || value === 'INTERNAL' || value === 'CLIENT';

const isJwtPayload = (value: unknown): value is JwtPayload => {
   if (typeof value !== 'object' || value === null) {
      return false;
   }

   return (
      'id' in value &&
      typeof value.id === 'string' &&
      'role' in value &&
      isRole(value.role) &&
      'department' in value &&
      typeof value.department === 'string'
   );
};

// Ensure the user is logged in
export const authenticate = async (c: Context, next: Next) => {
   const authHeader = c.req.header('Authorization');

   if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized: Token not found' }, 401);
   }

   const token = authHeader.slice('Bearer '.length).trim();
   if (!token) {
      return c.json({ error: 'Unauthorized: Token not found' }, 401);
   }

   let decoded: unknown;
   try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
         console.error('FATAL ERROR: JWT_SECRET is not set in .env');
         return c.json({ error: 'Internal Server Error: Server configuration invalid' }, 500);
      }

      decoded = jwt.verify(token, secret);
   } catch {
      return c.json({ error: 'Unauthorized: Token invalid' }, 401);
   }

   if (!isJwtPayload(decoded)) {
      return c.json({ error: 'Unauthorized: Token invalid' }, 401);
   }

   c.set('user', decoded);
   await next();
}