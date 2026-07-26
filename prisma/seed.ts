import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminHash = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@realestate.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@realestate.com',
      passwordHash: adminHash,
      role: 'ADMIN',
      isVerified: true,
      phone: '9876543210',
    },
  });

  // Create regular test user
  const userHash = await bcrypt.hash('User@1234', 12);
  const user = await prisma.user.upsert({
    where: { email: 'test@realestate.com' },
    update: {},
    create: {
      name: 'Test User',
      email: 'test@realestate.com',
      passwordHash: userHash,
      role: 'USER',
      isVerified: true,
      phone: '9876543211',
    },
  });

  console.log('✅ Created users:', { admin: admin.email, user: user.email });
  console.log('\n📋 Test credentials:');
  console.log('   Admin → admin@realestate.com / Admin@123');
  console.log('   User  → test@realestate.com  / User@1234');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });