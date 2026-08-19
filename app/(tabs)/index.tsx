import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Bell, CheckCircle2, ChevronRight, MessageCircle, Play, Star, Trophy, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { IcebreakerCard } from "@/components/IcebreakerCard";
import { LocalPerkAdCard, LocalPerkOfferPreviewModal } from "@/components/LocalPerkAdCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SquadIdentity } from "@/components/SquadIdentity";
import { SquadSelector } from "@/components/SquadSelector";
import { getLocalPerkPreviewOffer, LOCAL_PERK_AD_PREVIEW_ENABLED } from "@/constants/localPerkPreview";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useSquadGameLobbies } from "@/hooks/useSquadGameLobbies";
import {
  retryPendingNotificationAcknowledgements,
  subscribeToUnreadNotificationCount,
} from "@/services/notificationService";
import { formatUnreadBadgeCount } from "@/utils/notificationCore";
import { subscribeToUnreadFriendConversationCount } from "@/services/chatService";
import { measureDevelopmentPerformance } from "@/utils/performanceDiagnostics";
import type { GameJoinCodeType } from "@/services/gameJoinCodeService";
import {
  getParentTeamsOverview,
  getTeamChildNames,
  type ParentTeamsOverview,
  type ParentTeamSummary,
} from "@/services/parentTeamService";
import {
  completeWeeklyChallenge,
  getCurrentWeeklyChallenge,
  type UserWeeklyChallenge,
} from "@/services/weeklyChallengeService";
import { localizeWeeklyChallenge } from "@/services/weeklyChallengeLocalization";
import { type Squad } from "@/services/squadService";

const logoSource = require("@/assets/branding/sideline-social-logo.png");

function gameTitleKey(gameType: GameJoinCodeType) {
  if (gameType === "bombDefusal") return "games.bombDefusal.title";
  if (gameType === "spotTheDifferences") return "games.spotDifference.title";
  return "games.triviaBlitz.title";
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    currentSquad,
    membershipError,
    membershipLoading,
    mySquads,
    reloadMemberships,
    selectionWasStale,
    selectedSquadId,
  } = useSquad();

  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [myTeamsOverview, setMyTeamsOverview] = useState<ParentTeamsOverview | null>(null);
  const [myTeamsLoading, setMyTeamsLoading] = useState(true);
  const [myTeamsError, setMyTeamsError] = useState<string | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<UserWeeklyChallenge | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challengeCompletionLoading, setChallengeCompletionLoading] = useState(false);
  const [localPerkPreviewOpen, setLocalPerkPreviewOpen] = useState(false);
  const [squadSelectorOpen, setSquadSelectorOpen] = useState(false);
  const {
    lobbies: activeLobbies,
    refresh: retryActiveSession,
  } = useSquadGameLobbies({
    enabled: !membershipLoading,
    squadId: selectedSquadId,
  });
  const activeLobbyGroups = useMemo(() => {
    const gameTypes: GameJoinCodeType[] = ["bombDefusal", "spotTheDifferences", "triviaBlitz"];
    return gameTypes.flatMap((gameType) => {
      const lobbies = activeLobbies.filter((lobby) => lobby.gameType === gameType);
      return lobbies.length > 0 ? [{ gameType, lobbies }] : [];
    });
  }, [activeLobbies]);

  const safeUnreadCount = Number.isFinite(unreadCount) ? Math.max(0, unreadCount) : 0;
  const unreadBadge = formatUnreadBadgeCount(safeUnreadCount);
  const localPerkPreviewOffer = LOCAL_PERK_AD_PREVIEW_ENABLED ? getLocalPerkPreviewOffer(t) : null;

  const loadMyTeams = useCallback(async () => {
    if (!user?.uid) {
      setMyTeamsOverview(null);
      setMyTeamsLoading(false);
      return;
    }
    setMyTeamsLoading(true);
    setMyTeamsError(null);
    try {
      setMyTeamsOverview(await measureDevelopmentPerformance(
        "home.parent-teams",
        getParentTeamsOverview,
      ));
    } catch (nextError) {
      console.warn("[HomeScreen] My Teams load error:", nextError);
      setMyTeamsError(t("myTeams.loadError"));
    } finally {
      setMyTeamsLoading(false);
    }
  }, [t, user?.uid]);
  const loadHome = useCallback(async () => {
    setError(null);
    setChallengeError(null);
    const userId = user?.uid;

    try {
      const challengeResult = await (
        userId
          ? measureDevelopmentPerformance("home.weekly-challenge", getCurrentWeeklyChallenge)
              .then((challenge) => ({ challenge, failed: false }))
              .catch((challengeLoadError) => {
                console.warn("[HomeScreen] weekly challenge load error:", challengeLoadError);
                return { challenge: null, failed: true };
              })
          : Promise.resolve({ challenge: null, failed: false })
      );

      setActiveChallenge(challengeResult.challenge);
      setChallengeError(challengeResult.failed ? t("home.challengeError") : null);

    } catch (nextError) {
      console.warn("[HomeScreen] load error:", nextError);
      setError(t("home.errorBody"));
      setActiveChallenge(null);
      setChallengeError(t("home.challengeError"));
    } finally {
      setIsLoading(false);
    }
  }, [t, user?.uid]);

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  useFocusEffect(useCallback(() => {
    void loadMyTeams();
  }, [loadMyTeams]));
  useFocusEffect(useCallback(() => {
    void reloadMemberships();
  }, [reloadMemberships]));
  useFocusEffect(useCallback(() => {
    if (!user?.uid) {
      setUnreadCount(0);
      return;
    }
    return subscribeToUnreadNotificationCount(user.uid, setUnreadCount);
  }, [user?.uid]));
  useFocusEffect(useCallback(() => {
    if (!user?.uid) {
      setUnreadChatCount(0);
      return;
    }
    return subscribeToUnreadFriendConversationCount(user.uid, setUnreadChatCount);
  }, [user?.uid]));
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.allSettled([
      retryPendingNotificationAcknowledgements(),
      retryActiveSession(),
      loadHome(),
      loadMyTeams(),
      reloadMemberships(),
    ]).finally(() => setRefreshing(false));
  }, [loadHome, loadMyTeams, reloadMemberships, retryActiveSession]);

  const confirmChallengeCompletion = useCallback(() => {
    if (!activeChallenge || activeChallenge.completed || challengeCompletionLoading) return;
    Alert.alert(
      t("home.challengeConfirmTitle"),
      t("home.challengeConfirmBody"),
      [
        { text: t("home.challengeNotYet"), style: "cancel" },
        {
          text: t("home.challengeConfirmAction"),
          onPress: () => {
            setChallengeCompletionLoading(true);
            setChallengeError(null);
            void completeWeeklyChallenge(activeChallenge.weekKey)
              .then((result) => {
                setActiveChallenge(result.challenge);
                Alert.alert(
                  t("home.challengeSuccessTitle"),
                  result.alreadyCompleted
                    ? t("home.challengeAlreadyCompleted")
                    : t("home.challengeSuccessBody", {
                      points: result.pointsAwarded,
                      total: result.sidelineStars,
                    }),
                );
              })
              .catch((nextError) => {
                console.warn("[HomeScreen] challenge completion error:", nextError);
                setChallengeError(t("home.challengeError"));
                Alert.alert(t("home.challengeErrorTitle"), t("home.challengeError"));
              })
              .finally(() => setChallengeCompletionLoading(false));
          },
        },
      ],
    );
  }, [activeChallenge, challengeCompletionLoading, t]);

  return (
    <ScreenWrapper>
      <View style={styles.fixedHeader}>
        <View style={styles.brandRow}>
          <View style={styles.brandUnit}>
            <Image
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              resizeMode="contain"
              source={logoSource}
              style={styles.logo}
            />
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.3}
              minimumFontScale={0.78}
              numberOfLines={1}
              style={styles.brandName}
            >
              {t("app.name")}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel={safeUnreadCount > 0
              ? t("notifications.bellUnread", { count: safeUnreadCount })
              : t("notifications.bellNoUnread")}
            accessibilityLiveRegion="polite"
            accessibilityRole="button"
            activeOpacity={0.82}
            onPress={() => router.push("/notifications")}
            style={styles.notificationSummary}
          >
            <Bell importantForAccessibility="no" size={19} color={Colors.textHeading} />
            {safeUnreadCount > 0 ? (
              <Text importantForAccessibility="no" style={styles.notificationText}>{unreadBadge}</Text>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>
      <View
        accessible={false}
        importantForAccessibility="no"
        style={styles.headerDivider}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={Colors.primary} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
        <MyTeamsCard
          error={myTeamsError}
          loading={myTeamsLoading}
          onRetry={loadMyTeams}
          overview={myTeamsOverview}
        />
        {error ? <StateCard title={t("home.errorTitle")} body={error} /> : null}

        {activeLobbyGroups.length > 0 ? (
          <View style={styles.activeGameCard}>
            <View style={styles.activeGameIcon}>
              <Play size={22} color={Colors.surface} fill={Colors.surface} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.cardEyebrow}>{t("home.activeGame")}</Text>
              <Text style={styles.activeGameCardTitle}>{t("games.lobbyDirectory.activeNowTitle")}</Text>
              {activeLobbyGroups.map(({ gameType, lobbies }) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.82}
                  key={gameType}
                  onPress={() => selectedSquadId && router.push({
                    pathname: "/(games)/lobbies" as never,
                    params: { gameType, squadId: selectedSquadId },
                  })}
                  style={styles.activeGameSummary}
                >
                  <Text style={styles.activeGameSummaryTitle}>{t(gameTitleKey(gameType))}</Text>
                  <Text style={styles.activeGameSummaryBody}>
                    {lobbies.map((lobby) => t("games.lobbyDirectory.activeNowLobbySummary", {
                      lobby: lobby.isMain
                        ? t("games.lobbyDirectory.mainLobby")
                        : t("games.lobbyDirectory.numberedLobby", { number: lobby.lobbyNumber }),
                      count: lobby.activePlayerCount,
                      status: t(`games.lobbyDirectory.status.${lobby.status}`),
                    })).join("\n")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        <SecondaryActions unreadChatCount={unreadChatCount} />

        <YourSquadCard
          currentSquad={currentSquad}
          error={membershipError}
          loading={membershipLoading}
          membershipCount={mySquads.length}
          onChoose={() => setSquadSelectorOpen(true)}
          onRetry={() => void reloadMemberships()}
          selectionWasStale={selectionWasStale}
        />
        <SquadSelector hideTrigger onOpenChange={setSquadSelectorOpen} open={squadSelectorOpen} />

        <ChallengeCard
          challenge={activeChallenge}
          completionLoading={challengeCompletionLoading}
          error={challengeError}
          loading={isLoading}
          onPress={confirmChallengeCompletion}
          onRetry={loadHome}
        />

        <IcebreakerCard />

        {LOCAL_PERK_AD_PREVIEW_ENABLED && localPerkPreviewOffer ? (
          <LocalPerkAdCard
            accessibilityLabel={localPerkPreviewOffer.accessibilityLabel}
            advertiserName={localPerkPreviewOffer.advertiserName}
            ctaLabel={localPerkPreviewOffer.ctaLabel}
            disclosure={localPerkPreviewOffer.disclosure}
            headline={localPerkPreviewOffer.headline}
            logoAccessibilityLabel={localPerkPreviewOffer.logoAccessibilityLabel}
            logoInitials={localPerkPreviewOffer.logoInitials}
            onPress={() => setLocalPerkPreviewOpen(true)}
          />
        ) : null}
      </ScrollView>
      {LOCAL_PERK_AD_PREVIEW_ENABLED && localPerkPreviewOffer ? (
        <LocalPerkOfferPreviewModal
          offer={localPerkPreviewOffer}
          onClose={() => setLocalPerkPreviewOpen(false)}
          visible={localPerkPreviewOpen}
        />
      ) : null}
    </ScreenWrapper>
  );
}

function MyTeamsCard({
  error,
  loading,
  onRetry,
  overview,
}: {
  error: string | null;
  loading: boolean;
  onRetry: () => void;
  overview: ParentTeamsOverview | null;
}) {
  const { t } = useTranslation();
  const latestTeam = overview?.latestTeam ?? null;
  const latest = overview?.latestAnnouncement ?? null;
  const latestPrivate = overview?.teams
    .flatMap((team) => team.privateConversations.map((conversation) => ({ conversation, team })))
    .sort((first, second) => second.conversation.lastMessageAtMillis - first.conversation.lastMessageAtMillis)[0] ?? null;
  const combinedUnread = (overview?.unreadCount ?? 0) + (overview?.privateUnreadCount ?? 0);

  if (error && !overview) {
    return (
      <Card style={[styles.myTeamsCard, styles.myTeamsErrorCard]}>
        <View style={styles.myTeamsTopRow}>
          <Users color={Colors.textHeading} size={22} />
          <Text style={styles.myTeamsTitle}>{t("myTeams.title")}</Text>
        </View>
        <Text style={styles.cardText}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={onRetry} style={styles.outlineInlineButton}>
          <Text style={styles.outlineInlineText}>{t("myTeams.tryAgain")}</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  return (
    <TouchableOpacity
      accessibilityLabel={t("myTeams.viewTeams")}
      accessibilityRole="button"
      activeOpacity={0.86}
      onPress={() => router.push("/teams" as never)}
    >
      <Card style={styles.myTeamsCard}>
        <View style={styles.myTeamsTopRow}>
          <View style={styles.myTeamsIcon}>
            {loading && !overview ? <ActivityIndicator color={Colors.primary} size="small" /> : <Users color={Colors.primary} size={22} />}
          </View>
          <View style={styles.cardCopy}>
            <Text style={styles.myTeamsTitle}>{t("myTeams.title")}</Text>
            {loading && !overview ? (
              <Text style={styles.cardText}>{t("myTeams.loading")}</Text>
            ) : overview?.totalTeams ? (
              <Text style={styles.myTeamsSummary}>
                {t("myTeams.teamCount", { count: overview.totalTeams })}
                {overview.unreadCountKnown
                  ? overview.unreadCount > 0 ? " · " + t("myTeams.unreadUpdates", { count: overview.unreadCount }) : ""
                  : " · " + t("myTeams.unreadUnknown")}
                {overview.privateUnreadCount > 0 ? " · " + t("teamMessages.unread", { count: overview.privateUnreadCount }) : ""}
              </Text>
            ) : (
              <Text style={styles.myTeamsSummary}>{t("myTeams.noTeams")}</Text>
            )}
          </View>
          {combinedUnread > 0 ? (
            <View style={styles.myTeamsBadge}>
              <Text style={styles.myTeamsBadgeText}>{combinedUnread}</Text>
            </View>
          ) : null}
          <ChevronRight color={Colors.textPrimary} size={20} />
        </View>

        {!loading && overview?.totalTeams === 0 ? (
          <Text style={styles.cardText}>{t("myTeams.noTeamsBody")}</Text>
        ) : null}

        {latestTeam && latest ? (
          <View style={styles.myTeamsPreview}>
            <Text style={styles.myTeamsPreviewTeam}>
              {formatHomeTeamLabel(latestTeam, t("myTeams.childNotSpecified"))}
            </Text>
            <Text numberOfLines={2} style={styles.myTeamsPreviewBody}>{latest.isDeleted ? t("teamMessages.messageDeleted") : latest.body}</Text>
          </View>
        ) : null}

        {latestPrivate ? (
          <View style={styles.myTeamsPreview}>
            <Text style={styles.myTeamsPreviewTeam}>{t("teamMessages.privateLabel")} · {latestPrivate.team.team.name}</Text>
            <Text numberOfLines={2} style={styles.myTeamsPreviewBody}>{latestPrivate.conversation.lastMessageType === "voice" ? t("teamMessages.voicePreview") : latestPrivate.conversation.lastMessageType === "deleted" ? t("teamMessages.messageDeleted") : latestPrivate.conversation.lastMessagePreview || t("teamMessages.noMessagesYet")}</Text>
          </View>
        ) : null}

        {!loading && overview?.totalTeams && combinedUnread === 0 ? (
          <Text style={styles.myTeamsCaughtUp}>{t("myTeams.caughtUp")}</Text>
        ) : null}

        <Text style={styles.myTeamsAction}>{t("myTeams.viewTeams")}</Text>
      </Card>
    </TouchableOpacity>
  );
}
function SecondaryActions({ unreadChatCount }: { unreadChatCount: number }) {
  const { t } = useTranslation();
  const actions = [
    { label: t("home.chat"), Icon: MessageCircle, route: "/(social)/chat", badge: unreadChatCount },
    { label: t("home.leaderboard"), Icon: Trophy, route: "/leaderboard", badge: 0 },
  ];

  return (
    <View style={styles.secondaryActionRow}>
      {actions.map(({ Icon, label, route, badge }) => (
        <TouchableOpacity
          key={label}
          accessibilityLabel={label}
          accessibilityRole="button"
          activeOpacity={0.86}
          onPress={() => router.push(route as never)}
          style={styles.secondaryActionCard}
        >
          <Icon size={21} color={Colors.primary} />
          {badge > 0 ? <View accessibilityLabel={t("chat.unreadCount", { count: badge })} style={styles.chatBadge}><Text style={styles.chatBadgeText}>{badge > 99 ? "99+" : badge}</Text></View> : null}
          <Text style={styles.secondaryActionText}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function YourSquadCard({
  currentSquad,
  error,
  loading,
  membershipCount,
  onChoose,
  onRetry,
  selectionWasStale,
}: {
  currentSquad: Squad | null;
  error: string | null;
  loading: boolean;
  membershipCount: number;
  onChoose: () => void;
  onRetry: () => void;
  selectionWasStale: boolean;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card style={styles.yourSquadCard}>
        <Text accessibilityRole="header" style={styles.cardEyebrow}>{t("home.yourSquad")}</Text>
        <View style={styles.yourSquadLoadingRow}>
          <ActivityIndicator color={Colors.primary} size="small" />
          <Text style={styles.cardText}>{t("home.yourSquadLoading")}</Text>
        </View>
      </Card>
    );
  }

  if (error) {
    return (
      <Card style={styles.yourSquadCard}>
        <Text accessibilityRole="header" style={styles.cardEyebrow}>{t("home.yourSquad")}</Text>
        <Text style={styles.cardTitle}>{t("home.yourSquadErrorTitle")}</Text>
        <Text style={styles.cardText}>{t("home.yourSquadErrorBody")}</Text>
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={onRetry} style={styles.outlineInlineButton}>
          <Text style={styles.outlineInlineText}>{t("common.retry")}</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  if (!currentSquad) {
    const hasMemberships = membershipCount > 0;
    return (
      <Card style={styles.yourSquadCard}>
        <Text accessibilityRole="header" style={styles.cardEyebrow}>{t("home.yourSquad")}</Text>
        <Text style={styles.cardTitle}>{t(hasMemberships ? "home.chooseSquadTitle" : "home.noSquadTitle")}</Text>
        <Text style={styles.cardText}>{t(
          hasMemberships
            ? selectionWasStale
              ? "home.staleSquadBody"
              : "home.chooseSquadBody"
            : "home.noSquadBody"
        )}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.86}
          onPress={hasMemberships ? onChoose : () => router.push("/(tabs)/squad")}
          style={styles.primaryInlineButton}
        >
          <Text style={styles.primaryInlineText}>{t(hasMemberships ? "home.chooseSquad" : "home.findSquad")}</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  return (
    <Card style={styles.yourSquadCard}>
      <Text accessibilityRole="header" style={styles.cardEyebrow}>{t("home.yourSquad")}</Text>
      <SquadIdentity
        venueName={currentSquad.venueName}
        sportId={currentSquad.sportId}
        sportDisplayName={currentSquad.sportDisplayName}
      />
      <Text style={styles.cardText}>{t("home.squadMemberCount", { count: currentSquad.memberCount })}</Text>
      <View style={styles.yourSquadActions}>
        <TouchableOpacity
          accessibilityLabel={t("home.viewSquadAccessibility", { squad: currentSquad.venueName })}
          accessibilityRole="button"
          activeOpacity={0.86}
          onPress={() => router.push(`/(social)/squad-detail?squadId=${currentSquad.squadId}` as never)}
          style={styles.primaryInlineButton}
        >
          <Text style={styles.primaryInlineText}>{t("home.viewSquad")}</Text>
        </TouchableOpacity>
        {membershipCount > 1 ? (
          <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={onChoose} style={styles.outlineInlineButton}>
            <Text style={styles.outlineInlineText}>{t("home.switchSquad")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Card>
  );
}

function ChallengeCard({
  challenge,
  completionLoading,
  error,
  loading,
  onPress,
  onRetry,
}: {
  challenge: UserWeeklyChallenge | null;
  completionLoading: boolean;
  error: string | null;
  loading: boolean;
  onPress: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (loading && !challenge) {
    return (
      <Card style={styles.challengeCard}>
        <Text style={styles.cardEyebrow}>{t("home.thisWeeksChallenge")}</Text>
        <View style={styles.challengeLoadingRow}>
          <ActivityIndicator color={Colors.primary} size="small" />
          <Text style={styles.cardText}>{t("home.challengeLoading")}</Text>
        </View>
      </Card>
    );
  }

  if (!challenge) {
    return (
      <Card style={styles.challengeCard}>
        <Text style={styles.cardEyebrow}>{t("home.thisWeeksChallenge")}</Text>
        <Text style={styles.cardTitle}>{t("home.challengeErrorTitle")}</Text>
        <Text style={styles.cardText}>{error ?? t("home.challengeError")}</Text>
        <TouchableOpacity activeOpacity={0.86} onPress={onRetry} style={styles.outlineInlineButton}>
          <Text style={styles.outlineInlineText}>{t("home.challengeRetry")}</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  const localizedChallenge = localizeWeeklyChallenge(challenge, t);

  return (
    <Card style={[styles.challengeCard, challenge.completed && styles.challengeCardCompleted]}>
      <Text style={styles.cardEyebrow}>{t("home.thisWeeksChallenge")}</Text>
      <Text style={styles.cardTitle}>{localizedChallenge.title}</Text>
      <Text style={styles.cardText}>{localizedChallenge.description}</Text>
      {challenge.completed ? (
        <View style={styles.challengeCompletedRow}>
          <CheckCircle2 size={22} color={Colors.accentGreen} />
          <View style={styles.cardCopy}>
            <Text style={styles.challengeCompleteTitle}>{t("home.challengeCompleted")}</Text>
            <Text style={styles.cardText}>{t("home.challengeEarned", { points: challenge.points })}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.challengeRewardRow}>
          <Star size={18} color={Colors.accentGold} fill={Colors.accentGold} />
          <Text style={styles.challengeRewardText}>{t("home.challengeReward", { points: challenge.points })}</Text>
        </View>
      )}
      {error ? <Text style={styles.challengeErrorText}>{error}</Text> : null}
      <Text style={styles.challengeResetText}>
        {challenge.completed ? t("home.challengeNewMonday") : t("home.challengeResetsMonday")}
      </Text>
      {!challenge.completed ? (
        <TouchableOpacity
          activeOpacity={0.86}
          disabled={completionLoading}
          onPress={onPress}
          style={[styles.primaryInlineButton, completionLoading && styles.disabledInlineButton]}
        >
          {completionLoading ? <ActivityIndicator color={Colors.surface} size="small" /> : <Star size={16} color={Colors.surface} />}
          <Text style={styles.primaryInlineText}>{t("home.challengeCompleteAction")}</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}
function StateCard({
  actionLabel,
  body,
  icon,
  onAction,
  title,
}: {
  actionLabel?: string;
  body: string;
  icon?: React.ReactNode;
  onAction?: () => void;
  title: string;
}) {
  return (
    <Card style={styles.stateCard}>
      {icon}
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity activeOpacity={0.86} onPress={onAction} style={styles.outlineInlineButton}>
          <Text style={styles.outlineInlineText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}

function formatHomeTeamLabel(summary: ParentTeamSummary, childFallback: string) {
  const childNames = getTeamChildNames(summary);
  const childLabel = childNames.length > 0 ? childNames.join(", ") : childFallback;
  return `${childLabel} - ${summary.team.name}`;
}

const styles = StyleSheet.create({
  fixedHeader: {
    backgroundColor: Colors.background,
    paddingBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  headerDivider: {
    backgroundColor: Colors.secondary,
    height: StyleSheet.hairlineWidth,
    width: "100%",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    paddingTop: Spacing.sm,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
  },
  brandUnit: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: Spacing.sm,
    minWidth: 0,
    paddingRight: Spacing.sm,
  },
  logo: {
    flexShrink: 0,
    height: 36,
    // Explicit dimensions avoid Android measuring the large source bitmap at
    // its intrinsic height inside this flex row. resizeMode="contain" keeps
    // the exact artwork ratio within this compact box.
    width: 36 * (1637 / 1536),
  },
  brandName: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 20,
    lineHeight: 26,
    flexShrink: 1,
  },
  notificationSummary: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.xs,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Spacing.sm,
  },
  notificationText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
  },
  myTeamsCard: {
    borderLeftColor: Colors.textHeading,
    borderLeftWidth: 4,
    gap: Spacing.sm,
  },
  myTeamsErrorCard: {
    borderLeftColor: Colors.primary,
  },
  myTeamsTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  myTeamsIcon: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  myTeamsTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 18,
  },
  myTeamsSummary: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
  },
  myTeamsBadge: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 13,
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  myTeamsBadgeText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
    fontSize: 12,
  },
  myTeamsPreview: {
    backgroundColor: Colors.background,
    borderColor: Colors.accentGold,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 3,
    padding: Spacing.sm,
  },
  myTeamsPreviewTeam: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
  },
  myTeamsPreviewBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  myTeamsCaughtUp: {
    color: Colors.accentGreen,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
  },
  myTeamsAction: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  secondaryActionRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  secondaryActionCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.xs,
    justifyContent: "center",
    minHeight: 82,
    minWidth: 0,
    padding: Spacing.sm,
    ...Shadow.card,
  },
  secondaryActionText: {
    color: Colors.textHeading,
    flexShrink: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  chatBadge: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 5,
    position: "absolute",
    right: 12,
    top: 8,
  },
  chatBadgeText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
    fontSize: 10,
  },
  activeGameCard: {
    alignItems: "flex-start",
    backgroundColor: Colors.primary,
    borderRadius: Radius.card,
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.md,
    ...Shadow.card,
  },
  activeGameIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  activeGameSummary: {
    borderTopColor: "rgba(255,255,255,0.32)",
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
    minHeight: 44,
    paddingTop: Spacing.xs,
  },
  activeGameCardTitle: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
  },
  activeGameSummaryTitle: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
  },
  activeGameSummaryBody: {
    color: Colors.surface,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  yourSquadCard: {
    borderLeftColor: Colors.accentGreen,
    borderLeftWidth: 4,
    gap: Spacing.md,
  },
  yourSquadActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  yourSquadLoadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  cardCopy: {
    flex: 1,
    gap: 2,
  },
  cardEyebrow: {
    color: Colors.accentGold,
    fontFamily: Typography.bodyBold,
    fontSize: 11,
    textTransform: "uppercase",
  },
  cardTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
  },
  cardText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  challengeCard: {
    borderLeftColor: Colors.accentGold,
    borderLeftWidth: 4,
    gap: Spacing.sm,
  },
  challengeCardCompleted: {
    borderLeftColor: Colors.accentGreen,
  },
  challengeLoadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  challengeRewardRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  challengeRewardText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  challengeCompletedRow: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    flexDirection: "row",
    gap: Spacing.sm,
    padding: Spacing.sm,
  },
  challengeCompleteTitle: {
    color: Colors.accentGreen,
    fontFamily: Typography.bodyBold,
    fontSize: 14,
  },
  challengeResetText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
  },
  challengeErrorText: {
    color: Colors.primary,
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
  },
  primaryInlineButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flexDirection: "row",
    gap: Spacing.xs,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  primaryInlineText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  disabledInlineButton: {
    opacity: 0.7,
  },
  outlineInlineButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  outlineInlineText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  stateCard: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  stateTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    textAlign: "center",
  },
  stateBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
