import 'next/image-types/global';
import { PrismaClient } from '@prisma/client';

declare global {
  namespace globalThis {
    var prismadb: PrismaClient;
  }
}
