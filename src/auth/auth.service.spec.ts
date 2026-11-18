// src/auth/auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';

const mockUser: Partial<User> = {
  id: 'uuid-123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
  refreshToken: null,
  loginAttempts: 0,
  lockUntil: null,
  isLocked: jest.fn().mockReturnValue(false),
  validatePassword: jest.fn().mockResolvedValue(true),
  resetLoginAttempts: jest.fn(),
  incrementLoginAttempts: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let cacheManager: jest.Mocked<any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            create: jest.fn(),
            findByEmailWithPassword: jest.fn(),
            findById: jest.fn(),
            updateRefreshToken: jest.fn(),
            setLoginAttempts: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('mock-token'),
            decode: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                'jwt.accessSecret': 'test-secret',
                'jwt.accessExpiration': '15m',
                'jwt.refreshSecret': 'test-refresh',
                'jwt.refreshExpiration': '7d',
              };
              return config[key];
            }),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    cacheManager = module.get(CACHE_MANAGER);
  });

  describe('login', () => {
    it('should return auth tokens on successful login', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(mockUser as User);
      usersService.updateRefreshToken.mockResolvedValue(undefined);
      usersService.setLoginAttempts.mockResolvedValue(undefined);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException when user not found', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nonexistent@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException when account is locked', async () => {
      const lockedUser = {
        ...mockUser,
        isLocked: jest.fn().mockReturnValue(true),
        lockUntil: new Date(Date.now() + 60000),
      };
      usersService.findByEmailWithPassword.mockResolvedValue(lockedUser as User);

      await expect(
        service.login({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateTokens', () => {
    it('should generate both access and refresh tokens', async () => {
      const tokens = await service.generateTokens(mockUser as User);

      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    });
  });

  describe('logout', () => {
    it('should invalidate refresh token on logout', async () => {
      jwtService.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 900 });
      usersService.updateRefreshToken.mockResolvedValue(undefined);

      await service.logout('uuid-123', 'mock-access-token');

      expect(usersService.updateRefreshToken).toHaveBeenCalledWith('uuid-123', null);
      expect(cacheManager.set).toHaveBeenCalled();
    });
  });
});
