import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { Department, Role } from '@prisma/client';

export const authRoutes = new Hono();

const departmentValues = [
   Department.UI_UX,
   Department.FRONTEND,
   Department.BACKEND,
   Department.NONE,
] as const;

const normalizeDepartmentValue = (value: unknown): unknown => {
   if (typeof value !== 'string') {
      return value;
   }

   const trimmed = value.trim();
   if (!trimmed) {
      return undefined;
   }

   const normalized = trimmed
      .toUpperCase()
      .replace(/[\s-/]+/g, '_')
      .replace(/_+/g, '_');

   const aliases: Record<string, Department> = {
      UI_UX: Department.UI_UX,
      FRONTEND: Department.FRONTEND,
      FRONT_END: Department.FRONTEND,
      BACKEND: Department.BACKEND,
      BACK_END: Department.BACKEND,
      NONE: Department.NONE,
   };

   return aliases[normalized] ?? normalized;
};

// Register validation schema
const registerSchema = z.object({
   name: z.string().min(1, 'Name is required'),
   email: z.string().email('Invalid email format'),
   password: z.string().min(6, 'Password must be at least 6 characters'),
   role: z.enum([Role.PM, Role.INTERNAL, Role.CLIENT], { message: 'Invalid Role' }),
   department: z.preprocess(
      normalizeDepartmentValue,
      z.enum(departmentValues, { message: 'Invalid Department' }).optional().nullable()
   ),
}).refine((data) => {
   if (data.role !== Role.INTERNAL) {
      return true;
   }

   return data.department !== undefined && data.department !== null && data.department !== Department.NONE;
}, {
   message: 'Department is required for INTERNAL role',
   path: ['department'],
});

authRoutes.post('/register', async (c) => {
   try {
      const body = await c.req.json();
      const parsed = registerSchema.safeParse(body);

      if (!parsed.success) {
         return c.json({
            error: 'Input invalid',
            details: parsed.error.flatten().fieldErrors
         }, 400);
      }

      const { name, email, password, role, department } = parsed.data;

      // Check if email is registered
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
         return c.json({ error: 'Email has been used' }, 409);
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Save to database
      await prisma.user.create({
         data: {
            name,
            email,
            password: hashedPassword,
            role,
            department: role === Role.INTERNAL ? (department ?? Department.NONE) : Department.NONE,
         },
      });

      return c.json({ message: 'Registration success. Please login.' }, 201);
   } catch (error) {
      console.error(error);
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

const loginSchema = z.object({
   email: z.string().email(),
   password: z.string().min(1),
});

authRoutes.post('/login', async (c) => {
   try {
      const body = await c.req.json();
      const parsed = loginSchema.safeParse(body);
      
      if (!parsed.success) {
         return c.json({ error: 'Invalid input', details: parsed.error.format() }, 400);
      }

      const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

      const passwordMatches = user
         ? user.password.startsWith('$2')
            ? await bcrypt.compare(parsed.data.password, user.password)
            : user.password === parsed.data.password
         : false;
      
      if (!user || !passwordMatches) {
         return c.json({ error: 'Wrong credentials' }, 401);
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
         console.error('FATAL ERROR: JWT_SECRET is not set in .env');
         return c.json({ error: 'Internal Server Error: Server configuration invalid' }, 500);
      }
      
      const token = jwt.sign(
         { id: user.id, role: user.role, department: user.department },
         secret,
         { expiresIn: '24h' }
      );

      return c.json({ 
         message: 'Login success', 
         token, 
         user: { id: user.id, name: user.name, role: user.role, department: user.department } 
      });
   } catch (error) {
      console.error("💥 ERROR SAAT LOGIN:", error); 
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});