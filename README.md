# Backend API - NodeWave Task Management

Backend API untuk sistem NodeWave Task Management. Layanan ini menggunakan Bun, Hono, dan Prisma, dengan validasi request serta kontrol akses berbasis role.

## Teknologi

- Runtime: Bun
- Framework: Hono
- Bahasa: TypeScript
- Database: PostgreSQL (Supabase)
- ORM: Prisma
- Validasi: Zod

## Prasyarat

- Bun
- PostgreSQL atau proyek Supabase dengan database yang dapat diakses

## Instalasi

1. Clone repository dan masuk ke direktori project.
2. Instal dependency:

   ```bash
   bun install
   ```

## Konfigurasi Environment

Buat file `.env` di root project, lalu isi variabel berikut:

```dotenv
DATABASE_URL="postgresql://user:password@host:port/dbname?schema=public"
JWT_SECRET="your_super_secret_jwt_key_here"
```

Gunakan connection string database dan secret JWT milik lingkungan Anda. Jangan commit file `.env` atau membagikan secret.

## Database

Terapkan schema Prisma ke database dan jalankan seed:

```bash
bunx prisma db push
bunx prisma db seed
```

## Menjalankan Server

Jalankan server dalam mode hot reload:

```bash
bun --hot src/index.ts
```

Secara default, server tersedia di `http://localhost:3000`. Port dapat diubah dengan mengatur variabel `PORT`.

## Pengujian dan CI

Jalankan unit test secara lokal:

```bash
bun test
```

GitHub Actions menjalankan pemeriksaan TypeScript, pemeriksaan Biome pada folder `src`, dan unit test. Pemeriksaan Biome saat ini bersifat non-blocking di workflow.
