import { Role, TaskStatus } from "@prisma/client";
import { authenticate } from "../middlewares/auth";
import { prisma } from "../prisma";
import { Hono } from "hono";
import z from "zod";

export const taskRoutes = new Hono();

const updateStatusSchema = z.object({
   status: z.enum([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE]),
   version: z.number().int(),
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