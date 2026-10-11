import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { openApprovedLightningMessageUrl } from '@/services/venueLightningService';
import { getLightningMessageSegments } from '@/utils/weatherDelayLightning';

type Props = { body: string; style?: StyleProp<TextStyle> };

export function AnnouncementBody({ body, style }: Props) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const currentBody = useRef(body);
  currentBody.current = body;

  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setOpening(false);
    setFailedUrl(null);
    return () => { generation.current += 1; };
  }, [body]);

  const openLink = async (url: string) => {
    if (pending.current) return;
    pending.current = true;
    const requestGeneration = generation.current;
    const requestBody = body;
    const isCurrent = () => generation.current === requestGeneration && currentBody.current === requestBody;
    setOpening(true);
    setFailedUrl(null);
    try {
      await openApprovedLightningMessageUrl(url);
    } catch {
      if (isCurrent()) setFailedUrl(url);
    } finally {
      if (isCurrent()) {
        pending.current = false;
        setOpening(false);
      }
    }
  };

  return (
    <View>
      <Text style={style}>
        {getLightningMessageSegments(body).map((segment, index) => segment.source ? (
          <Text
            accessibilityHint={t('venueLightning.openHint', { provider: segment.source.providerName })}
            accessibilityLabel={t('venueLightning.openForVenue', { venue: segment.source.venueName })}
            accessibilityRole="link"
            accessibilityState={{ busy: opening, disabled: opening }}
            key={index}
            onPress={opening ? undefined : () => { void openLink(segment.text); }}
            style={styles.link}
          >{segment.text}</Text>
        ) : segment.text)}
      </Text>
      {opening ? <Text accessibilityLiveRegion="polite" style={styles.status}>{t('venueLightning.opening')}</Text> : null}
      {failedUrl ? (
        <View style={styles.errorPanel}>
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>{t('venueLightning.openError')}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => { void openLink(failedUrl); }} style={styles.retry}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { color: Colors.communicationLink, textDecorationLine: 'underline' },
  status: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18, marginTop: Spacing.sm },
  errorPanel: { gap: Spacing.sm, marginTop: Spacing.sm },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 20 },
  retry: { alignItems: 'center', alignSelf: 'flex-start', borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: Spacing.md },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
});
