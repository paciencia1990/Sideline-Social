import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SquadSportPicker } from '@/components/SquadSportPicker';
import { getSquadSportTranslationKey, type SquadSportId } from '@/constants/sports';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { updateSquadSports, type SquadSportsUpdate } from '@/services/squadService';

export function SquadSportsEditor({ squadId, sportIds, sportsRevision, disabled, onSaved, onReload }: {
  squadId: string;
  sportIds: SquadSportId[];
  sportsRevision: number;
  disabled?: boolean;
  onSaved: (result: SquadSportsUpdate) => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sportIds);
  const [revision, setRevision] = useState(sportsRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const request = useRef(0);
  const identity = `${user?.uid ?? ''}:${squadId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    request.current += 1;
    pending.current = false;
    setEditing(false);
    setBusy(false);
    setError('');
    setSaved(false);
    return () => { request.current += 1; };
  }, [identity]);

  const save = async () => {
    if (pending.current || disabled || !draft.length || !user?.uid) return;
    pending.current = true;
    const currentRequest = ++request.current;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const result = await updateSquadSports(squadId, draft, revision);
      if (currentRequest !== request.current || identityRef.current !== identity) return;
      onSaved(result);
      setEditing(false);
      setSaved(true);
    } catch (nextError) {
      if (currentRequest !== request.current || identityRef.current !== identity) return;
      const code = nextError && typeof nextError === 'object' && 'code' in nextError ? String(nextError.code) : '';
      setError(code === 'functions/aborted' ? 'squadSports.conflict' : 'squadSports.error');
    } finally {
      if (currentRequest === request.current && identityRef.current === identity) {
        pending.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>{t('squadSports.title')}</Text>
      {editing ? (
        <>
          <Text style={styles.body}>{t('squadSports.help')}</Text>
          <SquadSportPicker disabled={busy || disabled} selected={draft} onChange={setDraft} />
          {!draft.length ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t('squadSports.required')}</Text> : null}
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{t(error)}</Text> : null}
          {error === 'squadSports.conflict' ? <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { setEditing(false); setError(''); onReload(); }} style={styles.action}><Text style={styles.actionText}>{t('squadSports.reload')}</Text></TouchableOpacity> : null}
          <PrimaryButton disabled={busy || disabled || !draft.length} loading={busy} onPress={() => void save()} title={t('squadSports.save')} />
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { setEditing(false); setError(''); }} style={styles.action}><Text style={styles.actionText}>{t('common.cancel')}</Text></TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.body}>{sportIds.map((id) => t(getSquadSportTranslationKey(id))).join(' · ')}</Text>
          <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={() => { setDraft([...sportIds]); setRevision(sportsRevision); setEditing(true); setSaved(false); setError(''); }} style={styles.action}><Text style={styles.actionText}>{t('squadSports.edit')}</Text></TouchableOpacity>
          {saved ? <Text accessibilityLiveRegion="polite" style={styles.body}>{t('squadSports.saved')}</Text> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  title: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  error: { color: Colors.primary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  action: { minHeight: 48, justifyContent: 'center' },
  actionText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
});
