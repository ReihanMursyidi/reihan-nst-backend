import { Role, TaskStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { BuildQueryFilter, extractQueryFromParams } from '@nodewave/prisma-ezfilter';
import { authenticate, requireRole } from "../middlewares/auth";
import { prisma } from "../prisma";
import { Hono } from "hono";
import z from "zod";
import { toSSG } from "hono/ssg";

export const taskRoutes = new Hono();

const updateStatusSchema = z.object({
   status: z.enum([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE]),
   version: z.number().int(),
});

const taskQueryBuilder = new BuildQueryFilter({
   allowedFields: ['title', 'description', 'status', 'projectId', 'assigneeId', 'isClientVisible', 'createdAt', 'updatedAt'],
   allowedRelations: ['assignee', 'project'],
   maxPageSize: 100,
   defaultPageSize: 20,
});

// Endpoint get tasks list
taskRoutes.get('/', authenticate, async (c) => {
   const user = c.get('user');

   try {
      // Determine basic conditions based on Role (ABAC)
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

      if (!validation.isValid) {
         return c.json({ error: 'Invalid task filters', details: validation.errors }, 400);
      }

      // Execute Query to Database
      const tasks = await prisma.task.findMany({
         where: {
            AND: [baseWhere, filterOptions.where],
         },
         skip: filterOptions.skip,
         take: filterOptions.take,
         orderBy: filterOptions.orderBy,
         include: {
            assignee: {
               select: { id: true, name: true, department: true }
            },
            project: {
               select: { id: true, name: true }
            }
         }
      });

      const maskedTasks = tasks.map(task => {
         if (user.role === Role.CLIENT) {
            const { assignee, assigneeId, ...safeTask } = task;
            return safeTask;
         }
         return task;
      });

      // Calculate the total number of records for frontend pagination purposes
      const totalCount = await prisma.task.count({
         where: { AND: [baseWhere, filterOptions.where] }
      });

      return c.json({
         data: maskedTasks,
         meta: {
            total: totalCount,
            page: Number(queryParams.page) || 1,
            limit: filterOptions.take,
         }
      });
   
   } catch (error) {
      console.error(error);
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

// Validation schema for creating a new task
const createTaskSchema = z.object({
   title: z.string().min(1, 'Title is required'),
   description: z.string().optional(),
   projectId: z.string().uuid(),
   assigneeId: z.string().uuid().optional(),
   isClientVisible: z.boolean().default(false),
   dependsOn: z.array(z.string().uuid()).optional(),
});

// Endpoint create task (Only PM allowed to access)
taskRoutes.post('/', authenticate, requireRole(['PM']), async (c) => {
   const user = c.get('user');

   try {
      const body = await c.req.json();
      const parsed = createTaskSchema.safeParse(body);

      if (!parsed.success) {
         return c.json({
            error: 'Input invalid',
            details: parsed.error.format() 
         }, 400);
      }

      const { 
         title, description, projectId, assigneeId, 
         isClientVisible, dependsOn 
      } = parsed.data;

      const projectExists = await prisma.project.findUnique({ where: { id: projectId} });
      if (!projectExists) {
         return c.json({ error: 'Project not found' }, 404);
      }

      // Execute task creation
      const newTask = await prisma.$transaction(async (tx) => {
         // Create Main Task
         const task = await tx.task.create({
            data: {
               title, description, projectId, assigneeId, 
               isClientVisible, status: TaskStatus.TODO, 
               version: 0,
            }
         });

         // Mapping dependencies
         if (dependsOn && dependsOn.length > 0) {
            const dependencyData = dependsOn.map((dependsOnId) => ({
               taskId: task.id,
               dependsOnId: dependsOnId
            }));

            await tx.taskDependency.createMany({
               data: dependencyData
            });
         }

         // Record in the Immutable Audit Trail
         await tx.auditLog.create({
            data: {
               entityId: task.id,
               entityType: 'Task',
               columnChanged: 'CREATED',
               newValue: title,
               userId: user.id,
            }
         });

         return task;
      });

      return c.json({
         message: 'Task created successfully', task: newTask
      }, 201);
   
   } catch (error) {
      console.error(error);
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});

// Endpoint change task status
taskRoutes.patch('/:id/status', authenticate, async (c) => {
   const taskId = c.req.param('id');
   const user = c.get('user');

   if (!taskId) {
      return c.json({ error: 'Task ID is required' }, 400);
   }

   try {
      const body = await c.req.json();
      const parsed = updateStatusSchema.safeParse(body);

      if (!parsed.success) {
         return c.json({
            error: 'Input invalid',
            details: parsed.error.format()
         }, 400);
      }

      const { status: newStatus, version: expectedVersion } = parsed.data;

      const currentTask = await prisma.task.findUnique({
         where: { id: taskId, deletedAt: null },
         include: { blockedBy: { include: { dependsOn: true } } },
      });

      if (!currentTask) {
         return c.json({ error: 'Task not found' }, 404);
      }

      if (user.role === Role.PM && newStatus === TaskStatus.DONE) {
         return c.json({ error: 'PM is not allowed to change status to DONE' }, 403);
      }

      if (user.role === Role.INTERNAL && newStatus === TaskStatus.IN_PROGRESS) {
         const pendingDependencies = currentTask.blockedBy.filter(
            (dep) => dep.dependsOn.status !== TaskStatus.DONE
         );
         
         if (pendingDependencies.length > 0) {
            return c.json({ 
               error: 'State-Based Permission Error: This task is currently blocked because a dependency has not been completed.',
               blockedBy: pendingDependencies.map(d => d.dependsOn.title)
            }, 403);
         }
      }

      const result = await prisma.$transaction(async (tx) => {
         const updatedTask = await tx.task.updateMany({
            where: {
               id: taskId,
               version: expectedVersion,
            },
            data: {
               status: newStatus,
               version: { increment: 1 },
            },
         });

         if (updatedTask.count === 0) {
            throw new Error ('CONCURRENCY_CONFLICT');
         }

         await tx.auditLog.create({
            data: {
               entityId: taskId,
               entityType: 'Task',
               columnChanged: 'status',
               oldValue: currentTask.status,
               newValue: newStatus,
               userId: user.id,
            }
         });

         return tx.task.findUnique({ where: { id: taskId } });
      });

      return c.json({ message: 'Status updated successfully', task: result });

   } catch (error: any) {
      if (error.message === 'CONCURRENCY_CONFLICT') {
         return c.json({ 
            error: 'Conflict (409): This data has just been modified by another user. Please refresh the page to get the latest data.' 
         }, 409);
      }
      
      return c.json({ error: 'Internal Server Error' }, 500);
   }
});