// src/users/users.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { User, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto } from './dto/update-user.dto';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FindAllOptions {
  page?: number;
  limit?: number;
  search?: string;
}

@Injectable()
export class UsersService {
  private readonly CACHE_PREFIX = 'user:';
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────────

  async create(createUserDto: CreateUserDto): Promise<User> {
    const existingUser = await this.findByEmail(createUserDto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const user = this.usersRepository.create(createUserDto);
    const savedUser = await this.usersRepository.save(user);

    // Invalidate users list cache
    await this.invalidateListCache();

    return savedUser;
  }

  // ─── READ ─────────────────────────────────────────────────────────────────────

  async findAll(options: FindAllOptions = {}): Promise<PaginatedResult<User>> {
    const { page = 1, limit = 10, search } = options;
    const cacheKey = `users:list:${page}:${limit}:${search || ''}`;

    // Try cache first
    const cached = await this.cacheManager.get<PaginatedResult<User>>(cacheKey);
    if (cached) return cached;

    const query = this.usersRepository.createQueryBuilder('user');

    if (search) {
      query.where(
        'user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search',
        { search: `%${search}%` },
      );
    }

    query
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.role',
        'user.status',
        'user.isEmailVerified',
        'user.lastLoginAt',
        'user.createdAt',
        'user.updatedAt',
      ])
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await query.getManyAndCount();

    const result: PaginatedResult<User> = {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    // Cache result
    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL * 1000);

    return result;
  }

  async findById(id: string): Promise<User> {
    const cacheKey = `${this.CACHE_PREFIX}${id}`;

    // Try cache first
    const cached = await this.cacheManager.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Cache user
    await this.cacheManager.set(cacheKey, user, this.CACHE_TTL * 1000);

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .addSelect('user.loginAttempts')
      .addSelect('user.lockUntil')
      .addSelect('user.refreshToken')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────────

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    // If updating email, check for conflicts
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const emailTaken = await this.findByEmail(updateUserDto.email);
      if (emailTaken) {
        throw new ConflictException('Email already in use');
      }
    }

    Object.assign(user, updateUserDto);
    const updated = await this.usersRepository.save(user);

    // Invalidate cache
    await this.invalidateUserCache(id);
    await this.invalidateListCache();

    return updated;
  }

  async changePassword(id: string, changePasswordDto: ChangePasswordDto): Promise<void> {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id })
      .getOne();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isValid = await user.validatePassword(changePasswordDto.currentPassword);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.password = changePasswordDto.newPassword;
    user.refreshToken = null; // Invalidate all refresh tokens on password change
    await this.usersRepository.save(user);

    await this.invalidateUserCache(id);
  }

  async updateRefreshToken(id: string, refreshToken: string | null): Promise<void> {
    await this.usersRepository.update(id, {
      refreshToken,
      lastLoginAt: refreshToken ? new Date() : undefined,
    });
    await this.invalidateUserCache(id);
  }

  async setLoginAttempts(id: string, attempts: number, lockUntil: Date | null): Promise<void> {
    await this.usersRepository.update(id, { loginAttempts: attempts, lockUntil });
  }

  // ─── DELETE ──────────────────────────────────────────────────────────────────

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.usersRepository.remove(user);

    // Invalidate cache
    await this.invalidateUserCache(id);
    await this.invalidateListCache();
  }

  async softDelete(id: string): Promise<void> {
    await this.findById(id); // Ensure exists
    await this.usersRepository.update(id, { status: UserStatus.INACTIVE });

    await this.invalidateUserCache(id);
    await this.invalidateListCache();
  }

  // ─── CACHE HELPERS ───────────────────────────────────────────────────────────

  private async invalidateUserCache(id: string): Promise<void> {
    await this.cacheManager.del(`${this.CACHE_PREFIX}${id}`);
  }

  private async invalidateListCache(): Promise<void> {
    // In production with Redis, you'd use pattern deletion
    // For now, we clear known cache keys
    await this.cacheManager.del('users:list:1:10:');
  }
}
