# 🔐 NestJS Production Auth Backend

A complete, production-ready NestJS backend featuring JWT authentication with refresh tokens, Redis caching, rate limiting, RBAC, and more.

## 🏗️ Architecture Overview

```
src/
├── auth/
│   ├── dto/               # Auth request/response DTOs
│   ├── guards/            # JWT & Refresh token guards
│   ├── strategies/        # Passport strategies (JWT, Local, Refresh)
│   ├── auth.controller.ts # Auth endpoints
│   ├── auth.module.ts
│   └── auth.service.ts    # Core auth logic
├── users/
│   ├── dto/               # User DTOs
│   ├── entities/          # TypeORM User entity
│   ├── users.controller.ts
│   ├── users.module.ts
│   └── users.service.ts   # User CRUD + caching
├── cache/
│   ├── cache.module.ts    # Redis/in-memory cache setup
│   └── cache.service.ts   # Cache service wrapper
├── common/
│   ├── decorators/        # @Public, @Roles, @GetUser
│   ├── filters/           # Global exception filter
│   ├── guards/            # RolesGuard
│   └── interceptors/      # Logging, Transform
├── config/                # Typed configuration
├── app.module.ts          # Root module
└── main.ts                # Bootstrap with security setup
```

## ✅ Features

| Feature | Implementation |
|---|---|
| **JWT Auth** | Access (15m) + Refresh (7d) tokens |
| **Token Rotation** | New refresh token on each use |
| **Token Blacklisting** | Redis cache stores invalidated tokens |
| **Refresh Token Reuse Detection** | Auto-revokes all sessions |
| **Account Lockout** | 5 attempts → 2hr lock |
| **RBAC** | `admin` / `moderator` / `user` roles |
| **Caching** | Redis (prod) / in-memory (dev) |
| **Rate Limiting** | Per-route via `@nestjs/throttler` |
| **Validation** | `class-validator` with whitelist mode |
| **Swagger Docs** | Available at `/docs` in non-prod |
| **Security** | `helmet`, CORS, bcrypt (12 rounds) |
| **Docker** | Multi-stage Dockerfile + compose |

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis 7+

### 1. Install & Configure

```bash
npm install
cp .env.example .env
# Edit .env with your secrets
```

### 2. Start with Docker

```bash
docker-compose up -d
```

### 3. Start Development

```bash
npm run start:dev
```

API runs at: `http://localhost:3000/api/v1`  
Swagger docs: `http://localhost:3000/docs`

---

## 🔑 API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/v1/auth/register` | Public | Register new user |
| `POST` | `/api/v1/auth/login` | Public | Login, get tokens |
| `POST` | `/api/v1/auth/refresh` | Public + RT | Refresh access token |
| `POST` | `/api/v1/auth/logout` | JWT | Logout, invalidate tokens |
| `POST` | `/api/v1/auth/logout-all` | JWT | Logout all sessions |

### Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/users/me/profile` | JWT | Get own profile |
| `PATCH` | `/api/v1/users/me/profile` | JWT | Update own profile |
| `PATCH` | `/api/v1/users/me/password` | JWT | Change password |
| `GET` | `/api/v1/users` | Admin/Mod | List all users |
| `POST` | `/api/v1/users` | Admin | Create user |
| `GET` | `/api/v1/users/:id` | Admin/Mod | Get user by ID |
| `PATCH` | `/api/v1/users/:id` | Admin | Update user |
| `DELETE` | `/api/v1/users/:id` | Admin | Soft-delete user |

---

## 🔐 Auth Flow

```
1. POST /auth/register → returns { accessToken, refreshToken, user }
2. Use accessToken as: Authorization: Bearer <token>
3. When accessToken expires (15min) → POST /auth/refresh with refreshToken
4. Refresh token rotates on use (old one is invalid after)
5. POST /auth/logout → blacklists accessToken, removes refreshToken from DB
```

---

## 💾 Caching Strategy

Users are cached in Redis/memory with:
- **Cache key**: `user:<id>` for individual users
- **TTL**: 5 minutes (configurable via `REDIS_TTL`)
- **Invalidation**: on update, delete, password change
- **Token blacklist**: stored with TTL = remaining expiry time

---

## 🛡️ Security Features

- **Helmet**: sets secure HTTP headers
- **CORS**: configurable origins per environment  
- **Rate Limiting**: global + per-route throttling
- **Account Lockout**: 5 failed attempts → 2hr lock
- **Password Hashing**: bcrypt with 12 rounds
- **Refresh Token Reuse**: terminates all sessions on detection
- **Token Blacklisting**: revoked tokens tracked until expiry
- **Input Validation**: whitelist mode, strips unknown fields
- **Role-Based Access**: `@Roles(UserRole.ADMIN)` decorator

---

## 🧪 Testing

```bash
# Unit tests
npm run test

# With coverage
npm run test:cov

# E2E tests  
npm run test:e2e
```

---

## 🌍 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment |
| `PORT` | `3000` | Server port |
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PASSWORD` | `postgres` | Postgres password |
| `JWT_ACCESS_SECRET` | ⚠️ required | Sign access tokens |
| `JWT_ACCESS_EXPIRATION` | `15m` | Access token TTL |
| `JWT_REFRESH_SECRET` | ⚠️ required | Sign refresh tokens |
| `JWT_REFRESH_EXPIRATION` | `7d` | Refresh token TTL |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_TTL` | `300` | Cache TTL (seconds) |
| `BCRYPT_SALT_ROUNDS` | `12` | Password hash rounds |

---

## 📦 Key Dependencies

- `@nestjs/jwt` + `passport-jwt` — JWT auth
- `@nestjs/cache-manager` + `ioredis` — Caching
- `@nestjs/throttler` — Rate limiting
- `typeorm` + `pg` — Database ORM
- `class-validator` + `class-transformer` — DTO validation
- `bcryptjs` — Password hashing
- `helmet` — HTTP security headers
- `@nestjs/swagger` — API documentation
