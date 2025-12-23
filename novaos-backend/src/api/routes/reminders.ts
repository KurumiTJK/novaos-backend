// ═══════════════════════════════════════════════════════════════════════════════
// REMINDER ROUTES — Reminder Configuration Management
// NovaOS API Layer — Phase 14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoints:
//   GET    /reminders/config    Get reminder configuration
//   PATCH  /reminders/config    Update reminder configuration
//   POST   /reminders/pause     Pause reminders until a date
//   POST   /reminders/resume    Resume paused reminders
//   GET    /reminders/status    Get current reminder status
//
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, type Response } from 'express';
import { auth, type AuthenticatedRequest } from '../../auth/index.js';
import { getLogger } from '../../logging/index.js';

// Middleware
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';

// Schemas
import {
  UpdateReminderConfigSchema,
  PauseRemindersSchema,
} from '../schemas/index.js';

// ─────────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────────

const logger = getLogger({ component: 'reminder-routes' });

// ─────────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Default reminder configuration for new users.
 */
const DEFAULT_REMINDER_CONFIG = {
  enabled: true,
  schedule: {
    time: '09:00',
    timezone: 'America/New_York',
    activeDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const,
  },
  channels: ['push', 'in_app'] as const,
  escalation: {
    enabled: true,
    maxEscalations: 3,
    levels: [
      { delayMinutes: 30, message: 'Just a gentle reminder about your spark!' },
      { delayMinutes: 60, message: 'Your spark is still waiting for you.' },
      { delayMinutes: 120, message: 'Last reminder for today\'s spark.' },
    ],
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
  pausedUntil: null,
};

// ─────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get reminder service if available.
 * Returns null if reminder service is not configured.
 */
async function getReminderService() {
  try {
    const { getReminderService: getService } = await import('../../core/sword/index.js');
    return getService();
  } catch {
    return null;
  }
}

/**
 * Get user's reminder config from store or return default.
 */
async function getUserReminderConfig(userId: string) {
  const service = await getReminderService();
  
  if (service) {
    const config = await service.getUserConfig(userId);
    if (config) return config;
  }
  
  // Return default config if service unavailable or no config exists
  return { ...DEFAULT_REMINDER_CONFIG };
}

/**
 * Save user's reminder config.
 */
async function saveUserReminderConfig(userId: string, config: typeof DEFAULT_REMINDER_CONFIG) {
  const service = await getReminderService();
  
  if (service) {
    await service.setUserConfig(userId, config);
  }
  
  // If no service, config is ephemeral (not persisted)
  return config;
}

// ─────────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────────

export function createReminderRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET REMINDER CONFIG
  // GET /reminders/config
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/config',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      const config = await getUserReminderConfig(userId);
      
      res.json({
        config,
        _links: {
          self: '/api/v1/reminders/config',
          pause: '/api/v1/reminders/pause',
          resume: '/api/v1/reminders/resume',
          status: '/api/v1/reminders/status',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // UPDATE REMINDER CONFIG
  // PATCH /reminders/config
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.patch(
    '/config',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate request body
      const parseResult = UpdateReminderConfigSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', '),
          { fields: parseResult.error.flatten().fieldErrors }
        );
      }
      
      const updates = parseResult.data;
      
      logger.info('Updating reminder config', {
        userId,
        fields: Object.keys(updates),
        requestId: req.requestId,
      });
      
      // Get current config
      const currentConfig = await getUserReminderConfig(userId);
      
      // Merge updates
      const newConfig = {
        ...currentConfig,
        ...updates,
        schedule: updates.schedule
          ? { ...currentConfig.schedule, ...updates.schedule }
          : currentConfig.schedule,
        escalation: updates.escalation
          ? { ...currentConfig.escalation, ...updates.escalation }
          : currentConfig.escalation,
        quietHours: updates.quietHours
          ? { ...currentConfig.quietHours, ...updates.quietHours }
          : currentConfig.quietHours,
      };
      
      // Save updated config
      const savedConfig = await saveUserReminderConfig(userId, newConfig);
      
      res.json({
        config: savedConfig,
        updated: true,
        _links: {
          self: '/api/v1/reminders/config',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // PAUSE REMINDERS
  // POST /reminders/pause
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/pause',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      // Validate request body
      const parseResult = PauseRemindersSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.issues.map((i) => i.message).join(', ')
        );
      }
      
      const { until, reason } = parseResult.data;
      
      logger.info('Pausing reminders', {
        userId,
        until,
        reason,
        requestId: req.requestId,
      });
      
      // Update config with pause
      const currentConfig = await getUserReminderConfig(userId);
      const newConfig = {
        ...currentConfig,
        pausedUntil: until,
      };
      
      await saveUserReminderConfig(userId, newConfig);
      
      res.json({
        paused: true,
        pausedUntil: until,
        reason,
        _links: {
          self: '/api/v1/reminders/pause',
          resume: '/api/v1/reminders/resume',
          config: '/api/v1/reminders/config',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESUME REMINDERS
  // POST /reminders/resume
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.post(
    '/resume',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      logger.info('Resuming reminders', {
        userId,
        requestId: req.requestId,
      });
      
      // Update config to remove pause
      const currentConfig = await getUserReminderConfig(userId);
      const newConfig = {
        ...currentConfig,
        pausedUntil: null,
      };
      
      await saveUserReminderConfig(userId, newConfig);
      
      res.json({
        resumed: true,
        _links: {
          self: '/api/v1/reminders/resume',
          config: '/api/v1/reminders/config',
        },
      });
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET REMINDER STATUS
  // GET /reminders/status
  // ═══════════════════════════════════════════════════════════════════════════════
  
  router.get(
    '/status',
    auth.middleware(true),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.userId!;
      
      const config = await getUserReminderConfig(userId);
      const now = new Date();
      
      // Determine current status
      let status: 'active' | 'paused' | 'disabled' | 'quiet_hours';
      let reason: string | undefined;
      
      if (!config.enabled) {
        status = 'disabled';
        reason = 'Reminders are disabled';
      } else if (config.pausedUntil && new Date(config.pausedUntil) > now) {
        status = 'paused';
        reason = `Paused until ${config.pausedUntil}`;
      } else if (config.quietHours?.enabled) {
        // Check if currently in quiet hours
        const userTime = now.toLocaleTimeString('en-US', {
          hour12: false,
          timeZone: config.schedule.timezone,
          hour: '2-digit',
          minute: '2-digit',
        });
        
        const inQuietHours = isTimeInRange(
          userTime,
          config.quietHours.start,
          config.quietHours.end
        );
        
        if (inQuietHours) {
          status = 'quiet_hours';
          reason = `Quiet hours (${config.quietHours.start} - ${config.quietHours.end})`;
        } else {
          status = 'active';
        }
      } else {
        status = 'active';
      }
      
      // Get next scheduled reminder time
      const nextReminder = calculateNextReminder(config);
      
      res.json({
        status,
        reason,
        enabled: config.enabled,
        pausedUntil: config.pausedUntil,
        nextReminder,
        schedule: {
          time: config.schedule.time,
          timezone: config.schedule.timezone,
          activeDays: config.schedule.activeDays,
        },
        _links: {
          self: '/api/v1/reminders/status',
          config: '/api/v1/reminders/config',
        },
      });
    })
  );

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────────
// TIME UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Check if a time is within a range (handles overnight ranges).
 */
function isTimeInRange(time: string, start: string, end: string): boolean {
  const t = timeToMinutes(time);
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  
  if (s <= e) {
    // Normal range (e.g., 09:00 - 17:00)
    return t >= s && t <= e;
  } else {
    // Overnight range (e.g., 22:00 - 08:00)
    return t >= s || t <= e;
  }
}

/**
 * Convert HH:MM to minutes since midnight.
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Calculate the next scheduled reminder time.
 */
function calculateNextReminder(config: typeof DEFAULT_REMINDER_CONFIG): string | null {
  if (!config.enabled) return null;
  if (config.pausedUntil && new Date(config.pausedUntil) > new Date()) {
    return config.pausedUntil;
  }
  
  const now = new Date();
  const [hours, minutes] = config.schedule.time.split(':').map(Number);
  
  // Map day names to day numbers (0 = Sunday)
  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  
  const activeDayNumbers = config.schedule.activeDays.map((d) => dayMap[d] ?? 0);
  
  // Find next active day
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + i);
    candidate.setHours(hours ?? 9, minutes ?? 0, 0, 0);
    
    if (activeDayNumbers.includes(candidate.getDay())) {
      if (candidate > now) {
        return candidate.toISOString();
      }
    }
  }
  
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────────

export default createReminderRouter;
