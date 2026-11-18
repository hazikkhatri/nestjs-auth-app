// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { User, UserStatus } from '../users/entities/user.entity';
import {
  LoginDto,
  RegisterDto,
  AuthResponseDto,
  RefreshTokenDto,
} from './dto/auth.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  // Blacklist prefix for invalidated tokens
  private readonly TOKEN_BLACKLIST_PREFIX = 'blacklist:token:';
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCK_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // ─── REGISTER ─────────────────────────────────────────────────────────────────

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create({
      ...registerDto,
    });

    const tokens = await this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);

    return this.buildAuthResponse(user, tokens);
  }

  // ─── LOGIN ────────────────────────────────────────────────────────────────────

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmailWithPassword(loginDto.email);

    if (!user) {
      // Constant-time response to prevent user enumeration
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check account lock
    if (user.isLocked()) {
      const lockTimeRemaining = Math.ceil(
        (user.lockUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account locked. Try again in ${lockTimeRemaining} minutes`,
      );
    }

    // Check account status
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active');
    }

    // Validate password
    const isPasswordValid = await user.validatePassword(loginDto.password);

    if (!isPasswordValid) {
      // Increment login attempts
      user.incrementLoginAttempts();
      await this.usersService.setLoginAttempts(user.id, user.loginAttempts, user.lockUntil);

      const remaining = this.MAX_LOGIN_ATTEMPTS - user.loginAttempts;
      if (remaining > 0) {
        throw new UnauthorizedException(
          `Invalid credentials. ${remaining} attempts remaining`,
        );
      } else {
        throw new ForbiddenException('Account locked due to too many failed attempts');
      }
    }

    // Successful login - reset attempts
    await this.usersService.setLoginAttempts(user.id, 0, null);

    const tokens = await this.generateTokens(user);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);

    return this.buildAuthResponse(user, tokens);
  }

  // ─── VALIDATE USER (for Local Strategy) ──────────────────────────────────────

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user) return null;

    const isValid = await user.validatePassword(password);
    if (!isValid) return null;

    return user;
  }

  // ─── REFRESH TOKENS ──────────────────────────────────────────────────────────

  async refreshTokens(userId: string, oldRefreshToken: string): Promise<AuthResponseDto> {
    const user = await this.usersService.findById(userId);

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    if (user.refreshToken !== oldRefreshToken) {
      // Possible token reuse - invalidate all tokens (security measure)
      await this.usersService.updateRefreshToken(userId, null);
      throw new UnauthorizedException('Refresh token reuse detected - all sessions terminated');
    }

    const tokens = await this.generateTokens(user);
    await this.usersService.updateRefreshToken(userId, tokens.refreshToken);

    return this.buildAuthResponse(user, tokens);
  }

  // ─── LOGOUT ──────────────────────────────────────────────────────────────────

  async logout(userId: string, accessToken: string): Promise<void> {
    // Invalidate refresh token in DB
    await this.usersService.updateRefreshToken(userId, null);

    // Blacklist the access token until it expires
    try {
      const decoded = this.jwtService.decode(accessToken) as JwtPayload;
      if (decoded?.exp) {
        const ttlMs = decoded.exp * 1000 - Date.now();
        if (ttlMs > 0) {
          await this.cacheManager.set(
            `${this.TOKEN_BLACKLIST_PREFIX}${accessToken}`,
            true,
            ttlMs,
          );
        }
      }
    } catch {
      // Ignore decode errors
    }
  }

  // ─── TOKEN BLACKLIST CHECK ───────────────────────────────────────────────────

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await this.cacheManager.get(
      `${this.TOKEN_BLACKLIST_PREFIX}${token}`,
    );
    return !!result;
  }

  // ─── TOKEN GENERATION ────────────────────────────────────────────────────────

  async generateTokens(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const jti = uuidv4(); // Unique JWT ID

    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti,
    };

    const refreshPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: uuidv4(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiration'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiration'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────────

  private buildAuthResponse(
    user: User,
    tokens: { accessToken: string; refreshToken: string },
  ): AuthResponseDto {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  // ─── DECODE TOKEN ─────────────────────────────────────────────────────────────

  decodeToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.decode(token) as JwtPayload;
    } catch {
      return null;
    }
  }
}
