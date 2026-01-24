import { describe, it, expect } from 'vitest';
import {
  LabelColorSchema,
  CreateLabelSchema,
  UpdateLabelSchema,
  LabelIdsSchema,
} from '../../../../src/api/schemas/labels';

describe('Label Schemas', () => {
  it('accepts valid colors', () => {
    expect(LabelColorSchema.safeParse('#ff00ff').success).toBe(true);
    expect(LabelColorSchema.safeParse('rgb(255, 0, 0)').success).toBe(true);
    expect(LabelColorSchema.safeParse('hsl(120, 50%, 50%)').success).toBe(true);
    expect(LabelColorSchema.safeParse('blue').success).toBe(true);
  });

  it('rejects invalid colors', () => {
    expect(LabelColorSchema.safeParse('not-a-color').success).toBe(false);
    expect(LabelColorSchema.safeParse('#ggg').success).toBe(false);
  });

  it('validates create label payload', () => {
    const result = CreateLabelSchema.safeParse({ name: 'Test', color: '#123456' });
    expect(result.success).toBe(true);
  });

  it('validates update label payload', () => {
    const result = UpdateLabelSchema.safeParse({ name: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('requires at least one label id', () => {
    const result = LabelIdsSchema.safeParse({ labelIds: [] });
    expect(result.success).toBe(false);
  });
});
