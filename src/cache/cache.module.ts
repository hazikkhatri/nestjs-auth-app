// src/cache/cache.module.ts
import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

@Global() // Makes CacheService available everywhere without importing
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const isProduction = configService.get('app.isProduction');

        if (isProduction) {
          // Redis for production
          // Uncomment and configure when Redis is available:
          // const { redisInsStore } = require('cache-manager-ioredis-yet');
          // return {
          //   store: redisInsStore,
          //   host: configService.get('redis.host'),
          //   port: configService.get('redis.port'),
          //   password: configService.get('redis.password'),
          //   ttl: configService.get('redis.ttl') * 1000,
          // };
        }

        // In-memory cache for development
        return {
          ttl: configService.get<number>('redis.ttl') * 1000 || 300000, // ms
          max: 1000, // max items
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [CacheService],
  exports: [NestCacheModule, CacheService],
})
export class AppCacheModule {}
