import { Hono } from "hono";
import { Role } from "@prisma/client";
import { prisma } from "../prisma";
import { authenticate } from "../middlewares/auth";

export const userRoutes = new Hono();

// GET /users/assignees - Mengambil daftar user Internal untuk dropdown PM
userRoutes.get('/assignees', authenticate, async (c) => {
   const tokenUser = c.get('user');
   const userId = tokenUser?.id || tokenUser?.userId;
   const dbUser = await prisma.user.findUnique({ where: { id: userId } });

   // Pastikan hanya PM yang bisa menarik daftar ini
   if (!dbUser || dbUser.role !== 'PM') {
      return c.json({ error: 'Forbidden: Hanya PM yang dapat melihat daftar Assignee' }, 403);
   }

   try {
      const assignees = await prisma.user.findMany({
         where: {
            role: Role.INTERNAL,
            deletedAt: null // Mengabaikan user yang sudah di-soft delete
         },
         select: {
            id: true,
            name: true,
            department: true,
         },
         orderBy: {
            name: 'asc'
         }
      });

      return c.json({ data: assignees }, 200);
   } catch (error) {
      console.error(error);
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});