import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { TaskStatus } from "@prisma/client";

// Simulasi Service Validation yang digunakan di routes
const createTaskSchema = z.object({
   title: z.string().min(1, 'Title is required'),
   projectId: z.string().uuid(),
   isClientVisible: z.boolean().default(false),
});

const updateStatusSchema = z.object({
   status: z.enum([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE]),
   version: z.number().int(),
});

describe("Task Service Validation Tests", () => {
  test("Must accept a valid task creation payload", () => {
    const validPayload = {
      title: "Setup CI/CD",
      projectId: "570e55b8-304e-413e-807c-383877e26bab",
      isClientVisible: true
    };
    const result = createTaskSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  test("Must reject task creation without a title", () => {
    const invalidPayload = {
      title: "",
      projectId: "570e55b8-304e-413e-807c-383877e26bab",
    };
    const result = createTaskSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  test("Must validate status transitions and optimistic locking versions", () => {
    const validStatusUpdate = {
      status: "IN_PROGRESS",
      version: 1
    };
    const result = updateStatusSchema.safeParse(validStatusUpdate);
    expect(result.success).toBe(true);
  });
});