import { useCallback, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";
import { markPrivateTeamConversationRead } from "@/services/teamPrivateMessageService";

export function usePrivateTeamReadAcknowledgement(conversationId: string) {
  const { user } = useAuth();
  const scope = JSON.stringify([user?.uid, conversationId]);
  const view = useRef({ scope, latest: "", ready: false, acknowledged: "", focused: false });
  if (view.current.scope !== scope) view.current = { scope, latest: "", ready: false, acknowledged: "", focused: false };
  const refresh = useCoalescedRefresh(scope, {
    load: async (messageId: string) => {
      const visible = view.current.scope === scope && view.current.focused && view.current.ready
        && AppState.currentState !== "background" && AppState.currentState !== "inactive";
      if (visible) await markPrivateTeamConversationRead(conversationId);
      return { messageId, marked: visible };
    },
    merge: (_before, latest) => latest,
    covers: (scheduled, requested) => scheduled === requested,
    onSuccess: ({ messageId, marked }) => { if (marked) view.current.acknowledged = messageId; },
    onError: () => {},
  });
  const observe = useCallback((messageId?: string, ready = true) => {
    if (messageId !== undefined) view.current.latest = messageId;
    view.current.ready = ready;
    if (!user?.uid || !view.current.focused || !ready || !view.current.latest || view.current.latest === view.current.acknowledged
      || AppState.currentState === "background" || AppState.currentState === "inactive") return;
    void refresh(view.current.latest, false);
  }, [refresh, user?.uid]);
  useFocusEffect(useCallback(() => {
    view.current.focused = true;
    observe(undefined, view.current.ready);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") observe(undefined, view.current.ready); });
    return () => { view.current.focused = false; subscription.remove(); };
  }, [observe]));
  return observe;
}
