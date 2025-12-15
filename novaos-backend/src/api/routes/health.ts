// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH ROUTES — /health and /ready endpoints
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { storeManager } from '../../storage/index.js';
import { loadConfig, canVerify } from '../../config/index.js';
import { getLogger } from '../../logging/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────────

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    storage: ComponentHealth;
    memory: ComponentHealth;
  };
}

export interface ReadinessCheck {
  ready: boolean;
  timestamp: string;
  checks: {
    storage: boolean;
    config: boolean;
  };
}

interface ComponentHealth {
  status: 'up' | 'degraded' | 'down';
  latency?: number;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

async function checkStorage(): Promise<ComponentHealth> {
  const start = Date.now();
  
  try {
    const store = storeManager.getStore();
    
    // Simple ping test
    await store.set('health:ping', Date.now().toString(), 10);
    const result = await store.get('health:ping');
    
    if (!result) {
      return { status: 'degraded', message: 'Write succeeded but read failed' };
    }
    
    const latency = Date.now() - start;
    
    // Latency thresholds
    if (latency > 1000) {
      return { status: 'degraded', latency, message: 'High latency' };
    }
    
    return { status: 'up', latency };
  } catch (error) {
    return { 
      status: 'down', 
      message: error instanceof Error ? error.message : 'Storage check failed' 
    };
  }
}

function checkMemory(): ComponentHealth {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const usagePercent = (used.heapUsed / used.heapTotal) * 100;
  
  if (usagePercent > 90) {
    return { 
      status: 'degraded', 
      message: `High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)` 
    };
  }
  
  return { 
    status: 'up',
    message: `${heapUsedMB}MB / ${heapTotalMB}MB` 
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────────

export function createHealthRouter(): Router {
  const router = Router();
  const logger = getLogger({ component: 'health' });

  // ─── HEALTH CHECK (liveness) ───
  // Returns overall health status, used by load balancers
  router.get('/health', async (_req: Request, res: Response) => {
    const config = loadConfig();
    
    const [storageHealth, memoryHealth] = await Promise.all([
      checkStorage(),
      Promise.resolve(checkMemory()),
    ]);
    
    const allUp = storageHealth.status === 'up' && memoryHealth.status === 'up';
    const anyDown = storageHealth.status === 'down';
    
    const health: HealthCheck = {
      status: anyDown ? 'unhealthy' : (allUp ? 'healthy' : 'degraded'),
      timestamp: new Date().toISOString(),
      version: '10.0.0',
      uptime: process.uptime(),
      checks: {
        storage: storageHealth,
        memory: memoryHealth,
      },
    };
    
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    
    if (health.status !== 'healthy') {
      logger.warn('Health check degraded', { 
        status: health.status,
        storage: storageHealth.status,
        memory: memoryHealth.status,
      });
    }
    
    res.status(statusCode).json(health);
  });

  // ─── READINESS CHECK ───
  // Returns whether the service is ready to accept traffic
  router.get('/ready', async (_req: Request, res: Response) => {
    const storageHealth = await checkStorage();
    
    const ready: ReadinessCheck = {
      ready: storageHealth.status !== 'down',
      timestamp: new Date().toISOString(),
      checks: {
        storage: storageHealth.status !== 'down',
        config: true, // Config always loads
      },
    };
    
    const statusCode = ready.ready ? 200 : 503;
    
    if (!ready.ready) {
      logger.error('Readiness check failed', undefined, {
        storage: storageHealth.status,
        message: storageHealth.message,
      });
    }
    
    res.status(statusCode).json(ready);
  });

  // ─── DETAILED STATUS (authenticated) ───
  router.get('/status', async (_req: Request, res: Response) => {
    const config = loadConfig();
    
    const [storageHealth, memoryHealth] = await Promise.all([
      checkStorage(),
      Promise.resolve(checkMemory()),
    ]);
    
    const memUsage = process.memoryUsage();
    
    res.json({
      service: 'novaos-backend',
      version: '10.0.0',
      environment: config.env.environment,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      
      health: {
        storage: storageHealth,
        memory: memoryHealth,
      },
      
      features: {
        verification: canVerify(),
        webFetch: config.features.webFetchEnabled,
        auth: config.features.authRequired,
        debug: config.features.debugMode,
      },
      
      storage: {
        type: storeManager.isUsingRedis() ? 'redis' : 'memory',
      },
      
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      },
      
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
      },
    });
  });

  return router;
}
