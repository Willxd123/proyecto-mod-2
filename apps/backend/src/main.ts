import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, host);
  console.log(`API local: http://${host}:${port}/api/health`);
}
bootstrap().catch(() => { console.error('No se pudo iniciar la API. Revise la conexión PostgreSQL y la configuración local.'); process.exitCode = 1; });
