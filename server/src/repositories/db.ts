/**
 * Database gateway for non-repository modules.
 *
 * Transitional import target used while migrating route/service code
 * toward explicit repository methods.
 */

import prisma from '../models/prisma';

export const db = prisma;
export default db;
