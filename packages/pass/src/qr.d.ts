/** Verified QR encoder — ISO/IEC 18004 byte mode, versions 1-10. Returns a square
 *  boolean matrix where true is a dark module. See test/qr.test.js for the proof. */
export function encode(text: string, level?: 'L' | 'M' | 'Q' | 'H'): boolean[][];
