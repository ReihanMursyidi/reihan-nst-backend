import { PrismaClient, Role, Department } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
   console.log('Starting the seeding process...');

   await prisma.taskDependency.deleteMany();
   await prisma.auditLog.deleteMany();
   await prisma.task.deleteMany();
   await prisma.user.deleteMany();

   const password = 'password123';

   // Seed Product Manager
   const pm = await prisma.user.create({
      data: { 
         name: 'Alice PM', 
         email: 'pm@nst.com', 
         password,
         role: Role.PM,
         department: Department.NONE
      },
   });

   // Seed Internal Team
   const uiux = await prisma.user.create({
      data: {
         name: 'Bob UI/UX',
         email: 'uiux@nst.com',
         password,
         role: Role.INTERNAL,
         department: Department.UI_UX
      },
   });

   const frontend = await prisma.user.create({
      data: {
         name: 'Charlie FE', 
         email: 'fe@nst.com', 
         password, 
         role: Role.INTERNAL, 
         department: Department.FRONTEND 
      },
   });

   const backend = await prisma.user.create({
      data: { 
         name: 'Dave BE', 
         email: 'be@nst.com', 
         password,
         role: Role.INTERNAL, 
         department: Department.BACKEND 
      },
   });

   // Seed Client Guest
   const client = await prisma.user.create({
      data: { 
         name: 'Eve Client', 
         email: 'client@nst.com', 
         password, 
         role: Role.CLIENT, 
         department: Department.NONE 
      },
   });

   // Seed Dummy Project
   await prisma.project.create({
      data: {
         name: 'NodeWave Client Portal',
         description: 'Pengembangan sistem manajemen tugas untuk assessment',
         clientId: client.id,
      },
   });

   console.log('Seeding completed! Account created successfully.');
   console.log('Use the following credentials to login to the trial:');
   console.log('PM: pm@nst.com | UI/UX: uiux@nst.com | FE: fe@nst.com | BE: be@nst.com | Client: client@nst.com');
   console.log('Password for all accounts: password123');
}

main()
   .catch((e) => {
      console.error(e);
      process.exit(1);
   })
   .finally(async () => {
      await prisma.$disconnect();
   });