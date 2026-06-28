import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { Bell, Gamepad2, Heart, MapPin, MessageCircle, Navigation, Play, RefreshCw, Star, Trophy } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  fetchActiveChallenge,
  fetchConnectionPrompt,
  fetchUnreadNotificationCount,
  fetchUserFriendIds,
  fetchUserSquadsDetail,
  subscribeLiveSquadCard,
  subscribeToActivityFeed,
  updateChallengeStatus,
  type ActivityItem,
  type Challenge,
  type ConnectionPrompt,
  type LiveSquadData,
  type SquadDetail,
} from "@/services/homeFeedService";
import { fetchActiveSquadSession, getGameLabel, type GameSession } from "@/services/gameService";
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
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<"accepted" | "complete" | null>(null);
  const [connectionPrompt, setConnectionPrompt] = useState<ConnectionPrompt | null>(null);
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const [proximityState, setProximityState] = useState<HomeProximityState>("checking");
  const [nearestSquad, setNearestSquad] = useState<Squad | null>(null);
  const [proximityLoading, setProximityLoading] = useState(false);

  const displayName = user?.displayName || user?.email?.split("@")[0] || t("profile.defaultName");

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
    const userId = user?.uid;

    activityUnsubscribe.current?.();
    liveSquadUnsubscribe.current?.();
    activityUnsubscribe.current = null;
    liveSquadUnsubscribe.current = null;

    try {
      const [friendIds, squadDetails, challenge, prompt, notificationCount, session] = await Promise.all([
        userId ? fetchUserFriendIds(userId) : Promise.resolve([]),
        fetchUserSquadsDetail(mySquadIds),
        fetchActiveChallenge(),
        fetchConnectionPrompt(),
        userId ? fetchUnreadNotificationCount(userId) : Promise.resolve(0),
        mySquadIds[0] ? fetchActiveSquadSession(mySquadIds[0]) : Promise.resolve(null),
      ]);

      setSquads(squadDetails);
      setActiveChallenge(challenge);
      setConnectionPrompt(prompt);
      setUnreadCount(notificationCount);
      setActiveSession(session);

      activityUnsubscribe.current = subscribeToActivityFeed(mySquadIds, friendIds, (items) => {
        setActivity(items.slice(0, 4));
      });

      liveSquadUnsubscribe.current = subscribeLiveSquadCard(mySquadIds, setLiveSquad);
    } catch (nextError) {
      console.warn("[HomeScreen] load error:", nextError);
      setError(t("home.errorBody"));
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadHome();
  }, [loadHome]);

  const handleChallengePress = useCallback(async () => {
    if (!user?.uid || !activeChallenge) return;

    const nextStatus = challengeStatus === "accepted" ? "complete" : "accepted";
    try {
      await updateChallengeStatus(user.uid, activeChallenge.challengeId, nextStatus);
      setChallengeStatus(nextStatus);
    } catch (nextError) {
      console.warn("[HomeScreen] challenge update error:", nextError);
      setError(t("home.errorBody"));
    }
  }, [activeChallenge, challengeStatus, t, user?.uid]);

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
            <Text style={styles.title}>{t("home.welcome", { name: displayName })}</Text>
            <Text style={styles.subtitle}>{t("home.subtitle")}</Text>
          </View>
          <View style={styles.notificationPill}>
            <Bell size={18} color={Colors.textHeading} />
            <Text style={styles.notificationText}>{unreadCount}</Text>
          </View>
        </View>

        {isLoading ? (
          <LoadingCard />
        ) : (
          <>
            {error ? <StateCard title={t("home.errorTitle")} body={error} /> : null}

            <QuickActions />

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

            {activeChallenge ? (
              <ChallengeCard
                challenge={activeChallenge}
                language={i18n.language}
                status={challengeStatus}
                onPress={handleChallengePress}
              />
            ) : (
              <CommunityPromptCard prompt={connectionPrompt} language={i18n.language} />
            )}

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

function QuickActions() {
  const { t } = useTranslation();
  const actions = [
    { label: t("home.playNow"), Icon: Gamepad2, route: "/(tabs)/games" },
    { label: t("home.joinCode"), Icon: Play, route: "/(tabs)/games?join=1" },
    { label: t("home.friends"), Icon: Heart, route: "/(tabs)/friends" },
    { label: t("home.chat"), Icon: MessageCircle, route: "/(social)/chat" },
    { label: t("home.leaderboard"), Icon: Trophy, route: "/leaderboard" },
  ];

  return (
    <View style={styles.quickGrid}>
      {actions.map(({ Icon, label, route }) => (
        <TouchableOpacity key={label} activeOpacity={0.86} onPress={() => router.push(route as never)} style={styles.quickAction}>
          <Icon size={21} color={Colors.primary} />
          <Text style={styles.quickText}>{label}</Text>
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
  language,
  onPress,
  status,
}: {
  challenge: Challenge;
  language: string;
  onPress: () => void;
  status: "accepted" | "complete" | null;
}) {
  const { t } = useTranslation();
  const title = language === "es" ? challenge.title_es || challenge.title : challenge.title;
  const description = language === "es" ? challenge.description_es || challenge.description : challenge.description;
  const label = status === "complete" ? t("home.completed") : status === "accepted" ? t("home.markComplete") : t("home.acceptChallenge");

  return (
    <Card style={styles.challengeCard}>
      <Text style={styles.cardEyebrow}>{t("home.thisWeeksChallenge")}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{description}</Text>
      <TouchableOpacity activeOpacity={0.86} onPress={onPress} style={styles.primaryInlineButton}>
        <Star size={16} color={Colors.surface} />
        <Text style={styles.primaryInlineText}>{label}</Text>
      </TouchableOpacity>
    </Card>
  );
}

function CommunityPromptCard({ prompt, language }: { prompt: ConnectionPrompt | null; language: string }) {
  const { t } = useTranslation();
  const text = prompt
    ? language === "es"
      ? prompt.promptText_es || prompt.promptText
      : prompt.promptText
    : t("home.communityPromptFallback");

  return (
    <Card style={styles.promptCard}>
      <Text style={styles.promptText}>{text}</Text>
      <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/(tabs)/friends")} style={styles.promptButton}>
        <Text style={styles.promptButtonText}>{t("home.friends")}</Text>
      </TouchableOpacity>
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
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  quickAction: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexBasis: "31%",
    flexGrow: 1,
    gap: Spacing.xs,
    minHeight: 78,
    justifyContent: "center",
    padding: Spacing.sm,
    ...Shadow.card,
  },
  quickText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
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
  promptCard: {
    backgroundColor: Colors.textHeading,
    gap: Spacing.md,
  },
  promptText: {
    color: Colors.background,
    fontFamily: Typography.accent,
    fontSize: 24,
    lineHeight: 30,
  },
  promptButton: {
    alignSelf: "flex-start",
    borderColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  promptButtonText: {
    color: Colors.background,
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
