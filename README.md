# Fastly Waiting Room

A high-performance virtual waiting room solution built on Fastly Compute. This application protects high-traffic endpoints by queuing visitors when demand exceeds capacity, ensuring fair access and preventing site overload.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Queue Management](#queue-management)
- [Redis Schema](#redis-schema)
- [Security](#security)
- [Development](#development)

## Overview

The Fastly Waiting Room runs at the edge using Fastly's Compute@Edge platform, providing ultra-low latency queue management. It uses Redis for distributed state management and JWT tokens for secure visitor authentication.

### How It Works

1. **Request Interception**: All requests to protected paths are evaluated
2. **Token Validation**: Visitors receive a signed JWT containing their queue position
3. **Queue Management**: Redis maintains the queue state (cursor, length, visitor positions)
4. **Automatic Entry**: Configurable automatic admission based on time intervals
5. **Fair Access**: UUID-based position reservation prevents queue jumping

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                    Fastly Edge (POP)                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐      ┌──────────────┐                 │
│  │   index.js   │─────▶│   config.js  │                 │
│  │ (Main Logic) │      │ (KV/Secrets) │                 │
│  └──────┬───────┘      └──────────────┘                 │
│         │                                               │
│         ├──────▶ ┌──────────────┐                       │
│         │        │   store.js   │                       │
│         │        │ (Redis Ops)  │─────┐                 │
│         │        └──────────────┘     │                 │
│         │                             │                 │
│         ├──────▶ ┌──────────────┐     │                 │
│         │        │   admin.js   │     │                 │
│         │        │ (Admin UI)   │     │                 │
│         │        └──────────────┘     │                 │
│         │                             │                 │
│         └──────▶ ┌──────────────┐     │                 │
│                  │  logging.js  │     │                 │
│                  │ (Telemetry)  │     │                 │
│                  └──────────────┘     │                 │
│                                       │                 │
└───────────────────────────────────────┼─────────────────┘
                                        │
                                        ▼
                          ┌──────────────────────────┐
                          │   Redis (Upstash)        │
                          │  - Queue State           │
                          │  - Position Tracking     │
                          │  - Cursor Management     │
                          └──────────────────────────┘
```

### Data Flow

1. **Request Processing** (`src/index.js:28`)
   - Validates global whitelist
   - Matches request path to queue configuration
   - Checks queue active status and expiration
   - Applies geo-filtering if configured

2. **Token Management** (`src/index.js:106-199`)
   - Validates existing JWT tokens using JOSE library
   - Verifies UUID and position in Redis
   - Issues new tokens with automatic refresh
   - Supports multiple signing algorithms (RS256, ES256, etc.)

3. **Queue Logic** (`src/index.js:201-228`)
   - Tracks queue cursor (visitors admitted)
   - Manages automatic entry periods
   - Calculates wait times and positions
   - Atomic Redis operations for consistency

4. **State Storage** (`src/store.js`)
   - Redis operations with performance tracking
   - Atomic counters (INCR, INCRBY)
   - TTL-based position cleanup
   - Operation counting for billing estimates

## Key Features

### Multi-Queue Support
- Configure multiple queues with different paths
- Per-queue or global configuration inheritance
- Queue-specific waiting room pages

### Geolocation Filtering
- Queue by country code (ISO 3166-1 alpha-3)
- Allow/block specific geographic regions
- Client geo data from Fastly platform

### Automatic Queue Advancement
- Time-based automatic entry (e.g., every 60 seconds)
- Configurable quantity per period
- Prevents indefinite queuing

### Token Security
- Signed JWT tokens with configurable algorithms
- Position verification via UUID
- Automatic token refresh before expiration
- Cookie-based session management

### Admin Interface
- Web-based configuration UI
- Real-time queue statistics
- Manual visitor admission
- Per-queue administration

### Debug Mode
- Redis operation timing and counting
- Token validation performance metrics
- Request flow logging
- Header-based debug activation (`Fastly-Debug`)

## Getting Started

### Prerequisites

- [Fastly CLI](https://developer.fastly.com/learning/tools/cli) installed
- Node.js 18+ for local development
- Redis instance (recommend [Upstash](https://upstash.com/) for serverless Redis)
- RSA/ECDSA key pair in JWKS format

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Waiting-Room
```

2. Install dependencies:
```bash
npm install
```

3. Generate cryptographic keys:
```bash
./keyGen.sh  # Creates RSA key pair in JWKS format
```

4. Configure your environment:
   - Update `global_config.json` with your settings
   - Update `fastly.toml` with your service ID and backend URLs
   - Create secret store entries for keys and tokens

### Local Development

Start the local development server:
```bash
npm start
```

This uses the Fastly CLI local server with configuration from `fastly.toml`.

### Deployment

Build and deploy to Fastly:
```bash
npm run build    # Compile to WebAssembly
npm run deploy   # Publish to Fastly
```

## Configuration

### Global Configuration

Stored in KV Store as key `globalConfig` (see `global_config.json`):

```json
{
  "queueName": "global_config",
  "forceDebug": true,
  "active": false,
  "expires": "",
  "adminPassword": "password",
  "adminPath": "/QueueAdmin",
  "queues": [
    [ "/regex-pattern", "queue-name" ]
  ],
  "whitelist": [
    "/robots.txt",
    "/favicon.ico"
  ],
  "refreshInterval": 15,
  "cookieName": "global-queue",
  "cookieExpiry": 86400,
  "automatic": 60,
  "automaticQuantity": 10,
  "redisUrl": "https://your-redis.upstash.io:443",
  "redisToken": "global_redisToken",
  "queuePage": "global_Queue",
  "adminPage": "global_Admin",
  "privateKey": "global_privateKey",
  "publicKey": "global_publicKey"
}
```

#### Key Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `forceDebug` | boolean | Enable debug logging for all requests |
| `active` | boolean | Default active state for queues |
| `adminPath` | string | URL path for admin interface |
| `queues` | array | Path regex → queue name mappings |
| `whitelist` | array | Paths that bypass queueing |
| `refreshInterval` | number | Waiting room page auto-refresh (seconds) |
| `cookieExpiry` | number | JWT cookie lifetime (seconds) |
| `automatic` | number | Seconds between automatic admissions (0 = disabled) |
| `automaticQuantity` | number | Visitors to admit per period |

### Queue Configuration

Each queue can override global settings (see `queue-config.json`):

```json
{
  "queueName": "html",
  "queuePath": "^/html",
  "active": true,
  "expires": "2025-12-31T23:59:59Z",
  "geocodes": ["USA", "CAN"],
  "refreshInterval": 15,
  "cookieName": "sample-queue",
  "cookieExpiry": "86400",
  "automatic": 60,
  "automaticQuantity": 10
}
```

Any omitted fields inherit from global configuration.

### Secret Store Keys

Required secrets in Secret Store `queue-secrets`:

| Key | Content | Format |
|-----|---------|--------|
| `global_privateKey` | Private signing key | JWKS (JSON) |
| `global_publicKey` | Public verification key | JWKS (JSON) |
| `global_redisToken` | Redis API token | Plain text |

### KV Store Keys

Required entries in KV Store `queueConfig`:

| Key | Content | Type |
|-----|---------|------|
| `globalConfig` | Global settings | JSON |
| `[queueName]` | Queue-specific config | JSON |
| `global_Queue` | Default waiting room HTML | HTML |
| `global_Admin` | Admin interface HTML | HTML |

## Queue Management

### Admin Interface

Access the admin interface at your configured `adminPath` (default: `/QueueAdmin`).

**Authentication**: HTTP Basic Auth
- Username: `admin`
- Password: Configured in `adminPassword`

**Features**:
- View current queue length and cursor position
- Manually admit visitors (specify quantity)
- Update queue configuration in real-time
- Monitor waiting visitor count

### Queue Behavior

**Position Assignment** (`src/index.js:169-176`):
- New visitors receive a UUID (v7) and queue position
- Position stored in Redis with TTL equal to cookie expiry
- Expired positions are automatically purged

**Automatic Advancement** (`src/index.js:209-228`):
- First request in new period triggers cursor increment
- Configurable period (e.g., every 60 seconds)
- Configurable quantity (e.g., admit 10 visitors)
- Uses Redis TTL for period tracking

**Wait Time Calculation** (`src/index.js:274-307`):
- Based on queue position, cursor, and automatic settings
- Displays estimated time in waiting room
- Adjusts if queue expires before calculated time

## Redis Schema

All keys are prefixed with `{queueName}:` for namespace isolation.

### Key Structure

| Key Pattern | Type | TTL | Description |
|------------|------|-----|-------------|
| `{queue}:cursor` | integer | none | Current admission position (visitors let in) |
| `{queue}:length` | integer | none | Total queue length (positions assigned) |
| `{queue}:auto` | integer | `automatic` | Request counter for current period |
| `{queue}:QP:{uuid}` | integer | `cookieExpiry` | Reserved position for UUID |

### Operations

- **Atomic Increments**: `INCR`, `INCRBY` ensure consistency under high load
- **TTL Management**: Automatic cleanup of abandoned positions
- **Performance Tracking**: All operations timed and counted (`src/store.js:38-40`)

### Example Flow

```
1. New visitor arrives
   - INCR html:length → 1001
   - SET html:QP:01234567-... 1001 PX 86400000 NX

2. Automatic admission (every 60s, admit 10)
   - INCR html:auto → 1
   - EXPIRE html:auto 60
   - INCRBY html:cursor 10 → 995

3. Visitor checks position
   - GET html:cursor → 995
   - GET html:QP:01234567-... → 1001
   - Position: 1001, Cursor: 995 → Still waiting (6 ahead)

4. Token refresh
   - PEXPIRE html:QP:01234567-... 86400000
```

## Security

### Token Validation

JWT tokens (`src/index.js:112-142`) are validated for:
- Signature (JOSE library verification)
- Issuer/Audience claims
- Subject (queue name)
- Expiration time
- UUID format (RFC 4122)
- Position match in Redis

### Position Security

UUID-based position reservation prevents:
- Cookie sharing across visitors
- Manual position manipulation
- Queue position hijacking

### Admin Security

**Current**: HTTP Basic Auth (not production-ready)

**TODO**: Implement robust authentication:
- OAuth2/OIDC integration
- API key management
- Rate limiting
- Audit logging

**⚠️ Warning**: Default admin password is `password` - change immediately!

## Development

### Project Structure

```
Waiting-Room/
├── src/
│   ├── index.js         # Main request handler
│   ├── config.js        # Configuration loading (KV/Secret stores)
│   ├── store.js         # Redis operations
│   ├── admin.js         # Admin interface handlers
│   ├── logging.js       # Telemetry and logging
│   └── pages/           # HTML templates
│       ├── admin.html
│       ├── queue.html   # Default waiting room
│       └── queue-*.html # Custom waiting rooms
├── global_config.json   # Global config template
├── queue-config.json    # Queue config template
├── package.json         # Dependencies
├── fastly.toml          # Fastly configuration
└── keyGen.sh            # Key generation script

```

### Build Process

```bash
npm run build  # Compiles src/index.js → bin/main.wasm using js-compute-runtime
```

The build uses AOT (Ahead-of-Time) compilation for optimal performance.

### Debugging

Enable debug mode:
1. Set `forceDebug: true` in global config, or
2. Send `Fastly-Debug` header with request

Debug output includes:
- Request routing decisions (`src/index.js:46`)
- Token validation timing (`src/index.js:127`)
- Redis operation count and timing (`src/index.js:259`)
- Queue logic decisions

### Performance Optimization

- **Token Algorithms**: RS256 takes ~0.5-2ms, ES256 is faster
- **Redis Operations**: Tracked and counted for billing estimates
- **AOT Compilation**: Faster startup than JIT
- **Edge Execution**: Sub-millisecond latency from user location

## TODO / Roadmap

- [ ] Create new queues from admin interface
- [ ] Manage global whitelist via admin UI
- [ ] Add queue-specific whitelists
- [ ] Refactor debug and system logging globally
- [ ] Improve admin authentication (OAuth2/OIDC)
- [ ] Add Prometheus metrics endpoint
- [ ] Support for dark mode in waiting room
- [ ] A/B testing for queue messaging
- [ ] Priority queue lanes (VIP access)
- [ ] Waiting room customization UI

## Dependencies

| Package | Purpose |
|---------|---------|
| `@fastly/js-compute` | Fastly Compute runtime |
| `@upstash/redis` | Redis client for Fastly Compute |
| `jose` | JWT signing and verification |
| `uuid` | UUID v7 generation |
| `base-64` | Basic auth encoding |

## Contributing

When contributing:
1. Test locally with `npm start`
2. Ensure debug mode works correctly
3. Document configuration changes
4. Update this README for architectural changes

## License

See LICENSE file for details.

## Security Issues

Please see [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.

## Resources

- [Fastly Compute Documentation](https://developer.fastly.com/learning/compute/)
- [Upstash Redis Documentation](https://docs.upstash.com/redis)
- [JOSE JWT Library](https://github.com/panva/jose)
- [Fastly CLI](https://developer.fastly.com/learning/tools/cli)
