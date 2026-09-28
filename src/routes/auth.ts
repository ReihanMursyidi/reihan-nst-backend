import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../prisma';

export const authRoutes = new Hono();

const loginSchema = z.object({
   email: z.string().email(),
   password: z.string().min(1),
});

authRoutes.post('/login', async (c) => {
   try {
      const body = await c.req.json();
      const parsed = loginSchema.safeParse(body);
      
      if (!parsed.success) {
         return c.json({ error: 'Input tidak valid', details: parsed.error.format() }, 400);
      }

      const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
      
      if (!user || user.password !== parsed.data.password) {
         return c.json({ error: 'Kredensial salah' }, 401);
      }

      const secret = process.env.JWT_SECRET || 'rahasia-super-aman-untuk-assessment-nst';
      const token = jwt.sign(
         { id: user.id, role: user.role, department: user.department },
         secret,
         { expiresIn: '24h' }
      );

      return c.json({ 
         message: 'Login berhasil', 
         token, 
         user: { id: user.id, name: user.name, role: user.role, department: user.department } 
      });
   } catch (error) {
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});