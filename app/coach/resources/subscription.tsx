import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PurchasesPackage } from 'react-native-purchases';
import { Card } from '@/components/Card';
import { CoachResourceHeader } from '@/components/CoachResourceHeader';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/config/legal';
import { useAuth } from '@/context/AuthContext';
import { useCoachAiAccess } from '@/hooks/useCoachAiAccess';
import {
  COACH_AI_TEST_RECOVERY_AVAILABLE, checkCoachAiPurchaseStatus, inspectCoachAiPurchase,
  resolveReviewedCoachAiPurchase, coachAiManagementUrl, getCoachAiPurchasePackages,
  purchaseCoachAi, restoreCoachAi,
} from '@/services/coachAiBillingService';
import { CoachAiPurchaseError, type CoachAiPurchaseDiagnostic } from '@/utils/coachAiPurchaseCore';
import { billingDiagnosticMessage, CoachAiBillingDiagnosticError, createBillingDiagnostic, type BillingDiagnostic } from '@/utils/coachAiBillingDiagnostics';
import type { CoachAiBillingPlan } from '@/types/coachAiBilling';

export default function CoachAiSubscriptionScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const access = useCoachAiAccess();
  const { status, enabled, eligible, availability, loading } = access.billing;
  const [packageState, setPackages] = useState<{ uid?: string; value: Partial<Record<CoachAiBillingPlan, PurchasesPackage>> }>({ value: {} });
  const [selected, setSelected] = useState<CoachAiBillingPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<{ uid?: string; value?: BillingDiagnostic }>({});
  const [purchaseState, setPurchaseState] = useState<{ uid?: string; value?: CoachAiPurchaseDiagnostic; loading: boolean; error: boolean }>({ loading: true, error: false });
  const [showDetails, setShowDetails] = useState(false);
  const [reviewReference, setReviewReference] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const planSession = useRef<{ uid?: string; active: boolean; started: boolean } | null>(null);
  const lock = useRef(false);
  const uid = user?.uid;
  const packages = packageState.uid === uid ? packageState.value : {};
  const diagnostic = planResult.uid === uid ? planResult.value : undefined;
  const purchaseDiagnostic = purchaseState.uid === uid ? purchaseState.value : undefined;
  const diagnosticMessage = diagnostic ? billingDiagnosticMessage(diagnostic) : null;
  const tester = access.entitlementSource === 'tester-claim';
  const localReady = purchaseState.uid === uid && !purchaseState.loading && !purchaseState.error && Boolean(purchaseDiagnostic);
  const purchaseBlocked = !localReady || Boolean(purchaseDiagnostic?.record.present)
    || ['payment_pending', 'verification_pending', 'uncertain', 'ownership_conflict', 'recovery_required'].includes(purchaseDiagnostic?.phase ?? '');
  const canShop = Boolean(eligible && availability === 'ready' && status?.enabled && !status.entitled && !tester && PRIVACY_POLICY_URL && TERMS_OF_USE_URL);
  // Preserve previously loaded cards during a same-account status check. Only a
  // fresh ready result enables actions; verified shutdown still hides the plans.
  const showPlans = Boolean(eligible && status?.enabled && !status.entitled && !tester && PRIVACY_POLICY_URL && TERMS_OF_USE_URL
    && (canShop || packages.monthly || packages.yearly));
  const reviewValid = /^[A-Za-z0-9_-]{8,128}$/.test(reviewReference);

  useEffect(() => {
    const session = { uid, active: true, started: false };
    planSession.current = session;
    lock.current = false; setBusy(false);
    setPackages({ uid, value: {} }); setSelected(null); setNotice(null);
    setPlanResult({ uid }); setShowDetails(false); setLoadingPlans(false);
    setReviewReference(''); setReviewConfirmed(false);
    setPurchaseState({ uid, loading: Boolean(uid), error: false });
    const isActive = () => session.active && planSession.current === session;
    // Local inspection remains available with billing off. It makes no status,
    // provider or store call and never starts checkout, restore or recovery.
    if (uid) void inspectCoachAiPurchase(uid, value => {
      if (isActive()) setPurchaseState({ uid, value, loading: false, error: false });
    }).then(value => {
      if (isActive()) setPurchaseState({ uid, value, loading: false, error: false });
    }).catch(() => {
      if (isActive()) setPurchaseState({ uid, loading: false, error: true });
    });
    return () => { session.active = false; };
  }, [uid]);

  useEffect(() => {
    const session = planSession.current;
    if (!canShop || !uid || !session?.active || session.uid !== uid || session.started) return;
    session.started = true;
    const isActive = () => session.active && planSession.current === session;
    setLoadingPlans(true);
    void getCoachAiPurchasePackages(uid, value => {
      if (isActive()) setPlanResult({ uid, value });
    }, isActive).then(value => {
      if (isActive()) setPackages({ uid, value });
    }).catch(error => {
      if (isActive()) setPlanResult({ uid, value: error instanceof CoachAiBillingDiagnosticError
        ? error.diagnostic : createBillingDiagnostic('offerings').fail(error).diagnostic });
    }).finally(() => { if (isActive()) setLoadingPlans(false); });
    // One plan attempt per screen/account. Status refresh and locale changes
    // preserve its result; they do not repeat a failed SDK request.
  }, [canShop, uid]);

  async function perform(action: 'buy' | 'restore' | 'check' | 'inspect' | 'resolve') {
    const session = planSession.current;
    if (lock.current || !uid || !session?.active || session.uid !== uid) return;
    if (action === 'buy' && (!canShop || purchaseBlocked || !selected || !packages[selected])) return;
    if (action === 'restore' && availability !== 'ready') return;
    if (action === 'check' && (!enabled || !eligible || loading)) return;
    if (action === 'resolve' && (!COACH_AI_TEST_RECOVERY_AVAILABLE || !eligible || !reviewConfirmed || !reviewValid || !purchaseDiagnostic?.record.present)) return;
    const isCurrent = () => session.active && planSession.current === session;
    let latest = purchaseDiagnostic;
    const publish = (value: CoachAiPurchaseDiagnostic) => {
      latest = value;
      if (isCurrent()) setPurchaseState({ uid, value, loading: false, error: false });
    };
    lock.current = true; setBusy(true); setNotice(null);
    try {
      if (action === 'inspect' || action === 'resolve') {
        const value = action === 'inspect' ? await inspectCoachAiPurchase(uid, publish)
          : await resolveReviewedCoachAiPurchase(uid, reviewReference, publish);
        if (!isCurrent()) return;
        publish(value);
        setNotice(t(`coachAiBilling.purchaseRecovery.${action === 'resolve' ? 'resolved' : value.record.present ? 'required' : 'clear'}`));
        if (action === 'resolve') { setReviewReference(''); setReviewConfirmed(false); }
      } else {
        const result = action === 'buy' ? await purchaseCoachAi(uid, selected!, packages[selected!]!, publish)
          : action === 'restore' ? await restoreCoachAi(uid, publish) : await checkCoachAiPurchaseStatus(uid, publish);
        if (!isCurrent()) return;
        setNotice(t(result.entitled ? 'coachAiBilling.success' : latest?.record.present
          ? 'coachAiBilling.purchaseRecovery.required' : action === 'check'
            ? 'coachAiBilling.purchaseRecovery.noActivePurchase' : 'coachAiBilling.nothingToRestore'));
      }
    } catch (error) {
      if (isCurrent()) {
        if (action === 'inspect') setPurchaseState(previous => ({ ...previous, uid, loading: false, error: true }));
        setNotice(t(action === 'inspect' ? 'coachAiBilling.purchaseRecovery.inspectionError'
          : `coachAiBilling.errors.${error instanceof CoachAiPurchaseError ? error.kind : 'unavailable'}`));
      }
    } finally { if (isCurrent()) { lock.current = false; setBusy(false); } }
  }
  async function open(url: string | null) {
    if (!url) { setNotice(t('coachAiBilling.linkError')); return; }
    try { await Linking.openURL(url); } catch { setNotice(t('coachAiBilling.linkError')); }
  }
  const managedUrl = coachAiManagementUrl(status?.store ?? null);
  const chosen = selected ? packages[selected] : null;
  const buyDisabled = busy || !canShop || purchaseBlocked || !chosen;
  const reviewDisabled = busy || !reviewConfirmed || !reviewValid;
  return <ScreenWrapper><ScrollView contentContainerStyle={styles.content}>
    <CoachResourceHeader title={t('coachAiBilling.title')} subtitle={t('coachAiBilling.subtitle')} />
    <Card><Text style={styles.body}>{t('coachAiBilling.included')}</Text><Text style={styles.body}>{t('coachAiBilling.resetPolicy')}</Text><Text style={styles.body}>{t('coachAiBilling.savedGuides')}</Text></Card>
    {tester ? <Text style={styles.body}>{t('coachAiBilling.betaFree')}</Text> : null}
    {loading ? <ActivityIndicator color={Colors.primary} /> : null}
    {availability !== 'ready' ? <Text accessibilityLiveRegion="polite" style={styles.body}>{t(`coachAiBilling.availability.${availability}`)}</Text> : null}
    {status?.entitled ? <Card>
      <Text style={styles.heading}>{t(`coachAiBilling.${status.plan ?? 'monthly'}`)}</Text>
      <Text style={styles.body}>{t('coachAiBilling.usage', { count: status.remaining, date: status.resetsAtMs ? new Date(status.resetsAtMs).toLocaleString(i18n.language) : '' })}</Text>
      {status.pending > 0 ? <Text style={styles.body}>{t('coachAiBilling.pendingUsage', { count: status.pending })}</Text> : null}
      {!status.autoRenews ? <Text style={styles.body}>{t('coachAiBilling.cancelledActive', { date: status.accessUntilMs ? new Date(status.accessUntilMs).toLocaleString(i18n.language) : '' })}</Text> : null}
    </Card> : null}
    {showPlans ? <>
      {loadingPlans ? <ActivityIndicator accessibilityLabel={t('coachAiBilling.loadingPlans')} color={Colors.primary} /> : null}
      <View style={styles.plans}>{(['monthly', 'yearly'] as const).map((plan) => {
        const product = packages[plan]?.product;
        if (!product) return null;
        return <TouchableOpacity key={plan} disabled={busy || !canShop} accessibilityRole="radio" accessibilityState={{ checked: selected === plan, disabled: busy || !canShop }} onPress={() => { if (!busy && canShop) setSelected(plan); }} style={[styles.plan, selected === plan && styles.selected]}>
          <Text style={styles.heading}>{t(`coachAiBilling.${plan}`)}</Text>
          <Text style={styles.price}>{product.priceString}</Text>
          <Text style={styles.body}>{t(`coachAiBilling.${plan}Period`)}</Text>
        </TouchableOpacity>;
      })}</View>
      <Text style={styles.body}>{chosen && selected ? t(`coachAiBilling.${selected}Renewal`, { price: chosen.product.priceString }) : t('coachAiBilling.choose')}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: buyDisabled, busy }} disabled={buyDisabled} onPress={() => void perform('buy')} style={[styles.primary, buyDisabled && styles.disabled]}>
        <Text style={styles.primaryText}>{t('coachAiBilling.subscribe')}</Text>
      </TouchableOpacity>
    </> : null}
    <Text style={styles.body}>{t('coachAiBilling.accountNotice')}</Text>
    <Text style={styles.body}>{t('coachAiBilling.billingPrivacy')}</Text>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {purchaseState.uid === uid && purchaseState.error ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{t('coachAiBilling.purchaseRecovery.inspectionError')}</Text> : null}
    {purchaseDiagnostic ? <Text accessibilityLiveRegion="polite" style={styles.body}>{t(`coachAiBilling.purchaseStages.${purchaseDiagnostic.phase}`)}</Text> : null}
    {purchaseDiagnostic?.record.present ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{t('coachAiBilling.purchaseRecovery.required')}</Text> : null}
    {diagnosticMessage ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{t(`coachAiBilling.planDiagnostics.${diagnosticMessage}`)}</Text> : null}
    {diagnostic || access.billing.diagnostic || purchaseDiagnostic ? <>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails(value => !value)} style={styles.link}>
        <Text style={styles.linkText}>{t(showDetails ? 'coachAiBilling.hideSupportDetails' : 'coachAiBilling.showSupportDetails')}</Text>
      </TouchableOpacity>
      {showDetails ? <Text selectable style={styles.body}>{JSON.stringify({
        availability, statusCheck: access.billing.diagnostic ?? null, planCheck: diagnostic ?? null, purchaseCheck: purchaseDiagnostic ?? null,
      }, null, 2)}</Text> : null}
    </> : null}
    {showDetails && COACH_AI_TEST_RECOVERY_AVAILABLE && eligible && purchaseDiagnostic?.record.present ? <Card>
      <Text style={styles.body}>{t('coachAiBilling.purchaseRecovery.reviewHelp')}</Text>
      <TextInput accessibilityLabel={t('coachAiBilling.purchaseRecovery.reference')} value={reviewReference} editable={!busy} maxLength={128} autoCapitalize="none" autoCorrect={false} autoComplete="off" onChangeText={value => { setReviewReference(value); setReviewConfirmed(false); }} style={styles.input} />
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: reviewConfirmed, disabled: busy }} disabled={busy} onPress={() => setReviewConfirmed(value => !value)} style={styles.link}>
        <Text style={styles.linkText}>{reviewConfirmed ? '☑ ' : '☐ '}{t('coachAiBilling.purchaseRecovery.confirm')}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: reviewDisabled }} disabled={reviewDisabled} onPress={() => void perform('resolve')} style={[styles.primary, reviewDisabled && styles.disabled]}>
        <Text style={styles.primaryText}>{t('coachAiBilling.purchaseRecovery.apply')}</Text>
      </TouchableOpacity>
    </Card> : null}
    {busy ? <ActivityIndicator color={Colors.primary} /> : null}
    <TouchableOpacity accessibilityRole="button" disabled={busy || !uid || purchaseState.loading} onPress={() => void perform('inspect')} style={styles.link}><Text style={styles.linkText}>{t('coachAiBilling.purchaseRecovery.inspect')}</Text></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" disabled={busy || availability !== 'ready'} onPress={() => void perform('restore')} style={styles.link}><Text style={styles.linkText}>{t('coachAiBilling.restore')}</Text></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" disabled={busy || loading || !enabled || !eligible} onPress={() => void perform('check')} style={styles.link}><Text style={styles.linkText}>{t('coachAiBilling.checkAgain')}</Text></TouchableOpacity>
    {managedUrl ? <TouchableOpacity accessibilityRole="link" onPress={() => void open(managedUrl)} style={styles.link}><Text style={styles.linkText}>{t('coachAiBilling.manage')}</Text></TouchableOpacity> : null}
    <Text style={styles.body}>{t('coachAiBilling.cancellation')}</Text>
    <TouchableOpacity accessibilityRole="link" onPress={() => void open(TERMS_OF_USE_URL)} style={styles.link}><Text style={styles.linkText}>{t('settings.termsTitle')}</Text></TouchableOpacity>
    <TouchableOpacity accessibilityRole="link" onPress={() => void open(PRIVACY_POLICY_URL)} style={styles.link}><Text style={styles.linkText}>{t('settings.privacyTitle')}</Text></TouchableOpacity>
    <TouchableOpacity accessibilityRole="link" onPress={() => void open('mailto:info@joinsidelinesocial.com')} style={styles.link}><Text style={styles.linkText}>{t('coachAiBilling.support')}</Text></TouchableOpacity>
  </ScrollView></ScreenWrapper>;
}
const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 22 },
  heading: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18 },
  price: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 24 },
  plans: { gap: Spacing.md }, plan: { padding: Spacing.lg, gap: Spacing.sm, borderRadius: Radius.button, borderWidth: 2, borderColor: Colors.background, backgroundColor: Colors.surface },
  selected: { borderColor: Colors.primary }, primary: { minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary, borderRadius: Radius.button },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 16 }, disabled: { opacity: 0.5 },
  input: { minHeight: 48, borderWidth: 1, borderColor: Colors.textHeading, borderRadius: Radius.button, color: Colors.textPrimary, padding: Spacing.sm },
  link: { minHeight: 44, justifyContent: 'center' }, linkText: { color: Colors.primary, fontFamily: Typography.bodySemiBold }, notice: { color: Colors.textHeading, fontFamily: Typography.bodyRegular },
});
