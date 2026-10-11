import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useSquadWeather } from '@/hooks/useSquadWeather';
import { parseSquadWeatherLink } from '@/functions/src/squadWeatherCore';
import { updateSquadWeather, type SquadWeatherLink } from '@/services/squadWeatherService';
import { openSquadWeatherPreview } from '@/services/venueLightningService';
import { PrimaryButton } from '@/components/PrimaryButton';

const emptyDraft: SquadWeatherLink = { venueName: '', providerName: '', url: '', environment: 'outdoor' };
export function SquadWeatherEditor({ squadId, disabled = false }: { squadId: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const weather = useSquadWeather({ squadId });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [revision, setRevision] = useState(0);
  const [previewed, setPreviewed] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'save' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef(false), generation = useRef(0);
  const identity = `${user?.uid ?? ''}:${squadId}`;
  const current = useRef(identity); current.current = identity;
  useEffect(() => {
    generation.current += 1; pending.current = false;
    setEditing(false); setBusy(null); setError(''); setSaved(false); setConfirmed(false); setPreviewed('');
    return () => { generation.current += 1; };
  }, [identity]);
  const link = parseSquadWeatherLink(draft);
  const fingerprint = link ? JSON.stringify(link) : '';
  const change = (fields: Partial<SquadWeatherLink>) => { setDraft(value => ({ ...value, ...fields })); setPreviewed(''); setConfirmed(false); };
  const preview = async () => {
    if (pending.current || disabled || !link) return;
    const request = ++generation.current; pending.current = true; setBusy('preview'); setError('');
    try {
      await openSquadWeatherPreview(link.url);
      if (request === generation.current && current.current === identity) setPreviewed(fingerprint);
    } catch {
      if (request === generation.current && current.current === identity) setError('venueWeather.previewError');
    } finally {
      if (request === generation.current && current.current === identity) { pending.current = false; setBusy(null); }
    }
  };
  const mutate = async (next: SquadWeatherLink | null, expected: number) => {
    if (pending.current || disabled || !user?.uid) return;
    if (next && (!confirmed || previewed !== fingerprint)) return;
    pending.current = true; const request = ++generation.current;
    setBusy(next ? 'save' : 'remove'); setError(''); setSaved(false);
    try {
      await updateSquadWeather(squadId, next, expected, next !== null);
      if (request === generation.current && current.current === identity) { setEditing(false); setSaved(true); }
    } catch (failure) {
      if (request !== generation.current || current.current !== identity) return;
      const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : '';
      setError(code === 'functions/aborted' ? 'venueWeather.conflict' : 'venueWeather.saveError');
    } finally {
      if (request === generation.current && current.current === identity) { pending.current = false; setBusy(null); }
    }
  };
  const requiresReload = error === 'venueWeather.conflict' || error === 'venueWeather.saveError';
  const locked = disabled || Boolean(busy) || weather.loading;
  const action = (key: string, onPress: () => void, isDisabled = locked) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: isDisabled }} disabled={isDisabled} onPress={onPress} style={styles.action}>
      <Text style={styles.actionText}>{t(key)}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>{t('venueWeather.title')}</Text>
      {weather.loading && !weather.view ? <ActivityIndicator accessibilityLabel={t('venueWeather.loading')} color={Colors.primary} /> : null}
      {weather.failed ? <><Text accessibilityRole="alert" style={styles.error}>{t('venueWeather.loadError')}</Text>{action('common.retry', () => void weather.reload())}</> : null}
      {weather.view && !editing ? <>
        <Text style={styles.body}>{weather.source ? `${weather.source.venueName} · ${weather.source.providerName}` : t('venueWeather.none')}</Text>
        {weather.source ? <Text selectable style={styles.body}>{weather.source.url}</Text> : null}
        {action(weather.source ? 'venueWeather.edit' : 'venueWeather.add', () => {
          const source = weather.source;
          setDraft(source ? { venueName: source.venueName, providerName: source.providerName, url: source.url, environment: source.environment === 'both' ? 'both' : 'outdoor' } : { ...emptyDraft });
          setRevision(weather.view!.revision); setEditing(true); setError(''); setSaved(false); setPreviewed(''); setConfirmed(false);
        }, locked || requiresReload)}
        {weather.source ? action('venueWeather.remove', () => {
          const expected = weather.view!.revision;
          Alert.alert(t('venueWeather.removeTitle'), t('venueWeather.removeHelp'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('venueWeather.remove'), style: 'destructive', onPress: () => { if (current.current === identity) void mutate(null, expected); } },
          ]);
        }, locked || requiresReload) : null}
      </> : null}
      {editing ? <>
        <Text style={styles.body}>{t('venueWeather.help')}</Text>
        {(['venueName', 'providerName', 'url'] as const).map(field => <View key={field} style={styles.section}>
          <Text style={styles.label}>{t(`venueWeather.${field}`)}</Text>
          <TextInput accessibilityLabel={t(`venueWeather.${field}`)} autoCapitalize={field === 'url' ? 'none' : 'words'} autoCorrect={field !== 'url'}
            editable={!locked && !requiresReload} keyboardType={field === 'url' ? 'url' : 'default'} maxLength={field === 'url' ? 2048 : field === 'venueName' ? 120 : 80}
            value={draft[field]} onChangeText={value => change({ [field]: value })} style={styles.input} />
        </View>)}
        <Text style={styles.label}>{t('venueWeather.environment')}</Text>
        {(['outdoor', 'both'] as const).map(environment => <TouchableOpacity key={environment} accessibilityRole="radio" accessibilityState={{ selected: draft.environment === environment, disabled: locked || requiresReload }}
          disabled={locked || requiresReload} onPress={() => change({ environment })} style={styles.action}>
          <Text style={styles.actionText}>{draft.environment === environment ? '✓ ' : ''}{t(`venueWeather.${environment}`)}</Text>
        </TouchableOpacity>)}
        {!link ? <Text style={styles.body}>{t('venueWeather.validLink')}</Text> : null}
        {action(busy === 'preview' ? 'venueWeather.previewing' : 'venueWeather.preview', () => void preview(), locked || !link || requiresReload)}
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: confirmed, disabled: locked || !fingerprint || previewed !== fingerprint || requiresReload }}
          disabled={locked || !fingerprint || previewed !== fingerprint || requiresReload} onPress={() => setConfirmed(value => !value)} style={styles.action}>
          <Text style={styles.actionText}>{confirmed ? '☑ ' : '☐ '}{t('venueWeather.confirm')}</Text>
        </TouchableOpacity>
        <PrimaryButton title={t('venueWeather.save')} loading={busy === 'save'} disabled={locked || !confirmed || !fingerprint || previewed !== fingerprint || requiresReload} onPress={() => void mutate(link!, revision)} />
        {action('common.cancel', () => { setEditing(false); setError(''); })}
      </> : null}
      {error ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
      {requiresReload ? action('venueWeather.reload', () => { setEditing(false); setError(''); void weather.reload(); }) : null}
      {saved ? <Text accessibilityLiveRegion="polite" style={styles.body}>{t('venueWeather.saved')}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: Spacing.sm }, title: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 20 },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  input: { borderColor: Colors.secondary, borderWidth: 1, borderRadius: Radius.button, color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, minHeight: 48, padding: Spacing.sm },
  action: { minHeight: 48, justifyContent: 'center', paddingVertical: Spacing.sm }, actionText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, lineHeight: 21 },
  error: { color: Colors.primary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 20 },
});
