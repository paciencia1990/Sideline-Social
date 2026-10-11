import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/config/firebase';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { AnnouncementBody } from '@/components/AnnouncementBody';
import { getTranslationLanguage, openTranslationInformation, saveTranslationLanguage, translateTeamMessage, type TeamTranslationSource } from '@/services/teamTranslationService';
import { TEAM_TRANSLATION_LANGUAGES, translationErrorKey, translationLanguageForLocale } from '@/utils/teamTranslation';

export function MessageTranslation({ source, sourceText }: { source: TeamTranslationSource; sourceText: string }) {
  const { t, i18n } = useTranslation();
  const [uid, setUid] = useState(auth.currentUser?.uid ?? null);
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; language: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoError, setInfoError] = useState(false);
  const pending = useRef(false);
  const languageChosen = useRef(false);
  const generation = useRef(0);
  const identity = JSON.stringify([uid, source, sourceText]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid ?? null)), []);
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setOpen(false); setBusy(false); setResult(null); setError(null); setInfoError(false);
    return () => { generation.current += 1; };
  }, [identity]);
  useEffect(() => {
    let current = true;
    languageChosen.current = false;
    let defaultLanguage: string | null = null;
    try { defaultLanguage = translationLanguageForLocale(Intl.DateTimeFormat().resolvedOptions().locale); } catch { /* Choose manually if locale is unavailable. */ }
    setLanguage(defaultLanguage ?? translationLanguageForLocale(i18n.language));
    if (uid) void getTranslationLanguage(uid).then((saved) => { if (current && saved && !languageChosen.current) setLanguage(saved); });
    return () => { current = false; };
  }, [i18n.language, uid]);

  const translate = async () => {
    if (pending.current || !uid || !language) return;
    const requestGeneration = generation.current;
    const requestIdentity = identity;
    const current = () => generation.current === requestGeneration && currentIdentity.current === requestIdentity && auth.currentUser?.uid === uid;
    pending.current = true; setBusy(true); setError(null); setResult(null); setOpen(false);
    try {
      const response = await translateTeamMessage(source, language);
      if (response.originalText !== sourceText) {
        if (current()) setError(t('messageTranslation.messageChanged'));
        return;
      }
      if (current()) {
        setResult({ text: response.translatedText, language });
        void saveTranslationLanguage(uid, language);
      }
    } catch (failure) {
      if (current()) setError(t(translationErrorKey(failure)));
    } finally {
      if (current()) { pending.current = false; setBusy(false); }
    }
  };
  const openInfo = async () => {
    const requestGeneration = generation.current;
    const requestIdentity = identity;
    setInfoError(false);
    try { await openTranslationInformation(); } catch {
      if (generation.current === requestGeneration && currentIdentity.current === requestIdentity) setInfoError(true);
    }
  };
  const selectedName = TEAM_TRANSLATION_LANGUAGES.find((item) => item.code === language)?.name;
  if (!uid || !sourceText.trim()) return null;
  return (
    <View style={styles.root}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => { setQuery(''); setOpen(true); }} style={styles.button}>
        {busy ? <ActivityIndicator color={Colors.primary} /> : null}
        <Text style={styles.action}>{t(busy ? 'messageTranslation.translating' : 'messageTranslation.open')}</Text>
      </TouchableOpacity>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {result ? (
        <View accessibilityLiveRegion="polite" style={styles.result}>
          <Text style={styles.heading}>{t('messageTranslation.resultHeading', { language: TEAM_TRANSLATION_LANGUAGES.find((item) => item.code === result.language)?.name })}</Text>
          <AnnouncementBody body={result.text} style={[styles.body, ['ar', 'he', 'fa', 'ur'].includes(result.language) && styles.rtl]} />
          <Image accessibilityLabel="powered by Google Translate" resizeMode="contain" source={require('@/assets/images/google-translate-attribution.png')} style={styles.attribution} />
          <Text style={styles.note}>{t('messageTranslation.accuracy')}</Text>
          <TouchableOpacity accessibilityRole="link" onPress={() => { void openInfo(); }} style={styles.button}><Text style={styles.action}>{t('messageTranslation.info')}</Text></TouchableOpacity>
          {infoError ? <Text accessibilityRole="alert" style={styles.error}>{t('messageTranslation.infoError')}</Text> : null}
          <TouchableOpacity accessibilityRole="button" onPress={() => setResult(null)} style={styles.button}><Text style={styles.action}>{t('messageTranslation.hide')}</Text></TouchableOpacity>
        </View>
      ) : null}
      <Modal animationType="slide" onRequestClose={() => setOpen(false)} visible={open}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modal}>
          <Text accessibilityRole="header" style={styles.heading}>{t('messageTranslation.title')}</Text>
          <Text style={styles.body}>{t('messageTranslation.notice')}</Text>
          <Text style={styles.note}>{t('messageTranslation.audioNotice')}</Text>
          <TextInput accessibilityLabel={t('messageTranslation.search')} autoCapitalize="none" onChangeText={setQuery} placeholder={t('messageTranslation.search')} style={styles.search} value={query} />
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.languageList}>
            {TEAM_TRANSLATION_LANGUAGES.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(query.trim().toLowerCase())).map((item) => (
              <TouchableOpacity accessibilityRole="radio" accessibilityState={{ checked: item.code === language }} key={item.code} onPress={() => { languageChosen.current = true; setLanguage(item.code); }} style={[styles.language, item.code === language && styles.selected]}>
                <Text style={styles.body}>{item.code === language ? '✓ ' : ''}{item.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.note}>{t('messageTranslation.selected', { language: selectedName ?? t('messageTranslation.choose') })}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !language || busy }} disabled={!language || busy} onPress={() => { void translate(); }} style={styles.confirm}><Text style={styles.confirmText}>{t('messageTranslation.translate')}</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(false)} style={styles.button}><Text style={styles.action}>{t('common.cancel')}</Text></TouchableOpacity>
        </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: Spacing.xs, marginTop: Spacing.sm },
  button: { minHeight: 48, paddingVertical: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  action: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  result: { backgroundColor: Colors.background, borderRadius: Radius.card, padding: Spacing.md, gap: Spacing.sm },
  heading: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 17 },
  body: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 23 },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
  note: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 19 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 20 },
  attribution: { width: 180, height: 24, alignSelf: 'flex-start' },
  safeArea: { flex: 1, backgroundColor: Colors.surface },
  modal: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
  search: { borderWidth: 1, borderColor: Colors.secondary, borderRadius: Radius.button, minHeight: 48, paddingHorizontal: Spacing.md, color: Colors.textHeading, fontFamily: Typography.bodyRegular },
  languageList: { flex: 1 },
  language: { minHeight: 48, padding: Spacing.sm, borderRadius: Radius.button },
  selected: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.primary },
  confirm: { minHeight: 52, padding: Spacing.md, alignItems: 'center', backgroundColor: Colors.primary, borderRadius: Radius.button },
  confirmText: { color: Colors.surface, fontFamily: Typography.bodyBold },
});
