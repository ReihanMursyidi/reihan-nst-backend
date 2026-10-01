import { Role, TaskStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { BuildQueryFilter, extractQueryFromParams } from '@nodewave/prisma-ezfilter';
import { authenticate } from "../middlewares/auth";
import { prisma } from "../prisma";
import { Hono } from "hono";
import z from "zod";

export const taskRoutes = new Hono();

type TaskUser = {
   id: string;
   role: Role | string;
   department: string;
};

const normalizeRole = (role: unknown): string => String(role ?? '').toUpperCase();

const hasRole = (user: { role?: unknown }, expected: Role): boolean =>
   normalizeRole(user.role) === expected;

// ==========================================
// 🛡️ INTERCEPTOR PENYELAMAT (MIDDLEWARE)
// ==========================================
// Menarik data user utuh dari DB agar 'role' tidak undefined
taskRoutes.use('*', authenticate, async (c, next) => {
   const tokenUser = c.get('user');
   // Dukung format token { id } maupun { userId }
   const userId = tokenUser?.id || tokenUser?.userId; 
   
   if (!userId) {
      return c.json({ error: 'Unauthorized: ID tidak ditemukan di dalam token' }, 401);
   }
   
   const fullUser = await prisma.user.findUnique({ where: { id: userId } });
   if (!fullUser) {
      return c.json({ error: 'Unauthorized: User tidak ditemukan di database' }, 401);
   }
   
   // Timpa data token dengan data asli dari database
   c.set('user', fullUser); 
   await next();
});

// --- ZOD SCHEMAS ---
const updateStatusSchema = z.object({
   status: z.enum([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE]),
   version: z.number().int(),
});

const createTaskSchema = z.object({
   title: z.string().min(1, 'Title is required'),
   description: z.string().optional(),
   projectId: z.string().uuid(),
   assigneeId: z.string().uuid().nullable().optional(),
   isClientVisible: z.boolean().default(false),
   dependsOn: z.array(z.string().uuid()).optional(),
});

const updateTaskDetailSchema = z.object({
   title: z.string().min(1).optional(),
   assigneeId: z.string().uuid().nullable().optional().or(z.literal("")),
   isClientVisible: z.boolean().optional(),
   version: z.number().int(),
});

const addAttachmentSchema = z.object({
   attachmentUrl: z.string().url('Invalid URL Format'),
});

const taskQueryBuilder = new BuildQueryFilter({
   allowedFields: ['title', 'description', 'status', 'projectId', 'assigneeId', 'isClientVisible', 'createdAt', 'updatedAt'],
   allowedRelations: ['assignee', 'project'],
   maxPageSize: 100,
   defaultPageSize: 20,
});

// 1. GET /tasks (Semua Role)
taskRoutes.get('/', async (c) => {
   const user = c.get('user') as TaskUser;
   try {
      const baseWhere: Prisma.TaskWhereInput = { deletedAt: null };

      if (user.role === Role.CLIENT) {
         baseWhere.isClientVisible = true;
         baseWhere.project = { clientId: user.id };
      } else if (user.role === Role.INTERNAL) {
         baseWhere.assigneeId = user.id;
      }

      const queryParams = c.req.query();
      const filter = extractQueryFromParams(queryParams);
      const { query: filterOptions, validation } = taskQueryBuilder.build(filter);

      if (!validation.isValid) return c.json({ error: 'Invalid task filters', details: validation.errors }, 400);

      const tasks = await prisma.task.findMany({
         where: { AND: [baseWhere, filterOptions.where] },
         skip: filterOptions.skip,
         take: filterOptions.take,
         orderBy: filterOptions.orderBy,
         include: {
            assignee: { select: { id: true, name: true, department: true } },
            project: { select: { id: true, name: true } }
         }
      });

      const maskedTasks = tasks.map(task => {
         if (user.role === Role.CLIENT) {
            const { assignee, assigneeId, ...safeTask } = task;
            return safeTask;
         }
         return task;
      });

      const totalCount = await prisma.task.count({ where: { AND: [baseWhere, filterOptions.where] } });
      return c.json({ data: maskedTasks, meta: { total: totalCount, page: Number(queryParams.page) || 1, limit: filterOptions.take } });
   } catch (error) {
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

// 2. POST /tasks (Khusus PM)
taskRoutes.post('/', async (c) => {
   const user = c.get('user') as TaskUser;
   if (!hasRole(user, Role.PM)) return c.json({ error: 'Forbidden: Hanya PM yang dapat membuat tugas' }, 403);

   try {
      const body = await c.req.json();
      const parsed = createTaskSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'Input invalid', details: parsed.error.format() }, 400);

      const { title, description, projectId, assigneeId, isClientVisible, dependsOn } = parsed.data;

      const projectExists = await prisma.project.findUnique({ where: { id: projectId} });
      if (!projectExists) return c.json({ error: 'Project not found' }, 404);

      const newTask = await prisma.$transaction(async (tx) => {
         const task = await tx.task.create({
            data: { title, description, projectId, assigneeId, isClientVisible, status: TaskStatus.TODO, version: 0 }
         });

         if (dependsOn && dependsOn.length > 0) {
            await tx.taskDependency.createMany({ data: dependsOn.map((id) => ({ taskId: task.id, dependsOnId: id })) });
         }

         await tx.auditLog.create({
            data: { entityId: task.id, entityType: 'Task', columnChanged: 'CREATED', newValue: title, userId: user.id }
         });
         return task;
      });

      return c.json({ message: 'Task created successfully', task: newTask }, 201);
   } catch (error) {
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

// 3. PATCH /tasks/:id/status (PM & Internal)
taskRoutes.patch('/:id/status', async (c) => {
   const taskId = c.req.param('id');
   const user = c.get('user') as TaskUser;

   try {
      const body = await c.req.json();
      const parsed = updateStatusSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'Input invalid', details: parsed.error.format() }, 400);

      const { status: newStatus, version: expectedVersion } = parsed.data;

      const currentTask = await prisma.task.findUnique({
         where: { id: taskId, deletedAt: null },
         include: { blockedBy: { include: { dependsOn: true } } },
      });

      if (!currentTask) return c.json({ error: 'Task not found' }, 404);

      if (hasRole(user, Role.PM) && newStatus === TaskStatus.DONE) {
         return c.json({ error: 'PM is not allowed to change status to DONE' }, 403);
      }

      if (hasRole(user, Role.INTERNAL) && newStatus === TaskStatus.IN_PROGRESS) {
         const pendingDependencies = currentTask.blockedBy.filter(dep => dep.dependsOn.status !== TaskStatus.DONE);
         if (pendingDependencies.length > 0) {
            return c.json({ error: 'State-Based Permission Error: This task is currently blocked.', blockedBy: pendingDependencies.map(d => d.dependsOn.title) }, 403);
         }
      }

      const result = await prisma.$transaction(async (tx) => {
         const updatedTask = await tx.task.updateMany({
            where: { id: taskId, version: expectedVersion },
            data: { status: newStatus, version: { increment: 1 } },
         });

         if (updatedTask.count === 0) throw new Error ('CONCURRENCY_CONFLICT');

         await tx.auditLog.create({
            data: { entityId: taskId, entityType: 'Task', columnChanged: 'status', oldValue: currentTask.status, newValue: newStatus, userId: user.id }
         });
         return tx.task.findUnique({ where: { id: taskId } });
      });

      return c.json({ message: 'Status updated successfully', task: result });
   } catch (error: any) {
      if (error.message === 'CONCURRENCY_CONFLICT') return c.json({ error: 'Conflict (409): This data has just been modified by another user.' }, 409);
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

// 4. PATCH /tasks/:id (Edit Detail - Khusus PM)
taskRoutes.patch('/:id', async (c) => {
   const taskId = c.req.param('id');
   const user = c.get('user') as TaskUser;

   if (!hasRole(user, Role.PM)) return c.json({ error: 'Forbidden: Hanya PM yang dapat mengedit tugas' }, 403);

   try {
      const body = await c.req.json();
      const parsed = updateTaskDetailSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'Input invalid', details: parsed.error.format() }, 400);

      const { version: expectedVersion, ...updateData } = parsed.data;
      
      // Jika assigneeId adalah string kosong, ubah menjadi null agar Prisma tidak error
      if (updateData.assigneeId === "") {
         updateData.assigneeId = null;
      }

      const currentTask = await prisma.task.findUnique({ where: { id: taskId, deletedAt: null } });
      if (!currentTask) return c.json({ error: 'Task not found' }, 404);

      const result = await prisma.$transaction(async (tx) => {
         const updatedTask = await tx.task.updateMany({
            where: { id: taskId, version: expectedVersion },
            data: { ...updateData, version: { increment: 1 } },
         });

         if (updatedTask.count === 0) throw new Error('CONCURRENCY_CONFLICT');

         await tx.auditLog.create({
            data: { entityId: taskId, entityType: 'Task', columnChanged: 'DETAILS', oldValue: currentTask.title, newValue: updateData.title || currentTask.title, userId: user.id }
         });

         return tx.task.findUnique({ where: { id: taskId } });
      });

      return c.json({ message: 'Task details updated successfully', task: result });
   } catch (error: any) {
      if (error.message === 'CONCURRENCY_CONFLICT') return c.json({ error: 'Conflict (409): Data dimodifikasi user lain.' }, 409);
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

// 5. DELETE /tasks/:id (Soft Delete - Khusus PM)
taskRoutes.delete('/:id', async (c) => {
   const taskId = c.req.param('id');
   const user = c.get('user') as TaskUser;

   if (!hasRole(user, Role.PM)) return c.json({ error: 'Forbidden: Hanya PM yang dapat menghapus tugas' }, 403);

   try {
      const currentTask = await prisma.task.findUnique({ where: { id: taskId, deletedAt: null } });
      if (!currentTask) return c.json({ error: 'Task not found' }, 404);

      await prisma.$transaction(async (tx) => {
         await tx.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
         await tx.auditLog.create({
            data: { entityId: taskId, entityType: 'Task', columnChanged: 'DELETED', oldValue: currentTask.title, newValue: 'SOFT_DELETED', userId: user.id }
         });
      });

      return c.json({ message: 'Task deleted successfully (Soft Delete)' });
   } catch (error) {
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

// 6. POST /tasks/:id/attachments (Upload Attachment - Khusus PM & Internal)
taskRoutes.post('/:id/attachments', async (c) => {
   const taskId = c.req.param('id');
   const user = c.get('user') as TaskUser;

   if (!hasRole(user, Role.PM) && !hasRole(user, Role.INTERNAL)) {
      return c.json({ error: 'Forbidden: Khusus PM dan Internal' }, 403);
   }

   try {
      const body = await c.req.json();
      const parsed = addAttachmentSchema.safeParse(body);
      if(!parsed.success) return c.json({ error: 'Input invalid', details: parsed.error.format() }, 400);

      const { attachmentUrl } = parsed.data;

      const currentTask = await prisma.task.findUnique({ where: { id: taskId, deletedAt: null } });
      if (!currentTask) return c.json({ error: 'Task not found' }, 404);

      if (hasRole(user, Role.INTERNAL) && currentTask.assigneeId !== user.id) {
         return c.json({ error: 'Access denied: Anda hanya bisa upload ke tugas Anda sendiri.' }, 403);
      }

      const updatedTask = await prisma.$transaction(async (tx) => {
         const task = await tx.task.update({
            where: { id: taskId },
            data: { attachments: { push: attachmentUrl }, version: { increment: 1 } }
         });

         await tx.auditLog.create({
            data: { entityId: taskId, entityType: 'Task', columnChanged: 'ATTACHMENTS', oldValue: 'NEW_ATTACHMENT', newValue: attachmentUrl, userId: user.id }
         });

         return task;
      });

      return c.json({ message: 'Attachment added successfully', task: updatedTask }, 201);
   } catch (error) {
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});