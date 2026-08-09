import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Bomb, BookOpen, ShieldCheck, Users } from "lucide-react-native";
import LottieView from "lottie-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { SafeAreaView } from "react-native-safe-area-context";

import { GameEndActions } from "@/components/GameEndActions";
import { GameRewardSummary } from "@/components/GameRewardSummary";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import {
  createGameJoinIdempotencyKey,
  getBombDefusalPlayerView,
  readGameJoinCodeFailureReason,
  startGameLobbyRematch,
  submitBombDefusalStep,
  type BombDefusalPlayerView,
  type BombPrivateInstruction,
  type BombPublicCommand,
  type BombPublicOption,
  type GameJoinCodeFailureReason,
} from "@/services/gameJoinCodeService";
import { subscribeToSession } from "@/services/gameService";
import {
  createGameRewardSession,
  finalizeGameReward,
  recordGameSessionResult,
  type GameRewardResult,
} from "@/services/sidelineStarsService";

type BombOutcome = "playing" | "defused" | "exploded" | "abandoned";

const explosionAnimation = require("../../assets/animations/explosion.json");
const wireCutAnimation = require("../../assets/animations/wireCut.json");

export default function BombDefusalScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { currentSquad, selectedSquadId } = useSquad();
  const params = useLocalSearchParams<{ sessionId?: string | string[]; lobbyId?: string | string[] }>();
  const sessionId = normalizeRouteParam(params.sessionId);
  const lobbyId = normalizeRouteParam(params.lobbyId);
  const [playerView, setPlayerView] = useState<BombDefusalPlayerView | null>(null);
  const [viewLoading, setViewLoading] = useState(Boolean(sessionId));
  const [viewError, setViewError] = useState<GameJoinCodeFailureReason | null>(null);
  const [sessionOutcome, setSessionOutcome] = useState<BombOutcome | null>(null);
  const [hostUserId, setHostUserId] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [deadlineLocalMs, setDeadlineLocalMs] = useState(0);
  const [codeInput, setCodeInput] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<GameJoinCodeFailureReason | null>(null);
  const [rewardSessionId, setRewardSessionId] = useState("");
  const [rewardSetupAttempt, setRewardSetupAttempt] = useState(0);
  const [rewardResult, setRewardResult] = useState<GameRewardResult | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const publicSignatureRef = useRef("");
  const timeoutRefreshRef = useRef("");
  const finalizedRewardKeyRef = useRef("");
  const rematchInFlightRef = useRef(false);
  const submissionIdsRef = useRef(new Map<string, string>());

  const refreshPlayerView = useCallback(async (showLoading = false) => {
    if (!sessionId) {
      setViewLoading(false);
      return;
    }
    const requestSequence = ++requestSequenceRef.current;
    if (showLoading) setViewLoading(true);
    try {
      const nextView = await getBombDefusalPlayerView({ sessionId });
      if (requestSequence !== requestSequenceRef.current) return;
      setPlayerView(nextView);
      setViewError(null);
      setSessionOutcome(nextView.outcome === "playing" ? null : nextView.outcome);
      const localDeadline = Date.now() + Math.max(0, nextView.endsAtMs - nextView.serverNowMs);
      setDeadlineLocalMs(localDeadline);
      setTimeLeft(Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000)));
    } catch (error) {
      if (requestSequence !== requestSequenceRef.current) return;
      setViewError(readGameJoinCodeFailureReason(error));
    } finally {
      if (requestSequence === requestSequenceRef.current) setViewLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    requestSequenceRef.current += 1;
    publicSignatureRef.current = "";
    timeoutRefreshRef.current = "";
    submissionIdsRef.current.clear();
    setPlayerView(null);
    setSessionOutcome(null);
    setViewError(null);
    setViewLoading(Boolean(sessionId));
    setActionError(null);
    setCodeInput("");
    if (sessionId) void refreshPlayerView(true);
  }, [refreshPlayerView, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    return subscribeToSession(sessionId, (session) => {
      if (!session) {
        setViewError("game_not_found");
        return;
      }
      setHostUserId(session.hostUserId);
      const publicOutcome = readBombOutcome(session.gameState.outcome);
      if (session.status === "canceled" || session.status === "expired") {
        setSessionOutcome("abandoned");
        return;
      }
      if (publicOutcome) setSessionOutcome(publicOutcome);
      const signature = [
        session.status,
        String(session.gameState.currentCommandId ?? ""),
        String(session.gameState.roleRevision ?? ""),
        publicOutcome ?? "playing",
        String(session.updatedAt ?? ""),
      ].join(":");
      if (signature === publicSignatureRef.current) return;
      publicSignatureRef.current = signature;
      void refreshPlayerView(false);
    });
  }, [refreshPlayerView, sessionId]);

  useEffect(() => {
    if (!deadlineLocalMs || (sessionOutcome ?? playerView?.outcome ?? "playing") !== "playing") return;
    const update = () => setTimeLeft(Math.max(0, Math.ceil((deadlineLocalMs - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [deadlineLocalMs, playerView?.outcome, sessionOutcome]);

  useEffect(() => {
    if (!playerView || timeLeft !== 0 || playerView.outcome !== "playing") return;
    const timeoutKey = `${sessionId}:${playerView.commandId}`;
    if (timeoutRefreshRef.current === timeoutKey) return;
    timeoutRefreshRef.current = timeoutKey;
    void refreshPlayerView(false);
  }, [playerView, refreshPlayerView, sessionId, timeLeft]);

  useEffect(() => {
    setCodeInput("");
    setActionError(null);
  }, [playerView?.commandId]);

  useEffect(() => {
    let active = true;
    setRewardSessionId("");
    setRewardResult(null);
    setRewardError(null);
    finalizedRewardKeyRef.current = "";
    if (!sessionId) return () => { active = false; };
    void createGameRewardSession({
      gameType: "bombDefusal",
      sessionId,
      sourceSquadId: currentSquad?.squadId ?? null,
    }).then((created) => {
      if (active) setRewardSessionId(created.sessionId);
    }).catch(() => {
      if (active) setRewardError(t("rewards.awardError"));
    });
    return () => { active = false; };
  }, [currentSquad?.squadId, rewardSetupAttempt, sessionId, t]);

  const outcome = sessionOutcome ?? playerView?.outcome ?? "playing";

  const awardCurrentResult = useCallback(async () => {
    if (!playerView || !rewardSessionId || (outcome !== "defused" && outcome !== "exploded")) return;
    const rewardKey = `${rewardSessionId}:${outcome}`;
    if (finalizedRewardKeyRef.current === rewardKey && rewardResult) return;
    finalizedRewardKeyRef.current = rewardKey;
    setRewardLoading(true);
    setRewardError(null);
    try {
      await recordGameSessionResult({
        gameType: "bombDefusal",
        sessionId: rewardSessionId,
        outcome,
        firstAttemptCorrectStepCount: playerView.correctCommandCount,
        totalSteps: playerView.totalCommands,
      });
      setRewardResult(await finalizeGameReward("bombDefusal", rewardSessionId));
    } catch {
      finalizedRewardKeyRef.current = "";
      setRewardError(t("rewards.awardError"));
    } finally {
      setRewardLoading(false);
    }
  }, [outcome, playerView, rewardResult, rewardSessionId, t]);

  useEffect(() => {
    if (rewardSessionId && (outcome === "defused" || outcome === "exploded")) {
      void awardCurrentResult();
    }
  }, [awardCurrentResult, outcome, rewardSessionId]);

  const submitAction = useCallback(async (action: Record<string, string | number>) => {
    if (!playerView || playerView.role !== "defuser" || outcome !== "playing" || actionSubmitting) return;
    const submissionKey = `${playerView.commandId}:${JSON.stringify(action)}`;
    const submissionId = submissionIdsRef.current.get(submissionKey) ?? createGameJoinIdempotencyKey();
    submissionIdsRef.current.set(submissionKey, submissionId);
    setActionSubmitting(true);
    setActionError(null);
    try {
      await submitBombDefusalStep({
        sessionId,
        commandId: playerView.commandId,
        action,
        submissionId,
      });
      submissionIdsRef.current.delete(submissionKey);
      await refreshPlayerView(false);
    } catch (error) {
      const reason = readGameJoinCodeFailureReason(error);
      setActionError(reason);
      if (reason === "bomb_command_stale") void refreshPlayerView(false);
    } finally {
      setActionSubmitting(false);
    }
  }, [actionSubmitting, outcome, playerView, refreshPlayerView, sessionId]);

  const openLobbyDirectory = useCallback(() => {
    if (selectedSquadId) {
      router.replace({
        pathname: "/(games)/lobbies",
        params: { gameType: "bombDefusal", squadId: selectedSquadId },
      } as never);
      return;
    }
    router.replace("/(tabs)/games" as never);
  }, [selectedSquadId]);

  const handlePlayAgain = useCallback(async () => {
    if (!sessionId || !lobbyId || hostUserId !== user?.uid || rematchInFlightRef.current) {
      openLobbyDirectory();
      return;
    }
    rematchInFlightRef.current = true;
    try {
      const rematch = await startGameLobbyRematch({ lobbyId });
      router.replace({
        pathname: "/(games)/bomb-defusal/Lobby",
        params: { lobbyId: rematch.lobbyId, sessionId: rematch.sessionId },
      } as never);
    } catch {
      openLobbyDirectory();
    } finally {
      rematchInFlightRef.current = false;
    }
  }, [hostUserId, lobbyId, openLobbyDirectory, sessionId, user?.uid]);

  const feedback = useMemo(() => {
    if (actionError === "bomb_not_defuser") return t("bomb.feedback.notDefuser");
    if (actionError === "bomb_command_stale") return t("bomb.feedback.stale");
    if (actionError) return t("bomb.feedback.actionFailed");
    if (playerView?.lastResult?.correct === true) return t("bomb.feedback.correct");
    if (playerView?.lastResult?.correct === false) return t("bomb.feedback.incorrect");
    return t("bomb.feedback.waiting");
  }, [actionError, playerView?.lastResult?.correct, t]);

  if (!sessionId) {
    return <BombUnavailable onBack={openLobbyDirectory} onRetry={() => undefined} retryable={false} />;
  }

  if (!playerView && viewLoading && outcome === "playing") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View accessibilityLiveRegion="polite" style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.bodyText}>{t("bomb.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!playerView && viewError && outcome === "playing") {
    return <BombUnavailable onBack={openLobbyDirectory} onRetry={() => void refreshPlayerView(true)} retryable />;
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Bomb color={Colors.primary} size={25} />
            <Text accessibilityRole="header" style={styles.title}>{t("games.bombDefusal.title")}</Text>
          </View>
          <Text
            accessibilityLabel={t("bomb.secondsRemaining", { count: timeLeft })}
            accessibilityLiveRegion="polite"
            style={[styles.timer, timeLeft <= 10 && styles.dangerTimer]}
          >
            {t("bomb.secondsShort", { count: timeLeft })}
          </Text>
        </View>

        {playerView ? (
          <>
            <RoleCard playerView={playerView} />
            <View
              accessible
              accessibilityLabel={`${t("bomb.accessibility.progressSummary", {
                current: Math.min(playerView.commandIndex + 1, playerView.totalCommands),
                total: playerView.totalCommands,
              })}. ${t("bomb.accessibility.strikeSummary", {
                count: playerView.strikeCount,
                max: playerView.maxStrikes,
              })}`}
              style={styles.progressCard}
            >
              <Text style={styles.progressText}>
                {t("bomb.commandProgress", {
                  current: Math.min(playerView.commandIndex + 1, playerView.totalCommands),
                  total: playerView.totalCommands,
                })}
              </Text>
              <Text style={styles.strikeText}>
                {t("bomb.strikeProgress", { count: playerView.strikeCount, max: playerView.maxStrikes })}
              </Text>
            </View>
          </>
        ) : null}

        {outcome === "playing" && playerView ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.feedback}>{feedback}</Text>
            {playerView.role === "expert" ? (
              <ExpertInstruction playerView={playerView} />
            ) : (
              <BombControls
                actionSubmitting={actionSubmitting}
                codeInput={codeInput}
                interactive={playerView.role === "defuser"}
                onClearCode={() => setCodeInput("")}
                onCodeDigit={(digit) => setCodeInput((value) => value.length >= 3 ? value : `${value}${digit}`)}
                onSubmit={submitAction}
                onSubmitCode={() => void submitAction({ code: Number(codeInput) })}
                publicCommand={playerView.publicCommand}
              />
            )}
          </>
        ) : (
          <BombResult
            correctCommandCount={playerView?.correctCommandCount ?? 0}
            hostCanRematch={hostUserId === user?.uid}
            onBack={openLobbyDirectory}
            onPlayAgain={handlePlayAgain}
            onRetryReward={() => rewardSessionId
              ? void awardCurrentResult()
              : setRewardSetupAttempt((value) => value + 1)}
            outcome={outcome}
            rewardError={rewardError}
            rewardLoading={rewardLoading}
            rewardResult={rewardResult}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RoleCard({ playerView }: { playerView: BombDefusalPlayerView }) {
  const { t } = useTranslation();
  const RoleIcon = playerView.role === "defuser" ? ShieldCheck : playerView.role === "expert" ? BookOpen : Users;
  return (
    <View
      accessible
      accessibilityLabel={t("bomb.accessibility.roleSummary", {
        role: t(`bomb.roles.${playerView.role}.title`),
        defuser: playerView.defuserDisplayName,
        expert: playerView.expertDisplayName,
      })}
      style={styles.roleCard}
    >
      <View style={styles.roleHeading}>
        <View style={styles.roleIcon}>
          <RoleIcon color={Colors.surface} size={20} />
        </View>
        <View style={styles.roleCopy}>
          <Text style={styles.roleEyebrow}>{t("bomb.roleLabel")}</Text>
          <Text style={styles.roleTitle}>{t(`bomb.roles.${playerView.role}.title`)}</Text>
        </View>
      </View>
      <Text style={styles.roleBody}>{t(`bomb.roles.${playerView.role}.body`)}</Text>
      <Text style={styles.assignmentText}>
        {t("bomb.roleAssignments", {
          defuser: playerView.defuserDisplayName,
          expert: playerView.expertDisplayName,
        })}
      </Text>
    </View>
  );
}

function ExpertInstruction({ playerView }: { playerView: BombDefusalPlayerView }) {
  const { t } = useTranslation();
  const instruction = playerView.instruction
    ? describePrivateInstruction(playerView.instruction, playerView.publicCommand, t)
    : t("bomb.feedback.actionFailed");
  return (
    <View accessible accessibilityLabel={`${t("bomb.privateInstructionTitle")}. ${instruction}`} style={styles.instructionCard}>
      <Text style={styles.instructionEyebrow}>{t("bomb.privateInstructionTitle")}</Text>
      <Text style={styles.instructionText}>{instruction}</Text>
      <Text style={styles.instructionHint}>{t("bomb.privateInstructionHint")}</Text>
    </View>
  );
}

function BombControls({
  actionSubmitting,
  codeInput,
  interactive,
  onClearCode,
  onCodeDigit,
  onSubmit,
  onSubmitCode,
  publicCommand,
}: {
  actionSubmitting: boolean;
  codeInput: string;
  interactive: boolean;
  onClearCode: () => void;
  onCodeDigit: (digit: string) => void;
  onSubmit: (action: Record<string, string | number>) => void | Promise<void>;
  onSubmitCode: () => void;
  publicCommand: BombPublicCommand;
}) {
  const { t } = useTranslation();
  const title = interactive ? t("bomb.defuserControlsTitle") : t("bomb.supportControlsTitle");
  if (publicCommand.type === "enter_code") {
    return (
      <View style={styles.controlsCard}>
        <Text style={styles.controlsTitle}>{title}</Text>
        {!interactive ? <Text style={styles.readOnlyHint}>{t("bomb.readOnlyHint")}</Text> : null}
        {interactive ? (
          <Text accessibilityLabel={t("bomb.accessibility.codeReadout", { code: codeInput || t("bomb.emptyCode") })} style={styles.codeReadout}>
            {codeInput.padEnd(3, "_")}
          </Text>
        ) : null}
        <View style={styles.optionGrid}>
          {publicCommand.options.map((option) => (
            <OptionControl
              disabled={actionSubmitting || !interactive}
              interactive={interactive}
              key={option.id}
              label={t("bomb.options.digit", { digit: option.value })}
              marker={t("bomb.markers.keypad")}
              number={option.number}
              onPress={() => onCodeDigit(String(option.value))}
            />
          ))}
        </View>
        {interactive ? (
          <View style={styles.codeActions}>
            <Pressable accessibilityRole="button" onPress={onClearCode} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{t("bomb.controls.clear")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: codeInput.length !== 3 || actionSubmitting }}
              disabled={codeInput.length !== 3 || actionSubmitting}
              onPress={onSubmitCode}
              style={[styles.submitButton, (codeInput.length !== 3 || actionSubmitting) && styles.disabledButton]}
            >
              {actionSubmitting
                ? <ActivityIndicator color={Colors.surface} size="small" />
                : <Text style={styles.submitButtonText}>{t("bomb.controls.enter")}</Text>}
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.controlsCard}>
      <Text style={styles.controlsTitle}>{title}</Text>
      {!interactive ? <Text style={styles.readOnlyHint}>{t("bomb.readOnlyHint")}</Text> : null}
      <View style={styles.optionGrid}>
        {publicCommand.options.map((option) => (
          <OptionControl
            disabled={actionSubmitting || !interactive}
            interactive={interactive}
            key={option.id}
            label={describePublicOption(publicCommand.type, option, t)}
            marker={t(`bomb.markers.${option.marker}`)}
            number={option.number}
            onPress={() => void onSubmit(actionForOption(publicCommand.type, option))}
            swatch={publicCommand.type === "cut_wire" ? String(option.value) : undefined}
          />
        ))}
      </View>
    </View>
  );
}

function OptionControl({
  disabled,
  interactive,
  label,
  marker,
  number,
  onPress,
  swatch,
}: {
  disabled: boolean;
  interactive: boolean;
  label: string;
  marker: string;
  number: number;
  onPress: () => void;
  swatch?: string;
}) {
  const { t } = useTranslation();
  const content = (
    <>
      <View style={styles.optionHeader}>
        <View style={styles.optionNumber}><Text style={styles.optionNumberText}>{number}</Text></View>
        {swatch ? <View style={[styles.wireSwatch, wireSwatchStyle(swatch)]} /> : null}
      </View>
      <Text style={styles.optionLabel}>{label}</Text>
      <Text style={styles.optionMarker}>{marker}</Text>
    </>
  );
  const accessibilityLabel = interactive
    ? t("bomb.accessibility.selectableOption", { number, label, marker })
    : t("bomb.accessibility.readOnlyOption", { number, label, marker });
  if (!interactive) {
    return <View accessible accessibilityLabel={accessibilityLabel} style={styles.optionControl}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.optionControl, pressed && styles.optionPressed, disabled && styles.disabledButton]}
    >
      {content}
    </Pressable>
  );
}

function BombResult({
  correctCommandCount,
  hostCanRematch,
  onBack,
  onPlayAgain,
  onRetryReward,
  outcome,
  rewardError,
  rewardLoading,
  rewardResult,
}: {
  correctCommandCount: number;
  hostCanRematch: boolean;
  onBack: () => void;
  onPlayAgain: () => void | Promise<void>;
  onRetryReward: () => void;
  outcome: BombOutcome;
  rewardError: string | null;
  rewardLoading: boolean;
  rewardResult: GameRewardResult | null;
}) {
  const { t } = useTranslation();
  const resultKey = outcome === "defused" ? "defused" : outcome === "exploded" ? "exploded" : "abandoned";
  return (
    <View accessibilityLiveRegion="polite" style={styles.resultCard}>
      {outcome === "exploded" ? (
        <LottieView autoPlay loop={false} source={explosionAnimation} style={styles.animation} />
      ) : outcome === "defused" ? (
        <LottieView autoPlay loop={false} source={wireCutAnimation} style={styles.animation} />
      ) : null}
      <Text accessibilityRole="header" style={styles.resultTitle}>{t(`bomb.results.${resultKey}Title`)}</Text>
      <Text style={styles.resultBody}>{t(`bomb.results.${resultKey}Body`)}</Text>
      {outcome !== "abandoned" ? (
        <GameRewardSummary
          detailLines={[t("rewards.accuracyBonus", { count: correctCommandCount })]}
          error={rewardError}
          loading={rewardLoading}
          onRetry={onRetryReward}
          result={rewardResult}
        />
      ) : null}
      <GameEndActions
        onBackToLobby={onBack}
        onPlayAgain={onPlayAgain}
        lobbyRoute="/(games)/bomb-defusal/Lobby"
      />
      {!hostCanRematch ? <Text style={styles.rematchHint}>{t("bomb.results.hostStartsRematch")}</Text> : null}
    </View>
  );
}

function BombUnavailable({
  onBack,
  onRetry,
  retryable,
}: {
  onBack: () => void;
  onRetry: () => void;
  retryable: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <Bomb color={Colors.primary} size={34} />
        <Text accessibilityRole="header" style={styles.resultTitle}>{t("bomb.sessionUnavailableTitle")}</Text>
        <Text accessibilityRole="alert" style={styles.resultBody}>{t("bomb.sessionUnavailableBody")}</Text>
        {retryable ? (
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.submitButton}>
            <Text style={styles.submitButtonText}>{t("common.retry")}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{t("game.backToLobby")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function describePrivateInstruction(
  instruction: BombPrivateInstruction,
  publicCommand: BombPublicCommand,
  t: TFunction,
) {
  if (instruction.type === "cut_wire") {
    const option = publicCommand.options.find((candidate) => candidate.value === instruction.color);
    return t("bomb.instructions.cutWireDetailed", {
      color: t(`bomb.colors.${instruction.color}`),
      marker: option ? t(`bomb.markers.${option.marker}`) : "",
      number: option?.number ?? "",
    });
  }
  if (instruction.type === "press_button") {
    const option = publicCommand.options.find((candidate) => candidate.value === instruction.label);
    return t("bomb.instructions.pressButtonDetailed", {
      label: instruction.label,
      marker: option ? t(`bomb.markers.${option.marker}`) : "",
      number: option?.number ?? "",
    });
  }
  if (instruction.type === "rotate_dial") {
    return t("bomb.instructions.rotateDial", { target: instruction.target });
  }
  return t("bomb.instructions.enterCode", { code: instruction.code });
}

function describePublicOption(type: BombPublicCommand["type"], option: BombPublicOption, t: TFunction) {
  if (type === "cut_wire") {
    return t("bomb.options.wire", { color: t(`bomb.colors.${String(option.value)}`) });
  }
  if (type === "press_button") return t("bomb.options.button", { label: option.value });
  if (type === "rotate_dial") return t("bomb.options.dial", { value: option.value });
  return t("bomb.options.digit", { digit: option.value });
}

function actionForOption(
  type: BombPublicCommand["type"],
  option: BombPublicOption,
): Record<string, string | number> {
  if (type === "cut_wire") return { color: String(option.value) };
  if (type === "press_button") return { label: String(option.value) };
  if (type === "rotate_dial") return { target: Number(option.value) };
  return { code: Number(option.value) };
}

function readBombOutcome(value: unknown): Exclude<BombOutcome, "playing"> | null {
  return value === "defused" || value === "exploded" || value === "abandoned" ? value : null;
}

function normalizeRouteParam(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

function wireSwatchStyle(color: string) {
  if (color === "red") return styles.redWire;
  if (color === "blue") return styles.blueWire;
  if (color === "yellow") return styles.yellowWire;
  return styles.greenWire;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  container: { flexGrow: 1, gap: Spacing.md, padding: Spacing.md, paddingBottom: Spacing.xxl },
  centered: { alignItems: "center", flex: 1, gap: Spacing.md, justifyContent: "center", padding: Spacing.lg },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "space-between" },
  titleRow: { alignItems: "center", flex: 1, flexDirection: "row", gap: Spacing.sm, minWidth: 0 },
  title: { color: Colors.textHeading, flexShrink: 1, fontFamily: Typography.heading, fontSize: 25 },
  timer: { color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 22 },
  dangerTimer: { color: Colors.primary },
  roleCard: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, gap: Spacing.sm, padding: Spacing.md },
  roleHeading: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  roleIcon: { alignItems: "center", backgroundColor: Colors.textHeading, borderRadius: 8, height: 40, justifyContent: "center", width: 40 },
  roleCopy: { flex: 1, minWidth: 0 },
  roleEyebrow: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 11, textTransform: "uppercase" },
  roleTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 20 },
  roleBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  assignmentText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19 },
  progressCard: { backgroundColor: `${Colors.accentGold}18`, borderColor: Colors.accentGold, borderRadius: Radius.sm, borderWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, justifyContent: "space-between", padding: Spacing.md },
  progressText: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 14 },
  strikeText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  feedback: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15, lineHeight: 22, textAlign: "center" },
  instructionCard: { backgroundColor: `${Colors.accentGreen}22`, borderColor: Colors.communicationLink, borderRadius: Radius.card, borderWidth: 2, gap: Spacing.sm, padding: Spacing.lg },
  instructionEyebrow: { color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 12, textTransform: "uppercase" },
  instructionText: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 24, lineHeight: 32 },
  instructionHint: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  controlsCard: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, gap: Spacing.md, padding: Spacing.md },
  controlsTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  readOnlyHint: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  optionControl: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: Spacing.xs, minHeight: 94, padding: Spacing.sm },
  optionPressed: { backgroundColor: `${Colors.accentGreen}20`, borderColor: Colors.communicationLink },
  optionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  optionNumber: { alignItems: "center", backgroundColor: Colors.textHeading, borderRadius: 14, height: 28, justifyContent: "center", width: 28 },
  optionNumberText: { color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 13 },
  wireSwatch: { borderColor: Colors.textHeading, borderRadius: 4, borderWidth: 1, height: 18, width: 42 },
  redWire: { backgroundColor: Colors.primary },
  blueWire: { backgroundColor: "#477A9D" },
  yellowWire: { backgroundColor: Colors.accentGold },
  greenWire: { backgroundColor: Colors.accentGreen },
  optionLabel: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 15 },
  optionMarker: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  codeReadout: { alignSelf: "stretch", backgroundColor: Colors.textHeading, borderRadius: Radius.sm, color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 30, padding: Spacing.md, textAlign: "center" },
  codeActions: { flexDirection: "row", gap: Spacing.sm },
  submitButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: Colors.primary, borderRadius: Radius.button, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  submitButtonText: { color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 15, textAlign: "center" },
  secondaryButton: { alignItems: "center", alignSelf: "stretch", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  secondaryButtonText: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 14, textAlign: "center" },
  disabledButton: { opacity: 0.5 },
  resultCard: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, gap: Spacing.md, padding: Spacing.lg },
  resultTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 25, textAlign: "center" },
  resultBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  bodyText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  rematchHint: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18, textAlign: "center" },
  animation: { height: 150, width: 150 },
});
