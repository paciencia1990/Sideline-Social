import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { Bell, CheckCircle2, ChevronRight, MapPin, MessageCircle, Navigation, Play, RefreshCw, Star, Trophy, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { IcebreakerCard } from "@/components/IcebreakerCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { getFirstName } from "@/utils/profileName";
import {
  fetchUnreadNotificationCount,
  fetchUserFriendIds,
  fetchUserSquadsDetail,
  subscribeLiveSquadCard,
  subscribeToActivityFeed,
  type ActivityItem,
  type LiveSquadData,
  type SquadDetail,
} from "@/services/homeFeedService";
import { fetchActiveSquadSession, getGameLabel, type GameSession } from "@/services/gameService";
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
import {
  fetchNearbySquads,
  getCurrentLocation,
  getLocationPermissionStatus,
  requestLocationPermission,
  updateUserLocation,
  type Squad,
} from "@/services/squadService";

const logoSource = require("@/assets/branding/sideline-social-logo.png");

type HomeProximityState = "checking" | "idle" | "denied" | "loading" | "unavailable" | "nearby" | "memberNearby" | "none" | "error";

export default function HomeScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const { appConfig, mySquadIds } = useSquad();
  const activityUnsubscribe = useRef<(() => void) | null>(null);
  const liveSquadUnsubscribe = useRef<(() => void) | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [squads, setSquads] = useState<SquadDetail[]>([]);
  const [liveSquad, setLiveSquad] = useState<LiveSquadData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [myTeamsOverview, setMyTeamsOverview] = useState<ParentTeamsOverview | null>(null);
  const [myTeamsLoading, setMyTeamsLoading] = useState(true);
  const [myTeamsError, setMyTeamsError] = useState<string | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<UserWeeklyChallenge | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challengeCompletionLoading, setChallengeCompletionLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const [proximityState, setProximityState] = useState<HomeProximityState>("checking");
  const [nearestSquad, setNearestSquad] = useState<Squad | null>(null);
  const [proximityLoading, setProximityLoading] = useState(false);

  const firstName = getFirstName(user?.displayName);
  const welcomeText = firstName ? t("home.welcomeNamed", { firstName }) : t("home.welcome");

  useEffect(() => {
    if (__DEV__) {
      console.log("[WeeklyChallenge:HomeMounted]", {
        route: "/(tabs)/index",
        userId: user?.uid ?? null,
        language: i18n.language,
      });
    }
  }, [i18n.language, user?.uid]);

  const loadMyTeams = useCallback(async () => {
    if (!user?.uid) {
      setMyTeamsOverview(null);
      setMyTeamsLoading(false);
      return;
    }
    setMyTeamsLoading(true);
    setMyTeamsError(null);
    try {
      setMyTeamsOverview(await getParentTeamsOverview());
    } catch (nextError) {
      console.warn("[HomeScreen] My Teams load error:", nextError);
      setMyTeamsError(t("myTeams.loadError"));
    } finally {
      setMyTeamsLoading(false);
    }
  }, [t, user?.uid]);
  const loadHomeProximity = useCallback(async (requestPermission = false) => {
    setProximityLoading(true);
    setProximityState("loading");

    try {
      const permission = requestPermission ? await requestLocationPermission() : await getLocationPermissionStatus();
      if (permission === "undetermined") {
        setNearestSquad(null);
        setProximityState("idle");
        return;
      }
      if (permission === "denied") {
        setNearestSquad(null);
        setProximityState("denied");
        return;
      }

      const location = await getCurrentLocation();
      if (!location.coords) {
        setNearestSquad(null);
        setProximityState(location.error === "services_disabled" ? "unavailable" : "error");
        return;
      }

      if (user?.uid) {
        await updateUserLocation(user.uid, location.coords);
      }

      const nearby = await fetchNearbySquads(location.coords.latitude, location.coords.longitude, appConfig.squadRadiusMiles);
      const closest = nearby[0] ?? null;
      setNearestSquad(closest);

      if (!closest) {
        setProximityState("none");
        return;
      }

      setProximityState(mySquadIds.includes(closest.squadId) ? "memberNearby" : "nearby");
    } catch (nextError) {
      console.warn("[HomeScreen] proximity error:", nextError);
      setNearestSquad(null);
      setProximityState("error");
    } finally {
      setProximityLoading(false);
    }
  }, [appConfig.squadRadiusMiles, mySquadIds, user?.uid]);
  const loadHome = useCallback(async () => {
    setError(null);
    setChallengeError(null);
    const userId = user?.uid;

    activityUnsubscribe.current?.();
    liveSquadUnsubscribe.current?.();
    activityUnsubscribe.current = null;
    liveSquadUnsubscribe.current = null;

    try {
      const [friendIds, squadDetails, challengeResult, notificationCount, session] = await Promise.all([
        userId ? fetchUserFriendIds(userId) : Promise.resolve([]),
        fetchUserSquadsDetail(mySquadIds),
        userId
          ? getCurrentWeeklyChallenge()
              .then((challenge) => ({ challenge, failed: false }))
              .catch((challengeLoadError) => {
                console.warn("[HomeScreen] weekly challenge load error:", challengeLoadError);
                return { challenge: null, failed: true };
              })
          : Promise.resolve({ challenge: null, failed: false }),
        userId ? fetchUnreadNotificationCount(userId) : Promise.resolve(0),
        mySquadIds[0] ? fetchActiveSquadSession(mySquadIds[0]) : Promise.resolve(null),
      ]);

      const feedUserIds = userId ? Array.from(new Set([userId, ...friendIds])) : friendIds;

      setSquads(squadDetails);
      setActiveChallenge(challengeResult.challenge);
      setChallengeError(challengeResult.failed ? t("home.challengeError") : null);
      setUnreadCount(notificationCount);
      setActiveSession(session);

      activityUnsubscribe.current = subscribeToActivityFeed(mySquadIds, feedUserIds, (items) => {
        setActivity(items.slice(0, 4));
      });

      liveSquadUnsubscribe.current = subscribeLiveSquadCard(mySquadIds, setLiveSquad);
    } catch (nextError) {
      console.warn("[HomeScreen] load error:", nextError);
      setError(t("home.errorBody"));
      setActiveChallenge(null);
      setChallengeError(t("home.challengeError"));
      setActivity([]);
      setLiveSquad(null);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [mySquadIds, t, user?.uid]);

  useEffect(() => {
    void loadHome();

    return () => {
      activityUnsubscribe.current?.();
      liveSquadUnsubscribe.current?.();
    };
  }, [loadHome]);

  useEffect(() => {
    void loadHomeProximity(false);
  }, [loadHomeProximity]);

  useFocusEffect(useCallback(() => {
    void loadMyTeams();
  }, [loadMyTeams]));
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadHome();
    void loadMyTeams();
  }, [loadHome, loadMyTeams]);

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
                    : t("home.challengeSuccessBody", { points: result.pointsAwarded }),
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
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={Colors.primary} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCard}>
          <Image source={logoSource} style={styles.logo} resizeMode="contain" />
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>{t("app.name")}</Text>
            <Text style={styles.title}>{welcomeText}</Text>
            <Text style={styles.subtitle}>{t("home.subtitle")}</Text>
          </View>
          <View style={styles.notificationPill}>
            <Bell size={18} color={Colors.textHeading} />
            <Text style={styles.notificationText}>{unreadCount}</Text>
          </View>
        </View>
        <MyTeamsCard
          error={myTeamsError}
          loading={myTeamsLoading}
          onRetry={loadMyTeams}
          overview={myTeamsOverview}
        />
        {isLoading ? (
          <LoadingCard />
        ) : (
          <>
            {error ? <StateCard title={t("home.errorTitle")} body={error} /> : null}

            {activeSession ? (
              <TouchableOpacity
                activeOpacity={0.86}
                onPress={() => router.push("/(tabs)/games")}
                style={styles.activeGameCard}
              >
                <View style={styles.activeGameIcon}>
                  <Play size={22} color={Colors.surface} fill={Colors.surface} />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.cardEyebrow}>{t("home.activeGame")}</Text>
                  <Text style={styles.cardTitle}>{t("games.squadPlaying", { game: getGameLabel(activeSession.gameType) })}</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            <SectionTitle title={t("home.liveSquad")} />
            {liveSquad ? (
              <LiveSquadCard squad={liveSquad} />
            ) : (
              <HomeProximityCard
                loading={proximityLoading}
                nearestSquad={nearestSquad}
                onFind={() => loadHomeProximity(true)}
                onRetry={() => loadHomeProximity(false)}
                state={proximityState}
              />
            )}
            {!liveSquad && squads.length > 0 ? <SquadSummaryCard squads={squads} /> : null}

            <SecondaryActions />

            <ChallengeCard
              challenge={activeChallenge}
              completionLoading={challengeCompletionLoading}
              error={challengeError}
              loading={isLoading}
              onPress={confirmChallengeCompletion}
              onRetry={loadHome}
            />

            <IcebreakerCard />

            <SectionTitle title={t("home.activity")} />
            {activity.length > 0 ? (
              <View style={styles.activityList}>
                {activity.map((item) => <ActivityRow key={item.activityId} item={item} language={i18n.language} />)}
              </View>
            ) : (
              <StateCard
                icon={<Star size={28} color={Colors.accentGold} />}
                title={t("home.emptyFeedTitle")}
                body={t("home.emptyFeedSubtitle")}
              />
            )}
          </>
        )}
      </ScrollView>
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
                {overview.unreadCount > 0 ? " · " + t("myTeams.unreadUpdates", { count: overview.unreadCount }) : ""}
              </Text>
            ) : (
              <Text style={styles.myTeamsSummary}>{t("myTeams.noTeams")}</Text>
            )}
          </View>
          {overview?.unreadCount ? (
            <View style={styles.myTeamsBadge}>
              <Text style={styles.myTeamsBadgeText}>{overview.unreadCount}</Text>
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
            <Text numberOfLines={2} style={styles.myTeamsPreviewBody}>{latest.body}</Text>
          </View>
        ) : null}

        {!loading && overview?.totalTeams && overview.unreadCount === 0 ? (
          <Text style={styles.myTeamsCaughtUp}>{t("myTeams.caughtUp")}</Text>
        ) : null}

        <Text style={styles.myTeamsAction}>{t("myTeams.viewTeams")}</Text>
      </Card>
    </TouchableOpacity>
  );
}
function SecondaryActions() {
  const { t } = useTranslation();
  const actions = [
    { label: t("home.chat"), Icon: MessageCircle, route: "/(social)/chat" },
    { label: t("home.leaderboard"), Icon: Trophy, route: "/leaderboard" },
  ];

  return (
    <View style={styles.secondaryActionRow}>
      {actions.map(({ Icon, label, route }) => (
        <TouchableOpacity
          key={label}
          accessibilityLabel={label}
          accessibilityRole="button"
          activeOpacity={0.86}
          onPress={() => router.push(route as never)}
          style={styles.secondaryActionCard}
        >
          <Icon size={21} color={Colors.primary} />
          <Text style={styles.secondaryActionText}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function HomeProximityCard({
  loading,
  nearestSquad,
  onFind,
  onRetry,
  state,
}: {
  loading: boolean;
  nearestSquad: Squad | null;
  onFind: () => void;
  onRetry: () => void;
  state: HomeProximityState;
}) {
  const { t } = useTranslation();
  const isNearby = state === "nearby" || state === "memberNearby";
  const title = (() => {
    if (state === "checking" || state === "loading") return t("location.loading");
    if (state === "idle") return t("squad.findNearby");
    if (state === "denied") return t("location.permissionTitle");
    if (state === "unavailable") return t("location.unavailableTitle");
    if (state === "error") return t("location.errorTitle");
    if (state === "memberNearby") return t("location.yourSquadNearbyTitle");
    if (state === "nearby") return nearestSquad?.name ?? t("location.nearbyTitle");
    return t("location.noNearbyTitle");
  })();
  const body = (() => {
    if (state === "checking" || state === "loading") return t("location.loadingBody");
    if (state === "idle") return t("location.findNearbyBody");
    if (state === "denied") return t("location.permissionBody");
    if (state === "unavailable") return t("location.unavailableBody");
    if (state === "error") return t("location.errorBody");
    if (state === "memberNearby") return t("location.yourSquadNearbyBody");
    if (state === "nearby") return t("location.nearbyBody");
    return t("location.noNearbyBody");
  })();
  const actionLabel = state === "idle" ? t("location.allowLocation") : isNearby ? t("squad.viewSquad") : t("location.retry");
  const action = state === "idle" ? onFind : isNearby ? () => router.push("/(tabs)/squad") : onRetry;

  return (
    <Card style={[styles.proximityCard, isNearby && styles.proximityCardActive]}>
      <View style={styles.proximityHeader}>
        <View style={styles.proximityIcon}>
          {loading ? <ActivityIndicator color={Colors.primary} size="small" /> : isNearby ? <Navigation size={22} color={Colors.primary} /> : <MapPin size={22} color={Colors.primary} />}
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardEyebrow}>{t("squad.liveTitle")}</Text>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardText}>{body}</Text>
        </View>
      </View>
      {nearestSquad ? (
        <View style={styles.proximityMetaRow}>
          <Text style={styles.proximityMeta}>{nearestSquad.venueName}</Text>
          {nearestSquad.distanceMiles !== undefined ? <Text style={styles.proximityMeta}>{t("squad.distance", { distance: nearestSquad.distanceMiles.toFixed(1) })}</Text> : null}
        </View>
      ) : null}
      <TouchableOpacity activeOpacity={0.86} onPress={action} style={isNearby ? styles.primaryInlineButton : styles.outlineInlineButton}>
        {loading ? <RefreshCw size={16} color={isNearby ? Colors.surface : Colors.primary} /> : null}
        <Text style={isNearby ? styles.primaryInlineText : styles.outlineInlineText}>{actionLabel}</Text>
      </TouchableOpacity>
    </Card>
  );
}

function LiveSquadCard({ squad }: { squad: LiveSquadData }) {
  const { t } = useTranslation();

  return (
    <Card style={styles.liveCard}>
      <View style={styles.liveHeader}>
        <View>
          <Text style={styles.cardTitle}>{squad.name}</Text>
          <Text style={styles.cardText}>{squad.venueName}</Text>
        </View>
        <View style={styles.livePill}>
          <Text style={styles.livePillText}>{t("home.live")}</Text>
        </View>
      </View>
      <Text style={styles.cardText}>{t("home.parentsActiveNow", { count: squad.activeMemberCount })}</Text>
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={() => router.push({ pathname: "/(social)/squad-chat", params: { squadId: squad.squadId } })}
        style={styles.primaryInlineButton}
      >
        <MessageCircle size={16} color={Colors.surface} />
        <Text style={styles.primaryInlineText}>{t("home.joinChat")}</Text>
      </TouchableOpacity>
    </Card>
  );
}

function SquadSummaryCard({ squads }: { squads: SquadDetail[] }) {
  const { t } = useTranslation();
  const firstSquad = squads[0];

  return (
    <Card style={styles.cardGap}>
      <Text style={styles.cardTitle}>{firstSquad?.name ?? t("squad.title")}</Text>
      <Text style={styles.cardText}>{t("home.squadSummary", { count: squads.length })}</Text>
      <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/(tabs)/squad")} style={styles.outlineInlineButton}>
        <Text style={styles.outlineInlineText}>{t("home.viewSquads")}</Text>
      </TouchableOpacity>
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

  return (
    <Card style={[styles.challengeCard, challenge.completed && styles.challengeCardCompleted]}>
      <Text style={styles.cardEyebrow}>{t("home.thisWeeksChallenge")}</Text>
      <Text style={styles.cardTitle}>{challenge.title}</Text>
      <Text style={styles.cardText}>{challenge.description}</Text>
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
function ActivityRow({ item, language }: { item: ActivityItem; language: string }) {
  const message = language === "es" ? item.message_es || item.message : item.message;

  return (
    <Card style={styles.activityCard}>
      <View style={styles.activityAvatar}>
        <Text style={styles.activityInitial}>{getInitial(item.displayName)}</Text>
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.activityMessage}>{message}</Text>
        <Text style={styles.activityTime}>{formatRelativeTime(item.createdAt)}</Text>
      </View>
    </Card>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function LoadingCard() {
  const { t } = useTranslation();

  return (
    <Card style={styles.loadingCard}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={styles.cardText}>{t("common.loading")}</Text>
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

function getInitial(name: string) {
  return name.trim()[0]?.toUpperCase() || "S";
}

function formatRelativeTime(date: Date) {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  scroll: {
    gap: Spacing.md,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  headerCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    gap: Spacing.md,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  logo: {
    height: 86,
    width: "100%",
  },
  headerCopy: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  kicker: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    textTransform: "uppercase",
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 28,
    textAlign: "center",
  },
  subtitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  notificationPill: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
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
  activeGameCard: {
    alignItems: "center",
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
  sectionTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
  },
  proximityCard: {
    gap: Spacing.md,
  },
  proximityCardActive: {
    borderLeftColor: Colors.accentGreen,
    borderLeftWidth: 4,
  },
  proximityHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.md,
  },
  proximityIcon: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  proximityMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  proximityMeta: {
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    color: Colors.textPrimary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    overflow: "hidden",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },  liveCard: {
    borderLeftColor: Colors.accentGreen,
    borderLeftWidth: 4,
    gap: Spacing.sm,
  },
  liveHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  livePill: {
    backgroundColor: Colors.accentGreen,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  livePillText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
    fontSize: 10,
  },
  cardGap: {
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
  activityList: {
    gap: Spacing.sm,
  },
  activityCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  activityAvatar: {
    alignItems: "center",
    backgroundColor: Colors.secondary,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  activityInitial: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 14,
  },
  activityMessage: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  activityTime: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 11,
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
  loadingCard: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
});
