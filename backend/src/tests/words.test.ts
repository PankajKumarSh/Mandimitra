import { describe, expect, it } from 'vitest';
import { amountInWords } from '../utils/words.ts';

describe('amount in words (Indian system)', () => {
  it.each([
    ['0', 'Rupees Zero Only', 'शून्य रुपये मात्र'],
    ['1', 'Rupees One Only', 'एक रुपये मात्र'],
    ['15', 'Rupees Fifteen Only', 'पंद्रह रुपये मात्र'],
    ['99', 'Rupees Ninety Nine Only', 'निन्यानवे रुपये मात्र'],
    ['100', 'Rupees One Hundred Only', 'एक सौ रुपये मात्र'],
    ['1005', 'Rupees One Thousand Five Only', 'एक हज़ार पाँच रुपये मात्र'],
    ['24275', 'Rupees Twenty Four Thousand Two Hundred Seventy Five Only', 'चौबीस हज़ार दो सौ पचहत्तर रुपये मात्र'],
    ['121375', 'Rupees One Lakh Twenty One Thousand Three Hundred Seventy Five Only', 'एक लाख इक्कीस हज़ार तीन सौ पचहत्तर रुपये मात्र'],
    ['10000000', 'Rupees One Crore Only', 'एक करोड़ रुपये मात्र'],
    ['123456789.50', 'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and Fifty Paise Only', 'बारह करोड़ चौंतीस लाख छप्पन हज़ार सात सौ नवासी रुपये और पचास पैसे मात्र'],
    ['0.05', 'Rupees Zero and Five Paise Only', 'शून्य रुपये और पाँच पैसे मात्र'],
  ])('%s', (amount, en, hi) => {
    expect(amountInWords(amount, 'en')).toBe(en);
    expect(amountInWords(amount, 'hi')).toBe(hi);
  });

  it('handles crore beyond 99 crore', () => {
    expect(amountInWords('9999999999.99', 'en')).toBe('Rupees Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only');
  });

  it('rejects malformed input', () => {
    expect(() => amountInWords('12.345', 'en')).toThrow();
    expect(() => amountInWords('abc', 'hi')).toThrow();
  });
});
