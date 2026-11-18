// src/common/interceptors/logging.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const startTime = Date.now();

    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';

    return next.handle().pipe(
      tap({
        next: () => {
          const { statusCode } = response;
          const elapsed = Date.now() - startTime;
          this.logger.log(
            `${method} ${url} ${statusCode} ${elapsed}ms - ${ip} ${userAgent}`,
          );
        },
        error: (error) => {
          const elapsed = Date.now() - startTime;
          this.logger.error(
            `${method} ${url} ${error.status || 500} ${elapsed}ms - ${ip} ${userAgent}`,
            error.stack,
          );
        },
      }),
    );
  }
}
