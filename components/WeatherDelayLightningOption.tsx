import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, CloudLightning } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { resolveVenueLightningSource, type VenueLightningBinding } from '@/utils/venueLightning';

type Props = VenueLightningBinding & { checked: boolean; onChange: (checked: boolean) => void };

export function WeatherDelayLightningOption({ venueId, squadId, checked, onChange }: Props) {
  const { t } = useTranslation();
  const source = resolveVenueLightningSource({ venueId, squadId });
  if (!source) return null;

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <CloudLightning accessible={false} color={Colors.textHeading} size={20} />
        <Text accessibilityRole="header" style={styles.title}>{t('venueLightning.messageOptionTitle')}</Text>
      </View>
      <Text style={styles.body}>{t('venueLightning.messageOptionHelp', { venue: source.venueName })}</Text>
      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityLabel={t('venueLightning.messageVenueConfirmation', { venue: source.venueName })}
        accessibilityState={{ checked }}
        activeOpacity={0.82}
        onPress={() => onChange(!checked)}
        style={styles.option}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <Check accessible={false} color={Colors.surface} size={19} /> : null}
        </View>
        <Text style={styles.optionText}>{t('venueLightning.messageVenueConfirmation', { venue: source.venueName })}</Text>
      </TouchableOpacity>
      {checked ? (
        <View accessibilityLiveRegion="polite" style={styles.preview}>
          <Text style={styles.title}>{t('venueLightning.messageLink', { venue: source.venueName })}</Text>
          <Text selectable style={styles.url}>{source.url}</Text>
          <Text style={styles.body}>{t('venueLightning.messageSafety')}</Text>
          <Text style={styles.help}>{t('venueLightning.messageIncluded')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, gap: Spacing.sm, padding: Spacing.md },
  heading: { alignItems: 'center', flexDirection: 'row', gap: Spacing.sm },
  title: { color: Colors.textHeading, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, lineHeight: 21 },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 20 },
  option: { alignItems: 'center', flexDirection: 'row', gap: Spacing.sm, minHeight: 52, paddingVertical: Spacing.sm },
  optionText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, lineHeight: 21 },
  checkbox: { alignItems: 'center', borderColor: Colors.primary, borderRadius: 5, borderWidth: 2, height: 26, justifyContent: 'center', width: 26 },
  checkboxChecked: { backgroundColor: Colors.primary },
  preview: { borderTopColor: Colors.secondary, borderTopWidth: 1, gap: Spacing.sm, paddingTop: Spacing.md },
  url: { color: Colors.communicationLink, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 20 },
  help: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
});
