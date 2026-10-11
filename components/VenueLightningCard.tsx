import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CloudLightning, ExternalLink } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/Card';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { openVenueLightningStatus } from '@/services/venueLightningService';
import { resolveVenueLightningSource, type VenueLightningBinding } from '@/utils/venueLightning';

type Props = VenueLightningBinding & { context?: 'squad' | 'team' };

export function VenueLightningCard({ venueId, squadId, context = 'squad' }: Props) {
  const { t } = useTranslation();
  const source = resolveVenueLightningSource({ venueId, squadId });
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingRef = useRef(false);
  const generationRef = useRef(0);
  const bindingKey = `${venueId ?? ''}|${squadId ?? ''}|${source?.id ?? ''}`;
  const currentBindingRef = useRef(bindingKey);
  currentBindingRef.current = bindingKey;

  useEffect(() => {
    generationRef.current += 1;
    pendingRef.current = false;
    setOpening(false);
    setFailed(false);
    return () => { generationRef.current += 1; };
  }, [bindingKey]);

  const openStatus = async () => {
    if (!source || pendingRef.current) return;
    pendingRef.current = true;
    const generation = generationRef.current;
    const requestBinding = bindingKey;
    const isCurrent = () => generationRef.current === generation &&
      currentBindingRef.current === requestBinding;
    setOpening(true);
    setFailed(false);
    try {
      await openVenueLightningStatus({ venueId, squadId });
    } catch {
      // Never display raw browser errors, URLs, or stale weather as a safe status.
      if (isCurrent()) setFailed(true);
    } finally {
      if (isCurrent()) {
        pendingRef.current = false;
        setOpening(false);
      }
    }
  };

  if (!source) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.headingRow}>
        <CloudLightning color={Colors.textHeading} size={24} />
        <Text accessibilityRole="header" style={styles.title}>{t('venueLightning.title')}</Text>
      </View>
      <Text style={styles.venue}>{source.venueName}</Text>
      <Text style={styles.body}>{t('venueLightning.provider', { provider: source.providerName })}</Text>
      {context === 'team' ? <Text style={styles.body}>{t('venueLightning.teamVenueNote')}</Text> : null}
      <Text style={styles.body}>{t('venueLightning.safetyNote')}</Text>
      <TouchableOpacity
        accessibilityHint={t('venueLightning.openHint', { provider: source.providerName })}
        accessibilityLabel={t(failed ? 'venueLightning.retryForVenue' : 'venueLightning.openForVenue', { venue: source.venueName })}
        accessibilityRole="button"
        accessibilityState={{ busy: opening, disabled: opening }}
        activeOpacity={0.82}
        disabled={opening}
        onPress={() => { void openStatus(); }}
        style={styles.button}
      >
        {opening ? <ActivityIndicator color={Colors.surface} size="small" /> : <ExternalLink color={Colors.surface} size={18} />}
        <Text style={styles.buttonText}>{t(opening ? 'venueLightning.opening' : failed ? 'common.retry' : 'venueLightning.open')}</Text>
      </TouchableOpacity>
      {failed ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>{t('venueLightning.openError')}</Text> : null}
      <Text style={styles.help}>{t('venueLightning.connectionNote')}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderLeftColor: Colors.accentGold, borderLeftWidth: 4, gap: Spacing.sm },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.sm },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 18, lineHeight: 25 },
  venue: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16, lineHeight: 23 },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  button: { alignItems: 'center', backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center', minHeight: 52, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  buttonText: { color: Colors.surface, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, lineHeight: 21 },
  help: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
});
