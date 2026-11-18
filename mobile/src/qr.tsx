/**
 * The pass QR, drawn from the canonical encoder.
 *
 * `@onepass/pass` is a file dependency on the same package the web app uses, so
 * there is exactly one QR implementation in this repository. A React Native QR
 * library would have been a second encoder producing a second set of bugs, and
 * the audit's rule about one canonical source per capability applies to a
 * matrix of black squares as much as to a wallet.
 *
 * Imported from the `/qr` subpath rather than the package root: the root barrel
 * also re-exports the TOTP helpers, which import `node:crypto` and belong on a
 * server. The encoder itself has no dependencies at all, which is why it is the
 * half that can cross to a phone.
 *
 * The matrix is rendered as rows of Views rather than an SVG or a canvas: at
 * these module counts it is a few hundred elements, it needs no native module,
 * and it is exact — no anti-aliasing to blur a module edge under a scanner.
 */
import { View } from 'react-native';
import { encode as encodeQr } from '@onepass/pass/qr';

export function PassQr({ value, size = 260 }: { value: string; size?: number }) {
  const matrix = encodeQr(value) as boolean[][];
  const modules = matrix.length;
  // A quiet zone is part of the spec, not decoration — scanners need it.
  const quiet = 4;
  const total = modules + quiet * 2;
  const cell = Math.floor((size / total) * 100) / 100;
  const side = cell * total;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Your ONEPASS code"
      style={{ width: side, height: side, backgroundColor: '#ffffff', padding: cell * quiet }}
    >
      {matrix.map((row, y) => (
        <View key={y} style={{ flexDirection: 'row', height: cell }}>
          {row.map((dark, x) => (
            <View
              key={x}
              style={{ width: cell, height: cell, backgroundColor: dark ? '#0b211e' : '#ffffff' }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
