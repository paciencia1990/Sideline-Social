import { Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Colors, Spacing, Typography } from '@/constants/theme';
import type { useCoachAiAccess } from '@/hooks/useCoachAiAccess';

export function CoachAiBillingSummary({ access }: { access: ReturnType<typeof useCoachAiAccess> }) {
  const { t, i18n } = useTranslation();
  if (!access.billing.enabled || access.entitlementSource === 'tester-claim') return null;
  const status = access.billing.status;
  return <View style={{ gap: Spacing.sm }}>
    <Text accessibilityLiveRegion="polite" style={{ color: Colors.textPrimary, fontFamily: Typography.bodyRegular }}>
      {access.billing.availability !== 'ready' ? t(`coachAiBilling.availability.${access.billing.availability}`)
        : status?.entitled ? t('coachAiBilling.usage', { count: status.remaining, date: status.resetsAtMs ? new Date(status.resetsAtMs).toLocaleString(i18n.language) : '' })
          : t('coachAiBilling.subscribeHint')}
    </Text>
    {status?.pending ? <Text style={{ color: Colors.textPrimary }}>{t('coachAiBilling.pendingUsage', { count: status.pending })}</Text> : null}
    <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/coach/resources/subscription' as never)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: Colors.primary, fontFamily: Typography.bodySemiBold }}>{t(status?.entitled ? 'coachAiBilling.manage' : 'coachAiBilling.viewPlans')}</Text>
    </TouchableOpacity>
  </View>;
}
