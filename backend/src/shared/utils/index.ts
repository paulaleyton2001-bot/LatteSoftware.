/** Utilidades puras compartidas: dinero, fechas, códigos, aleatorios y JWT. */
export {
  MINOR_LIMIT,
  addMinor,
  allocateMinor,
  applyPercent,
  applyTaxBp,
  formatMinor,
  multiplyMinor,
  negateMinor,
  roundHalfUp,
  subtractMinor,
  type AllocationResult,
} from './money.js';

export {
  addDays,
  addMinutes,
  ceilDiffMinutes,
  diffMinutes,
  endOfDayUtc,
  localDateKey,
  localTimeKey,
  nowIso,
  overlaps,
  parseIso,
  startOfDayUtc,
  startOfMonthUtc,
  startOfNextMonthUtc,
  toIso,
} from './datetime.js';

export {
  DEFAULT_CODE_PAD,
  generateCode,
  generateCodeWithOptions,
  generateOrderNumber,
  generatePaymentNumber,
  generateRentalCode,
  generateReservationCode,
  type GenerateCodeOptions,
} from './codes.js';

export { randomToken, randomUuid, safeEqual, sha256Hex } from './random.js';

export {
  peekExpiryMs,
  signAccessToken,
  ttlToSeconds,
  verifyJwt,
  type JwtClaims,
  type VerifyOptions,
} from './jwt.js';
