import { describe, expect, it } from 'vitest';
import { formatMobile, formatMoney, formatQuintals, groupIndian, isNegative, isPositive } from './format.ts';

describe('Indian money formatting (string-exact, no floats)', () => {
  it.each([
    ['0', '₹0.00'],
    ['5', '₹5.00'],
    ['999', '₹999.00'],
    ['1000', '₹1,000.00'],
    ['100000', '₹1,00,000.00'],
    ['1234567.5', '₹12,34,567.50'],
    ['15000.05', '₹15,000.05'],
    ['-2000', '−₹2,000.00'],
    ['-0', '₹0.00'],
    // Beyond float precision: 999,99,99,99,999.99 must survive exactly.
    ['999999999999.99', '₹9,99,99,99,99,999.99'],
  ])('%s → %s', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it('rounds half-up to the rupee only when asked, without floats', () => {
    expect(formatMoney('1999.50', { decimals: 0 })).toBe('₹2,000');
    expect(formatMoney('99999.49', { decimals: 0 })).toBe('₹99,999');
    expect(formatMoney('999.5', { decimals: 0, symbol: false })).toBe('1,000');
  });

  it('handles empty values', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('')).toBe('—');
  });

  it('groups digits', () => {
    expect(groupIndian('12345678')).toBe('1,23,45,678');
  });
});

describe('weights and misc', () => {
  it('converts kg to quintals by string shift', () => {
    expect(formatQuintals('125050.5', 'q')).toBe('1,250.50 q');
    expect(formatQuintals('99', 'q')).toBe('0.99 q');
    expect(formatQuintals('5000', 'q')).toBe('50.00 q');
  });
  it('formats mobiles', () => {
    expect(formatMobile('+919812345678')).toBe('98123 45678');
  });
  it('detects sign', () => {
    expect(isNegative('-3000')).toBe(true);
    expect(isNegative('-0.00')).toBe(false);
    expect(isPositive('0')).toBe(false);
    expect(isPositive('0.01')).toBe(true);
  });
});
