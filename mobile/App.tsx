/**
 * ONEPASS on a phone.
 *
 * Scope, chosen deliberately: sign in, and show the pass. Not a second copy of
 * the consumer web app.
 *
 * The web app is already an installable PWA — it has a manifest, a service
 * worker and an offline pass — so a native client that re-implemented deals,
 * receipts, warranties and bookings would be twenty screens of duplicate
 * surface, a second set of bugs, and a second thing to keep in step with every
 * API change. The one thing a browser genuinely cannot do is hold a credential
 * against a contactless reader, and that is what a native client is for. So this
 * is the pass, and the sign-in that gets you to it.
 *
 * NFC is not implemented and is not claimed. `expo-nfc` is not installed, no
 * native module is registered, and nothing in this file pretends a tap happened.
 * That seam is named in the README rather than stubbed, because a stub that
 * reports success is worse than an absence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, OnepassError, type MintedPass, type Me } from './src/api';
import { PassQr } from './src/qr';

const C = {
  ground: '#edf1ef',
  surface: '#ffffff',
  ink: '#0b211e',
  muted: '#6f8480',
  line: '#d6dfdc',
  accent: '#007253',
  accentInk: '#ffffff',
  warn: '#8f6100',
  warnSoft: '#f8efda',
};

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setChecking(false));
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      {checking ? (
        <View style={styles.centre}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : me ? (
        <PassScreen me={me} onSignOut={() => setMe(null)} />
      ) : (
        <SignIn onSignedIn={setMe} error={error} setError={setError} />
      )}
    </SafeAreaView>
  );
}

function SignIn({
  onSignedIn,
  error,
  setError,
}: {
  onSignedIn: (me: Me) => void;
  error: string | null;
  setError: (v: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.signIn(email.trim(), password);
      onSignedIn(await api.me());
    } catch (e) {
      // The API's own sentence, not one invented here — it is deliberately the
      // same for a wrong password and an unknown address.
      setError(e instanceof OnepassError ? e.message : 'Could not reach ONEPASS.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Text style={styles.brand}>
        ONE<Text style={{ color: C.accent }}>PASS</Text>
      </Text>
      <Text style={styles.h1}>Sign in</Text>
      <Text style={styles.lede}>One identity across every ONEPASS partner.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.in"
          placeholderTextColor={C.muted}
          accessibilityLabel="Email"
        />

        <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          accessibilityLabel="Password"
        />

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy || !email || !password}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.button,
            (busy || !email || !password) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>
      </View>

      <Text style={styles.foot}>Connected to {api.baseUrl}</Text>
    </ScrollView>
  );
}

function PassScreen({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [pass, setPass] = useState<MintedPass | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const mint = useCallback(async () => {
    try {
      const minted = await api.pass();
      setPass(minted);
      setLeft(minted.expiresInSeconds);
      setError(null);
    } catch (e) {
      setError(e instanceof OnepassError ? e.message : 'Could not refresh your pass.');
    }
  }, []);

  useEffect(() => {
    void mint();
  }, [mint]);

  // One interval for the countdown; a re-mint is triggered when it runs out
  // rather than on a second timer that could drift away from the first.
  useEffect(() => {
    timer.current = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          void mint();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [mint]);

  const name = me.profile?.displayName ?? me.user.email ?? 'Your pass';

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <View style={styles.row}>
        <Text style={styles.brand}>
          ONE<Text style={{ color: C.accent }}>PASS</Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            await api.signOut().catch(() => undefined);
            onSignOut();
          }}
        >
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.h1}>{name}</Text>
      <Text style={styles.lede}>Show this at any counter. It changes every minute.</Text>

      <View style={[styles.card, { alignItems: 'center' }]}>
        {pass ? (
          <>
            <PassQr value={pass.token} />
            <Text style={styles.ref}>{pass.passRef}</Text>
            <Text style={styles.countdown}>
              {left > 0 ? `Refreshes in ${left}s` : 'Refreshing…'}
            </Text>
          </>
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <ActivityIndicator color={C.accent} />
        )}
      </View>

      <View style={styles.note}>
        <Text style={styles.noteText}>
          The code carries a reference and a time-based code — never your name, and never anything a
          photograph of this screen would still be worth in a minute.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pad: { padding: 20, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 17, fontWeight: '800', color: C.ink, letterSpacing: 0.4 },
  link: { color: C.accent, fontWeight: '600', fontSize: 14 },
  h1: { fontSize: 30, fontWeight: '800', color: C.ink, marginTop: 22, letterSpacing: -0.5 },
  lede: { fontSize: 15, color: C.muted, marginTop: 6, lineHeight: 21 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    padding: 20,
    marginTop: 22,
  },
  label: { fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.ink,
    backgroundColor: C.surface,
    minHeight: 46,
  },
  button: {
    backgroundColor: C.accent,
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: C.accentInk, fontWeight: '700', fontSize: 15 },
  errorBox: {
    backgroundColor: C.warnSoft,
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  errorText: { color: C.warn, fontSize: 13.5, lineHeight: 19 },
  ref: { marginTop: 14, fontSize: 13, color: C.muted, letterSpacing: 1 },
  countdown: { marginTop: 4, fontSize: 13, color: C.ink, fontWeight: '600' },
  note: { marginTop: 18, paddingHorizontal: 4 },
  noteText: { color: C.muted, fontSize: 13, lineHeight: 19 },
  foot: { marginTop: 24, color: C.muted, fontSize: 12, textAlign: 'center' },
});
